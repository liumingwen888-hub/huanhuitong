import type { Uid } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { CredentialRepository } from './credential.repository.js';
import type { VerifyPaymentCredential } from './verify-payment-credential.js';
import type { CredentialEntryBuffer } from '../domain/credential-processor.js';
import { verifyTotp } from '../domain/totp.js';

export class RecoveryCaseError extends Error {
  public readonly code:
    | 'CASE_NOT_FOUND'
    | 'CASE_NOT_OPEN'
    | 'CASE_NOT_PENDING_REVIEW'
    | 'FACTORS_INSUFFICIENT'
    | 'TOTP_NOT_ENROLLED'
    | 'HISTORY_MISMATCH'
    | 'FACTOR_REJECTED';
  constructor(code: RecoveryCaseError['code']) {
    super(code);
    this.name = 'RecoveryCaseError';
    this.code = code;
  }
}

interface CaseRow {
  readonly case_id: string;
  readonly uid: string;
  readonly status: string;
  readonly factors_achieved: number;
  readonly factors_required: number;
}

export class RecoveryCaseService {
  readonly #unitOfWork: UnitOfWork;
  readonly #credentials: CredentialRepository;
  readonly #verifier: VerifyPaymentCredential;
  readonly #totpSecrets = new Map<string, Uint8Array>();

  constructor(
    unitOfWork: UnitOfWork,
    credentials: CredentialRepository,
    verifier: VerifyPaymentCredential
  ) {
    this.#unitOfWork = unitOfWork;
    this.#credentials = credentials;
    this.#verifier = verifier;
  }

