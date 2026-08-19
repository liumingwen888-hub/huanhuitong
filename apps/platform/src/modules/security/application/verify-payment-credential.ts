import type { Uid } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { CredentialError } from '../domain/credential.errors.js';
import {
  hashCredentialDigits,
  verifyCredentialDigits,
  SCRYPT_PARAM_VERSION
} from '../domain/credential-hash.js';
import { SecurityLockAuditService } from './lock-audit.service.js';
import type { CredentialEntryBuffer } from '../domain/credential-processor.js';
import type { CredentialRepository } from './credential.repository.js';

export type VerifyCredentialOutcome =
  | 'verified'
  | 'rejected'
  | 'locked'
  | 'cooldown'
  | 'not_set'
  | 'revoked';

export class VerifyPaymentCredential {
  readonly #unitOfWork: UnitOfWork;
  readonly #credentials: CredentialRepository;
  readonly #lockAudit: SecurityLockAuditService;

  constructor(unitOfWork: UnitOfWork, credentials: CredentialRepository) {
    this.#unitOfWork = unitOfWork;
    this.#credentials = credentials;
    this.#lockAudit = new SecurityLockAuditService(credentials);
  }

  public async execute(
    uid: Uid,
    digits: CredentialEntryBuffer
  ): Promise<VerifyCredentialOutcome> {
    return this.#unitOfWork.execute(async (context) => {
      const credential = await this.#credentials.findCredential(context, uid);
      if (credential === null) return 'not_set';
      if (credential.status === 'NOT_SET') return 'not_set';
      if (credential.status === 'REVOKED') return 'revoked';
      const now = Date.now();
      if (
        credential.status === 'LOCKED' &&
        credential.lockedUntil !== null &&
        Date.parse(credential.lockedUntil) > now
      ) {
        return 'locked';
      }
      if (
        credential.status === 'COOLDOWN' &&
        credential.cooldownUntil !== null &&
        Date.parse(credential.cooldownUntil) > now
      ) {
        return 'cooldown';
      }
      const stored = await context.executeSql<{
        hash_v1: string;
        hash_param_version: number;
      }>(
        `SELECT hash_v1, hash_param_version FROM payment_credentials
          WHERE uid = $1::uuid`,
        [uid]
      );
      const storedRow = stored.rows[0];
      if (storedRow === undefined || storedRow.hash_v1 === null) {
        throw new CredentialError('CREDENTIAL_STATE_INVALID');
      }
      const verification = await digits.withBytes(async (bytes) => {
        const matches = await verifyCredentialDigits(bytes, storedRow.hash_v1);
        const upgraded =
          matches && storedRow.hash_param_version < SCRYPT_PARAM_VERSION
            ? await hashCredentialDigits(bytes)
            : null;
        return { matches, upgraded } as const;
      });
      if (verification.matches) {
        if (verification.upgraded !== null) {
          await this.#credentials.upsertActiveCredential(context, {
            uid,
            hashV1: verification.upgraded.hashV1,
            hashAlgorithm: 'scrypt' as never,
            hashParamVersion: verification.upgraded.paramVersion
          });
        } else {
          await this.#credentials.recordSuccessfulVerification(context, uid);
        }
        await this.#lockAudit.onReleased(context, uid);
        return 'verified';
      }
      const policy = await this.#credentials.activePolicy(context);
      const nextAttempt = credential.failedAttempts + 1;
      let lockUntil: Date | null = null;
      if (nextAttempt >= policy.maxFailedAttempts) {
        const priorLocks = await context.executeSql<{ n: number }>(
          `SELECT count(*)::int AS n FROM security_locks
            WHERE uid = $1::uuid
              AND lock_reason = 'credential-failed-attempts'`,
          [uid]
        );
        const escalationSteps = priorLocks.rows[0]?.n ?? 0;
        const lockSeconds =
          policy.lockDurationSeconds *
          Math.pow(policy.escalationFactor, escalationSteps);
        lockUntil = new Date(now + lockSeconds * 1000);
      }
      await this.#credentials.recordFailedAttempt(context, uid, lockUntil);
      if (lockUntil !== null) {
        await this.#lockAudit.onLocked(context, uid, 'credential-failed-attempts');
      }
      return 'rejected';
    });
  }
}
