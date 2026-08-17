import type { RegistrationAcquisition, Uid } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type { RegistrationKey } from '../domain/identity.types.js';
import { IdentityError } from '../domain/identity.errors.js';
import type {
  RegistrationCompletion,
  RegistrationIdempotencyRepository
} from '../application/identity.repository.js';

export class PostgresRegistrationIdempotencyRepository
  implements RegistrationIdempotencyRepository
{
  public async tryAcquire(
    context: TransactionContext,
    key: RegistrationKey
  ): Promise<RegistrationAcquisition> {
    const inserted = await context.executeSql(
      `INSERT INTO registration_idempotency
           (registration_key, channel_type, external_user_id, status)
         VALUES ($1::uuid, 'TELEGRAM', $2, 'PROCESSING')
       ON CONFLICT (registration_key) DO NOTHING
       RETURNING registration_key`,
      [key.registrationKey, key.externalUserId]
    );
    if (inserted.rows.length === 1) return 'acquired';
    const existing = await context.executeSql<{ status: string }>(
      `SELECT status FROM registration_idempotency
        WHERE registration_key = $1::uuid`,
      [key.registrationKey]
    );
    const status = existing.rows[0]?.status;
    if (status === 'COMPLETED') return 'completed';
    if (status === 'PROCESSING') return 'in_progress';
    throw new IdentityError('IDENTITY_REGISTRATION_KEY_INVALID');
  }

  public async complete(
    context: TransactionContext,
    key: RegistrationKey,
    uid: Uid
  ): Promise<boolean> {
    const updated = await context.executeSql(
      `UPDATE registration_idempotency
          SET status = 'COMPLETED',
              uid = $2::uuid,
              completed_at = clock_timestamp()
        WHERE registration_key = $1::uuid
          AND status = 'PROCESSING'
          AND uid IS NULL
          AND completed_at IS NULL
        RETURNING registration_key`,
      [key.registrationKey, uid]
    );
    return updated.rows.length === 1;
  }

  public async findCompleted(
    context: TransactionContext,
    key: RegistrationKey
  ): Promise<RegistrationCompletion | null> {
    const found = await context.executeSql<{ uid: string }>(
      `SELECT uid FROM registration_idempotency
        WHERE registration_key = $1::uuid
          AND status = 'COMPLETED'
          AND uid IS NOT NULL`,
      [key.registrationKey]
    );
    const row = found.rows[0];
    if (row === undefined) return null;
    return Object.freeze({ uid: row.uid as Uid });
  }
}