  public async beginRecovery(input: {
    readonly uid: Uid;
    readonly factorsRequired?: number;
    readonly totpSecret?: Uint8Array;
  }): Promise<{ readonly caseId: string }> {
    const factorsRequired = input.factorsRequired ?? 3;
    if (
      !Number.isSafeInteger(factorsRequired) ||
      factorsRequired < 2 ||
      factorsRequired > 4
    ) {
      throw new RecoveryCaseError('FACTORS_INSUFFICIENT');
    }
    const caseId = await this.#unitOfWork.execute(async (context) => {
      const created = await context.executeSql<{ case_id: string }>(
        `INSERT INTO recovery_cases (uid, status, factors_achieved, factors_required)
         VALUES ($1::uuid, 'OPEN', 0, $2) RETURNING case_id`,
        [input.uid, factorsRequired]
      );
      const id = created.rows[0]?.case_id;
      if (id === undefined) {
        throw new RecoveryCaseError('CASE_NOT_FOUND');
      }
      await this.#credentials.recordSecurityLock(
        context,
        input.uid,
        'recovery-open'
      );
      return id;
    });
    if (input.totpSecret !== undefined) {
      this.#totpSecrets.set(caseId, input.totpSecret);
    }
    return { caseId };
  }

  public enrollTotpSecret(caseId: string, secret: Uint8Array): void {
    this.#totpSecrets.set(caseId, secret);
  }

  public async achieveFactorMemory(
    caseId: string,
    digits: CredentialEntryBuffer
  ): Promise<number> {
    const row = await this.#requireCase(caseId, 'OPEN');
    const outcome = await this.#verifier.execute(row.uid as Uid, digits);
    if (outcome !== 'verified') {
      throw new RecoveryCaseError('FACTOR_REJECTED');
    }
    return this.#incrementFactor(caseId);
  }

  public async achieveFactorTotp(
    caseId: string,
    code: unknown,
    atTimeMilliseconds: number
  ): Promise<number> {
    await this.#requireCase(caseId, 'OPEN');
    const secret = this.#totpSecrets.get(caseId);
    if (secret === undefined) {
      throw new RecoveryCaseError('TOTP_NOT_ENROLLED');
    }
    if (!verifyTotp(secret, code, atTimeMilliseconds)) {
      throw new RecoveryCaseError('FACTOR_REJECTED');
    }
    return this.#incrementFactor(caseId);
  }

  public async achieveFactorHistory(
    caseId: string,
    claim: {
      readonly registeredOn?: string;
      readonly externalUserId?: string;
    }
  ): Promise<number> {
    const row = await this.#requireCase(caseId, 'OPEN');
    if (
      claim.registeredOn === undefined &&
      claim.externalUserId === undefined
    ) {
      throw new RecoveryCaseError('HISTORY_MISMATCH');
    }
    const facts = await this.#unitOfWork.execute(async (context) => {
      const user = await context.executeSql<{ created_at: Date }>(
        `SELECT created_at FROM users WHERE uid = $1::uuid`,
        [row.uid]
      );
      const binding = await context.executeSql<{ external_user_id: string }>(
        `SELECT external_user_id FROM channel_bindings
          WHERE uid = $1::uuid AND status = 'ACTIVE' LIMIT 1`,
        [row.uid]
      );
      return {
        registeredOn: user.rows[0]?.created_at,
        externalUserId: binding.rows[0]?.external_user_id
      };
    });
    if (claim.registeredOn !== undefined) {
      const actual = facts.registeredOn?.toISOString().slice(0, 10);
      if (actual !== claim.registeredOn) {
        throw new RecoveryCaseError('HISTORY_MISMATCH');
      }
    }
    if (claim.externalUserId !== undefined) {
      if (facts.externalUserId !== claim.externalUserId) {
        throw new RecoveryCaseError('HISTORY_MISMATCH');
      }
    }
    return this.#incrementFactor(caseId);
  }

  public async submitEvidenceForReview(
    caseId: string,
    evidenceRef: string
  ): Promise<void> {
    if (typeof evidenceRef !== 'string' || evidenceRef.length === 0) {
      throw new RecoveryCaseError('CASE_NOT_FOUND');
    }
    const row = await this.#requireCase(caseId, 'OPEN');
    const transitioned = await this.#unitOfWork.execute((context) =>
      context.executeSql(
        `UPDATE recovery_cases
            SET status = 'PENDING_REVIEW',
                factors_achieved =
                  LEAST(factors_achieved + 1, factors_required),
                evidence_ref = $2,
                resolved_at = clock_timestamp()
          WHERE case_id = $1::uuid AND status = 'OPEN'
          RETURNING case_id`,
        [caseId, evidenceRef]
      )
    );
    if (transitioned.rows.length !== 1) {
      throw new RecoveryCaseError('CASE_NOT_OPEN');
    }
    void row;
  }

  public async approve(caseId: string): Promise<{
    readonly cooldownUntil: string;
  }> {
    const row = await this.#requireCase(caseId, 'PENDING_REVIEW');
    if (row.factors_achieved < row.factors_required) {
      throw new RecoveryCaseError('FACTORS_INSUFFICIENT');
    }
    const policy = await this.#unitOfWork.execute((context) =>
      this.#credentials.activePolicy(context)
    );
    return this.#unitOfWork.execute(async (context) => {
      const approved = await context.executeSql<{ cooldown_until: Date }>(
        `UPDATE recovery_cases
            SET status = 'APPROVED',
                resolved_at = clock_timestamp(),
                cooldown_until = clock_timestamp() + make_interval(secs => $2)
          WHERE case_id = $1::uuid AND status = 'PENDING_REVIEW'
          RETURNING cooldown_until`,
        [caseId, policy.cooldownSeconds]
      );
      const updated = approved.rows[0];
      if (updated === undefined) {
        throw new RecoveryCaseError('CASE_NOT_PENDING_REVIEW');
      }
      await context.executeSql(
        `UPDATE payment_credentials
            SET status = 'COOLDOWN',
                cooldown_until = clock_timestamp() + make_interval(secs => $2),
                locked_until = NULL,
                failed_attempts = 0,
                updated_at = clock_timestamp()
          WHERE uid = $1::uuid AND status <> 'NOT_SET' AND status <> 'REVOKED'`,
        [row.uid, policy.cooldownSeconds]
      );
      this.#disposeTotp(caseId);
      return {
        cooldownUntil: new Date(updated.cooldown_until).toISOString()
      };
    });
  }

  public async reject(caseId: string): Promise<boolean> {
    const rejected = await this.#unitOfWork.execute((context) =>
      context.executeSql(
        `UPDATE recovery_cases
            SET status = 'REJECTED', resolved_at = clock_timestamp()
          WHERE case_id = $1::uuid AND status = 'PENDING_REVIEW'
          RETURNING case_id`,
        [caseId]
      )
    );
    const ok = rejected.rows.length === 1;
    if (ok) this.#disposeTotp(caseId);
    return ok;
  }

  async #requireCase(
    caseId: string,
    expected: 'OPEN' | 'PENDING_REVIEW'
  ): Promise<CaseRow> {
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<CaseRow>(
        `SELECT case_id, uid, status, factors_achieved, factors_required
           FROM recovery_cases WHERE case_id = $1::uuid`,
        [caseId]
      )
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new RecoveryCaseError('CASE_NOT_FOUND');
    }
    if (row.status !== expected) {
      throw new RecoveryCaseError(
        expected === 'OPEN' ? 'CASE_NOT_OPEN' : 'CASE_NOT_PENDING_REVIEW'
      );
    }
    return row;
  }

  async #incrementFactor(caseId: string): Promise<number> {
    const result = await this.#unitOfWork.execute((context) =>
      context.executeSql<{ factors_achieved: number }>(
        `UPDATE recovery_cases
            SET factors_achieved = factors_achieved + 1
          WHERE case_id = $1::uuid AND status = 'OPEN'
          RETURNING factors_achieved`,
        [caseId]
      )
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new RecoveryCaseError('CASE_NOT_OPEN');
    }
    return row.factors_achieved;
  }

  #disposeTotp(caseId: string): void {
    const secret = this.#totpSecrets.get(caseId);
    if (secret !== undefined) {
      secret.fill(0);
      this.#totpSecrets.delete(caseId);
    }
  }
}
