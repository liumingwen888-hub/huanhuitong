import type {
  ActiveChannelBindingSnapshot,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import { TransactionContextError } from '../../../infrastructure/database/transaction-context.js';
import type {
  ChannelIdentityQuery,
  ProfileSnapshotInput
} from '../domain/identity.types.js';
import { IdentityError } from '../domain/identity.errors.js';
import type { IdentityRepository } from '../application/identity.repository.js';

function mapUniqueViolation(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    ((error as { constraint?: unknown }).constraint ===
      'uq_channel_bindings_active_external' ||
      (error as { code?: unknown }).code === '23505')
  ) {
    throw new IdentityError('IDENTITY_BINDING_CONFLICT');
  }
  throw error;
}

async function executeInsert(
  context: TransactionContext,
  sql: string,
  values: ReadonlyArray<unknown>
): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }> {
  try {
    return await context.executeSql<Record<string, unknown>>(sql, values);
  } catch (error: unknown) {
    if (error instanceof TransactionContextError === false) {
      mapUniqueViolation(error as never);
    }
    throw error;
  }
}

export class PostgresIdentityRepository implements IdentityRepository {
  public async findActiveBinding(
    context: TransactionContext,
    query: ChannelIdentityQuery
  ): Promise<ActiveChannelBindingSnapshot | null> {
    const result = await context.executeSql<{
      binding_id: string;
      uid: string;
      channel_type: string;
      external_user_id: string;
    }>(
      `SELECT binding_id, uid, channel_type, external_user_id
         FROM channel_bindings
        WHERE channel_type = $1
          AND external_user_id = $2
          AND status = 'ACTIVE'
        LIMIT 1`,
      ['TELEGRAM', query.externalUserId]
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return Object.freeze({
      bindingId: row.binding_id,
      uid: row.uid as Uid,
      channelType: 'telegram',
      externalUserId: row.external_user_id
    });
  }

  public async createUser(context: TransactionContext): Promise<Uid> {
    const result = await executeInsert(
      context,
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new IdentityError('IDENTITY_USER_STATUS_INVALID');
    }
    return row.uid as Uid;
  }

  public async createMembership(
    context: TransactionContext,
    uid: Uid
  ): Promise<string> {
    const result = await executeInsert(
      context,
      `INSERT INTO memberships (uid, status) VALUES ($1::uuid, 'ACTIVE')
       RETURNING membership_id`,
      [uid]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new IdentityError('IDENTITY_USER_STATUS_INVALID');
    }
    return String(row.membership_id);
  }

  public async upsertProfileSnapshot(
    context: TransactionContext,
    uid: Uid,
    snapshot: ProfileSnapshotInput
  ): Promise<void> {
    await context.executeSql(
      `INSERT INTO identity_profiles (uid, username_snapshot, display_name_snapshot)
         VALUES ($1::uuid, $2, $3)
       ON CONFLICT (uid) DO UPDATE
         SET username_snapshot = EXCLUDED.username_snapshot,
             display_name_snapshot = EXCLUDED.display_name_snapshot,
             updated_at = clock_timestamp()`,
      [uid, snapshot.username, snapshot.displayName]
    );
  }

  public async createActiveBinding(
    context: TransactionContext,
    uid: Uid,
    query: ChannelIdentityQuery
  ): Promise<string> {
    const result = await executeInsert(
      context,
      `INSERT INTO channel_bindings
           (channel_type, external_user_id, uid, status)
         VALUES ('TELEGRAM', $1, $2::uuid, 'ACTIVE')
       RETURNING binding_id`,
      [query.externalUserId, uid]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new IdentityError('IDENTITY_BINDING_CONFLICT');
    }
    return String(row.binding_id);
  }
}
