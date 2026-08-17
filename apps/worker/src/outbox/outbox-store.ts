import {
  WORKER_BACKOFF_BASE_MILLIS,
  WORKER_BACKOFF_CAP_MILLIS,
  WORKER_MAX_TRANSIENT_ATTEMPTS,
  type LeasedOutboxMessage,
  type WorkerErrorClassification
} from '@xht/contracts';

export interface StoreQueryResult<T> {
  readonly rows: readonly T[];
}

export interface StoreClient {
  query<T extends object>(text: string, values: readonly unknown[]):
    Promise<StoreQueryResult<T>>;
}

export interface StoreConnectionFactory {
  withClient<T>(operation: (client: StoreClient) => Promise<T>): Promise<T>;
}

export interface ClaimBatchCommand {
  readonly workerId: string;
  readonly limit: number;
  readonly leaseMilliseconds: number;
}

export interface LeaseCredential {
  readonly id: string;
  readonly workerId: string;
  readonly leaseToken: string;
  readonly lockGeneration: number;
}

export interface ApplyFailureCommand extends LeaseCredential {
  readonly classification: WorkerErrorClassification;
  readonly attemptCount: number;
  readonly jitter: () => number;
}

export type MarkOutcome = 'confirmed' | 'stale_lease';

interface ClaimedRow {
  readonly outbox_id: string;
  readonly topic: string;
  readonly event_key: string;
  readonly payload: Record<string, unknown>;
  readonly correlation_id: string;
  readonly locked_by: string;
  readonly lease_token: string;
  readonly lock_generation: string | number;
  readonly attempt_count: number;
  readonly locked_until: Date;
}

export interface OutboxStore {
  claimBatch(command: ClaimBatchCommand): Promise<readonly LeasedOutboxMessage[]>;
  markSucceeded(credential: LeaseCredential): Promise<MarkOutcome>;
  applyFailure(command: ApplyFailureCommand): Promise<MarkOutcome>;
}

export class PostgresOutboxStore implements OutboxStore {
  readonly #connections: StoreConnectionFactory;

  public constructor(connections: StoreConnectionFactory) {
    this.#connections = connections;
  }

  public async claimBatch(
    command: ClaimBatchCommand
  ): Promise<readonly LeasedOutboxMessage[]> {
    const result = await this.#connections.withClient((client) =>
      client.query<ClaimedRow>(
        `WITH database_time AS (
           SELECT clock_timestamp() AS value
         ),
         candidates AS (
           SELECT outbox.outbox_id
             FROM outbox_messages AS outbox, database_time
            WHERE (
                outbox.status = 'READY'
                AND outbox.available_at <= database_time.value
              )
               OR (
                outbox.status = 'RETRY_WAIT'
                AND outbox.available_at <= database_time.value
              )
               OR (
                outbox.status = 'LEASED'
                AND outbox.locked_until <= database_time.value
              )
            ORDER BY outbox.created_at, outbox.outbox_id
            LIMIT $2
            FOR UPDATE OF outbox SKIP LOCKED
         )
         UPDATE outbox_messages AS outbox
            SET status = 'LEASED',
                locked_by = $1,
                lease_token = gen_random_uuid(),
                lock_generation = outbox.lock_generation + 1,
                locked_until =
                  (SELECT value FROM database_time) + make_interval(secs => $3 / 1000.0),
                attempt_count = outbox.attempt_count + 1
          FROM candidates
         WHERE outbox.outbox_id = candidates.outbox_id
         RETURNING outbox.outbox_id, outbox.topic, outbox.event_key,
                   outbox.payload, outbox.correlation_id, outbox.locked_by,
                   outbox.lease_token, outbox.lock_generation,
                   outbox.attempt_count, outbox.locked_until`,
        [command.workerId, command.limit, command.leaseMilliseconds]
      )
    );
    return result.rows.map((row) =>
      Object.freeze({
        id: row.outbox_id,
        topic: row.topic,
        eventKey: row.event_key,
        occurredAt: '',
        correlationId: row.correlation_id,
        payload: Object.freeze(row.payload),
        workerId: row.locked_by,
        leaseToken: row.lease_token,
        lockGeneration: Number(row.lock_generation),
        attemptCount: Number(row.attempt_count),
        lockedUntil: new Date(row.locked_until).toISOString()
      })
    );
  }

  public async markSucceeded(
    credential: LeaseCredential
  ): Promise<MarkOutcome> {
    const result = await this.#connections.withClient((client) =>
      client.query<{ outbox_id: string }>(
        `WITH database_time AS (
           SELECT clock_timestamp() AS value
         )
         UPDATE outbox_messages AS outbox
            SET status = 'SUCCEEDED',
                locked_by = NULL,
                lease_token = NULL,
                locked_until = NULL,
                succeeded_at = (SELECT value FROM database_time)
          WHERE outbox.outbox_id = $1::uuid
            AND outbox.locked_by = $2
            AND outbox.lease_token = $3::uuid
            AND outbox.lock_generation = $4
            AND outbox.status = 'LEASED'
          RETURNING outbox.outbox_id`,
        [
          credential.id,
          credential.workerId,
          credential.leaseToken,
          credential.lockGeneration
        ]
      )
    );
    return result.rows.length === 1 ? 'confirmed' : 'stale_lease';
  }

  public async applyFailure(
    command: ApplyFailureCommand
  ): Promise<MarkOutcome> {
    const attemptsExhausted =
      command.classification === 'TRANSIENT' &&
      command.attemptCount >= WORKER_MAX_TRANSIENT_ATTEMPTS;
    const delayMillis = backoffDelayMillis(command.jitter);
    const result = await this.#connections.withClient((client) =>
      client.query<{ outbox_id: string }>(
        `WITH database_time AS (
           SELECT clock_timestamp() AS value
         )
         UPDATE outbox_messages AS outbox
            SET status = CASE
                  WHEN $5 = 'PERMANENT' THEN 'DEAD_LETTER'
                  WHEN $5 = 'DISABLED' THEN 'WAITING_CONFIGURATION'
                  WHEN $6::boolean THEN 'DEAD_LETTER'
                  ELSE 'RETRY_WAIT'
                END,
                locked_by = NULL,
                lease_token = NULL,
                locked_until = NULL,
                available_at = CASE
                  WHEN $5 = 'DISABLED' THEN outbox.available_at
                  ELSE (SELECT value FROM database_time)
                    + make_interval(secs => $7 / 1000.0)
                END
          WHERE outbox.outbox_id = $1::uuid
            AND outbox.locked_by = $2
            AND outbox.lease_token = $3::uuid
            AND outbox.lock_generation = $4
            AND outbox.status = 'LEASED'
          RETURNING outbox.outbox_id`,
        [
          command.id,
          command.workerId,
          command.leaseToken,
          command.lockGeneration,
          command.classification,
          attemptsExhausted,
          delayMillis
        ]
      )
    );
    return result.rows.length === 1 ? 'confirmed' : 'stale_lease';
  }
}

export function backoffDelayMillis(jitter: () => number): number {
  const raw = jitter() * WORKER_BACKOFF_CAP_MILLIS;
  return Math.min(
    WORKER_BACKOFF_CAP_MILLIS,
    Math.max(WORKER_BACKOFF_BASE_MILLIS, Math.floor(raw))
  );
}
