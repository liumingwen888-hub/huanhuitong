import type {
  CredentialPolicySnapshot,
  PaymentCredentialSnapshot,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import { CredentialError } from '../domain/credential.errors.js';
import type {
  CredentialRepository,
  UpsertCredentialInput
} from '../application/credential.repository.js';

export class PostgresCredentialRepository implements CredentialRepository {
  public async findCredential(
    context: TransactionContext,
    uid: Uid
  ): Promise<PaymentCredentialSnapshot | null> {
    const result = await context.executeSql<{
      status: string;
      failed_attempts: number;
      locked_until: Date | null;
      cooldown_until: Date | null;
    }>(
      `SELECT status, failed_attempts, locked_until, cooldown_until
         FROM payment_credentials WHERE uid = $1::uuid`,
      [uid]
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      uid,
      status: row.status as PaymentCredentialSnapshot['status'],
      failedAttempts: row.failed_attempts,
      lockedUntil:
        row.locked_until === null ? null : new Date(row.locked_until).toISOString(),
      cooldownUntil:
        row.cooldown_until === null
          ? null
          : new Date(row.cooldown_until).toISOString()
    };
  }

  public async upsertActiveCredential(
    context: TransactionContext,
    input: UpsertCredentialInput
  ): Promise<void> {
    if (!/^[a-z0-9]+\$[A-Za-z0-9=,]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/u.test(input.hashV1)) {
      throw new CredentialError('CREDENTIAL_COMMAND_INVALID');
    }
    await context.executeSql(
      `INSERT INTO payment_credentials
         (uid, status, hash_v1, hash_algorithm, hash_param_version,
          failed_attempts, locked_until, cooldown_until)
       VALUES ($1::uuid, 'ACTIVE', $2, $3, $4, 0, NULL, NULL)
       ON CONFLICT (uid) DO UPDATE
         SET status = 'ACTIVE',
             hash_v1 = EXCLUDED.hash_v1,
             hash_algorithm = EXCLUDED.hash_algorithm,
             hash_param_version = EXCLUDED.hash_param_version,
             failed_attempts = 0,
             locked_until = NULL,
             cooldown_until = NULL,
             updated_at = clock_timestamp()`,
      [input.uid, input.hashV1, input.hashAlgorithm, input.hashParamVersion]
    );
  }

  public async recordFailedAttempt(
    context: TransactionContext,
    uid: Uid,
    lockUntil: Date | null
  ): Promise<number> {
    const result = await context.executeSql<{ failed_attempts: number }>(
      `UPDATE payment_credentials
          SET failed_attempts = failed_attempts + 1,
              locked_until = $2::timestamptz,
              status = CASE WHEN $2::timestamptz IS NOT NULL
                            THEN 'LOCKED' ELSE status END,
              updated_at = clock_timestamp()
        WHERE uid = $1::uuid
        RETURNING failed_attempts`,
      [uid, lockUntil]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new CredentialError('CREDENTIAL_NOT_FOUND');
    }
    return row.failed_attempts;
  }

  public async recordSuccessfulVerification(
    context: TransactionContext,
    uid: Uid
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE payment_credentials
          SET failed_attempts = 0,
              locked_until = NULL,
              status = CASE WHEN status = 'LOCKED' THEN 'ACTIVE' ELSE status END,
              updated_at = clock_timestamp()
        WHERE uid = $1::uuid
        RETURNING uid`,
      [uid]
    );
    return result.rows.length === 1;
  }

  public async activePolicy(
    context: TransactionContext
  ): Promise<CredentialPolicySnapshot> {
    const result = await context.executeSql<{
      policy_version: number;
      min_digits: number;
      max_digits: number;
      max_failed_attempts: number;
      lock_duration_seconds: number;
      escalation_factor: number;
      cooldown_seconds: number;
    }>(
      `SELECT policy_version, min_digits, max_digits, max_failed_attempts,
              lock_duration_seconds, escalation_factor, cooldown_seconds
         FROM credential_policies
        WHERE policy_version = (SELECT max(policy_version) FROM credential_policies)`
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new CredentialError('CREDENTIAL_STATE_INVALID');
    }
    return {
      policyVersion: row.policy_version,
      minDigits: row.min_digits,
      maxDigits: row.max_digits,
      maxFailedAttempts: row.max_failed_attempts,
      lockDurationSeconds: row.lock_duration_seconds,
      escalationFactor: row.escalation_factor,
      cooldownSeconds: row.cooldown_seconds
    };
  }
}
