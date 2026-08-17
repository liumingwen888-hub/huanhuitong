import { isProxy } from 'node:util/types';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import { TransactionContextError } from '../../../infrastructure/database/transaction-context.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const SENSITIVE_PAYLOAD_KEYS = new Set([
  'update',
  'canonicalBytes',
  'payloadDigest',
  'botToken',
  'secretToken',
  'password',
  'phoneNumber',
  'callbackData',
  'messageText'
]);

export type OutboxRepositoryErrorCode =
  | 'OUTBOX_COMMAND_INVALID'
  | 'OUTBOX_DUPLICATE_EVENT_KEY';

export class OutboxRepositoryError extends Error {
  public readonly code: OutboxRepositoryErrorCode;
  constructor(code: OutboxRepositoryErrorCode) {
    super(code);
    this.name = 'OutboxRepositoryError';
    this.code = code;
  }
}

function invalid(): never {
  throw new OutboxRepositoryError('OUTBOX_COMMAND_INVALID');
}

function ownRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) invalid();
  if (isProxy(value)) invalid();
  if (Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  return value as Record<string, unknown>;
}

function field(source: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined || !('value' in descriptor)) invalid();
  return descriptor.value;
}

function stringField(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): string {
  const value = field(source, key);
  if (
    typeof value !== 'string' ||
    value.length < minimum ||
    value.length > maximum
  ) {
    invalid();
  }
  return value;
}

function uuidField(source: Record<string, unknown>, key: string): string {
  const value = stringField(source, key, 36, 36);
  if (!UUID_PATTERN.test(value)) invalid();
  return value;
}

function scanPayload(value: unknown): void {
  if (value === null) return;
  if (typeof value === 'string') return;
  if (typeof value === 'number') return;
  if (typeof value === 'boolean') return;
  if (typeof value !== 'object') invalid();
  if (isProxy(value)) invalid();
  if (Array.isArray(value)) {
    for (const item of value) scanPayload(item);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (SENSITIVE_PAYLOAD_KEYS.has(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor === undefined || !('value' in descriptor)) invalid();
    scanPayload(descriptor.value);
  }
}

export interface OutboxEnvelopeInput {
  readonly id: string;
  readonly topic: string;
  readonly eventKey: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly payload: object;
}

export interface OutboxRepository {
  enqueue(
    context: TransactionContext,
    envelope: OutboxEnvelopeInput
  ): Promise<string>;
}

export class PostgresOutboxRepository implements OutboxRepository {
  public async enqueue(
    context: TransactionContext,
    envelopeInput: OutboxEnvelopeInput
  ): Promise<string> {
    const envelope = ownRecord(envelopeInput as unknown);
    const id = uuidField(envelope, 'id');
    const topic = stringField(envelope, 'topic', 1, 200);
    const eventKey = stringField(envelope, 'eventKey', 1, 300);
    const occurredAt = stringField(envelope, 'occurredAt', 10, 64);
    const correlationId = uuidField(envelope, 'correlationId');
    const payload = field(envelope, 'payload');
    scanPayload(payload);

    let inserted: { rows: ReadonlyArray<{ outbox_id: string }> };
    try {
      inserted = await context.executeSql<{ outbox_id: string }>(
        `INSERT INTO outbox_messages (
           outbox_id, topic, event_key, version, payload,
           correlation_id, status, attempt_count, available_at
         ) VALUES (
           $1::uuid, $2, $3, 1, $4::jsonb,
           $5::uuid, 'READY', 0, clock_timestamp()
         )
         RETURNING outbox_id`,
        [id, topic, eventKey, JSON.stringify(payload), correlationId]
      );
    } catch (error: unknown) {
      if (
        error instanceof TransactionContextError === false &&
        error !== null &&
        typeof error === 'object' &&
        (error as { code?: unknown }).code === '23505'
      ) {
        throw new OutboxRepositoryError('OUTBOX_DUPLICATE_EVENT_KEY');
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { constraint?: unknown }).constraint ===
          'uq_outbox_topic_event_key'
      ) {
        throw new OutboxRepositoryError('OUTBOX_DUPLICATE_EVENT_KEY');
      }
      throw error;
    }
    const row = inserted.rows[0];
    if (inserted.rows.length !== 1 || row === undefined) {
      throw new OutboxRepositoryError('OUTBOX_COMMAND_INVALID');
    }
    void occurredAt;
    return row.outbox_id;
  }
}
