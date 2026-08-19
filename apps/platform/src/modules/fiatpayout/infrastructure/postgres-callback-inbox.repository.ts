import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type {
  CallbackInboxRepository,
  CallbackInboxSnapshot
} from '../application/callback-inbox.repository.js';

interface CallbackRow {
  callback_id: string;
  provider_id: string;
  provider_event_id: string;
  provider_idempotency_key: string;
  reported_status: string;
  received_at: Date;
}

function toSnapshot(row: CallbackRow): CallbackInboxSnapshot {
  return Object.freeze({
    callbackId: row.callback_id,
    providerId: row.provider_id,
    providerEventId: row.provider_event_id,
    providerIdempotencyKey: row.provider_idempotency_key,
    reportedStatus: row.reported_status as CallbackInboxSnapshot['reportedStatus'],
    receivedAt: row.received_at.toISOString()
  });
}

export class PostgresCallbackInboxRepository
  implements CallbackInboxRepository
{
  public async insert(
    context: TransactionContext,
    input: {
      readonly providerId: string;
      readonly providerEventId: string;
      readonly providerIdempotencyKey: string;
      readonly reportedStatus: 'SUCCEEDED' | 'FAILED' | 'REVERSED';
    }
  ): Promise<CallbackInboxSnapshot> {
    const result = await context.executeSql<CallbackRow>(
      `INSERT INTO callback_inbox
         (provider_id, provider_event_id, provider_idempotency_key,
          reported_status)
       VALUES ($1, $2, $3, $4)
       RETURNING callback_id, provider_id, provider_event_id,
                 provider_idempotency_key, reported_status, received_at`,
      [
        input.providerId,
        input.providerEventId,
        input.providerIdempotencyKey,
        input.reportedStatus
      ]
    );
    return toSnapshot(result.rows[0]!);
  }

  public async hasEvent(
    context: TransactionContext,
    input: { readonly providerId: string; readonly providerEventId: string }
  ): Promise<boolean> {
    const result = await context.executeSql<{ n: number }>(
      `SELECT count(*)::int AS n FROM callback_inbox
        WHERE provider_id = $1 AND provider_event_id = $2`,
      [input.providerId, input.providerEventId]
    );
    return (result.rows[0]?.n ?? 0) > 0;
  }
}
