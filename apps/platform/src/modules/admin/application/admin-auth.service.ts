import { createHash, randomBytes } from 'node:crypto';
import { argon2Verify } from 'hash-wasm';
import type {
  AdminAuthErrorCode,
  AdminSessionSnapshot
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { base32Decode, verifyTotp } from '../../security/domain/totp.js';
import type { TotpSecretPort } from '../domain/totp-secret.port.js';
import type { AdminSessionRepository } from './admin-session.repository.js';

export interface AdminLoginInput {
  readonly username: string;
  readonly password: string;
  readonly totpCode: string;
}

export type AdminLoginResult =
  | {
      readonly outcome: 'AUTHENTICATED';
      readonly token: string;
      readonly expiresAt: string;
    }
  | { readonly outcome: 'DENIED'; readonly reasonCode: AdminAuthErrorCode };

export type SessionRequirement = 'BASIC' | 'ELEVATED';

export type AdminSessionCheck =
  | { readonly outcome: 'VALID'; readonly session: AdminSessionSnapshot }
  | { readonly outcome: 'DENIED'; readonly reasonCode: AdminAuthErrorCode };

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const SESSION_MINUTES = 30;
const ELEVATION_MINUTES = 5;

interface CredentialRow {
  readonly admin_id: string;
  readonly username: string;
  readonly password_hash: string;
  readonly totp_secret_ref: string;
  readonly failed_attempts: number;
  readonly locked_until: Date | null;
  readonly principal_status: string;
}

/**
 * Admin authentication: argon2id password verification, mandatory
 * TOTP resolved through the vault-reference port, exponential-free
 * fail-closed lockout (five failures freeze the account for fifteen
 * minutes regardless of later-correct credentials), and opaque
 * session tokens whose raw form appears exactly once — only the
 * SHA-256 hash is ever stored.
 */
export class AdminAuthService {
  readonly #unitOfWork: UnitOfWork;
  readonly #sessions: AdminSessionRepository;
  readonly #secrets: TotpSecretPort;

  constructor(
    unitOfWork: UnitOfWork,
    sessions: AdminSessionRepository,
    secrets: TotpSecretPort
  ) {
    this.#unitOfWork = unitOfWork;
    this.#sessions = sessions;
    this.#secrets = secrets;
  }

  public async login(
    input: AdminLoginInput
  ): Promise<AdminLoginResult> {
    const credential = await this.#unitOfWork.execute((context) =>
      context.executeSql<CredentialRow>(
        `SELECT c.admin_id, c.username, c.password_hash,
                c.totp_secret_ref, c.failed_attempts, c.locked_until,
                p.status AS principal_status
           FROM admin_credentials c
           JOIN admin_principals p ON p.admin_id = c.admin_id
          WHERE c.username = $1`,
        [input.username]
      )
    );
    const row = credential.rows[0];
    if (row === undefined || row.principal_status !== 'ACTIVE') {
      return { outcome: 'DENIED', reasonCode: 'ADMIN_AUTH_INVALID' };
    }
    if (row.locked_until !== null && row.locked_until.getTime() > Date.now()) {
      return { outcome: 'DENIED', reasonCode: 'ADMIN_AUTH_LOCKED' };
    }
    const passwordOk = await argon2Verify({
      password: input.password,
      hash: row.password_hash
    });
    if (!passwordOk) {
      await this.#registerFailure(row);
      return { outcome: 'DENIED', reasonCode: 'ADMIN_AUTH_INVALID' };
    }
    const totpOk = await this.#verifyTotp(row, input.totpCode);
    if (!totpOk) {
      await this.#registerFailure(row);
      return { outcome: 'DENIED', reasonCode: 'ADMIN_AUTH_MFA_REQUIRED' };
    }
    await this.#unitOfWork.execute((context) =>
      context.executeSql(
        `UPDATE admin_credentials
            SET failed_attempts = 0, locked_until = NULL,
                updated_at = clock_timestamp()
          WHERE admin_id = $1::uuid`,
        [row.admin_id]
      )
    );
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60_000);
    await this.#unitOfWork.execute((context) =>
      this.#sessions.insert(context, {
        adminId: row.admin_id,
        tokenHash: hashToken(token),
        expiresAt
      })
    );
    return {
      outcome: 'AUTHENTICATED',
      token,
      expiresAt: expiresAt.toISOString()
    };
  }

  public async logout(sessionToken: string): Promise<void> {
    await this.#unitOfWork.execute((context) =>
      this.#sessions.revokeByTokenHash(context, hashToken(sessionToken))
    );
  }

  public async elevate(input: {
    readonly sessionToken: string;
    readonly password: string;
    readonly totpCode: string;
  }): Promise<AdminSessionCheck> {
    const check = await this.requireSession(input.sessionToken, 'BASIC');
    if (check.outcome === 'DENIED') {
      return check;
    }
    const credential = await this.#unitOfWork.execute((context) =>
      context.executeSql<CredentialRow>(
        `SELECT c.admin_id, c.username, c.password_hash,
                c.totp_secret_ref, c.failed_attempts, c.locked_until,
                p.status AS principal_status
           FROM admin_credentials c
           JOIN admin_principals p ON p.admin_id = c.admin_id
          WHERE c.admin_id = $1::uuid`,
        [check.session.adminId]
      )
    );
    const row = credential.rows[0];
    if (row === undefined) {
      return { outcome: 'DENIED', reasonCode: 'ADMIN_AUTH_INVALID' };
    }
    const passwordOk = await argon2Verify({
      password: input.password,
      hash: row.password_hash
    });
    const totpOk =
      passwordOk && (await this.#verifyTotp(row, input.totpCode));
    if (!passwordOk || !totpOk) {
      // elevation failures count toward lockout exactly like login
      // failures — otherwise a stolen BASIC session gets unlimited
      // brute-force attempts on this endpoint
      await this.#registerFailure(row);
      return { outcome: 'DENIED', reasonCode: 'ADMIN_AUTH_INVALID' };
    }
    const elevatedUntil = new Date(
      Date.now() + ELEVATION_MINUTES * 60_000
    );
    await this.#unitOfWork.execute((context) =>
      this.#sessions.elevateByTokenHash(context, {
        tokenHash: hashToken(input.sessionToken),
        elevatedUntil
      })
    );
    return this.requireSession(input.sessionToken, 'ELEVATED');
  }

  public async requireSession(
    sessionToken: string,
    level: SessionRequirement
  ): Promise<AdminSessionCheck> {
    const session = await this.#unitOfWork.execute((context) =>
      this.#sessions.findByTokenHash(context, hashToken(sessionToken))
    );
    if (session === null) {
      return { outcome: 'DENIED', reasonCode: 'ADMIN_SESSION_INVALID' };
    }
    if (session.revokedAt !== null) {
      return { outcome: 'DENIED', reasonCode: 'ADMIN_SESSION_INVALID' };
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      return { outcome: 'DENIED', reasonCode: 'ADMIN_SESSION_EXPIRED' };
    }
    if (
      level === 'ELEVATED' &&
      (session.elevatedUntil === null ||
        Date.parse(session.elevatedUntil) <= Date.now())
    ) {
      return {
        outcome: 'DENIED',
        reasonCode: 'ADMIN_ELEVATION_REQUIRED'
      };
    }
    return { outcome: 'VALID', session };
  }

  async #verifyTotp(row: CredentialRow, code: string): Promise<boolean> {
    let secret: string;
    try {
      secret = await this.#secrets.resolveSecret(row.totp_secret_ref);
    } catch {
      return false;
    }
    return verifyTotp(base32Decode(secret), code, Date.now());
  }

  async #registerFailure(row: CredentialRow): Promise<void> {
    // atomic relative increment + RETURNING: a read-then-write
    // absolute value lost updates under concurrent failures,
    // letting parallel brute-force bypass the lockout threshold
    await this.#unitOfWork.execute((context) =>
      context.executeSql<{ locked_now: boolean }>(
        `UPDATE admin_credentials
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE
                  WHEN failed_attempts + 1 >= ${LOCKOUT_THRESHOLD}
                    THEN clock_timestamp() + interval '${LOCKOUT_MINUTES} minutes'
                  ELSE locked_until END,
                updated_at = clock_timestamp()
          WHERE admin_id = $1::uuid
          RETURNING (locked_until IS NOT NULL) AS locked_now`,
        [row.admin_id]
      )
    );
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
