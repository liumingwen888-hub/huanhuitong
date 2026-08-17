import { isProxy } from 'node:util/types';
import type { ManagedDatabase } from '../../../infrastructure/database/database.js';
import { sql } from 'kysely';

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

export type DurableJobRepositoryErrorCode =
  | 'JOB_COMMAND_INVALID'
  | 'JOB_DUPLICATE_BUSINESS_KEY';

export class DurableJobRepositoryError extends Error {
  public readonly code: DurableJobRepositoryErrorCode;
  constructor(code: DurableJobRepositoryErrorCode) {
    super(code);
    this.name = 'DurableJobRepositoryError';
    this.code = code;
  }
}

function invalid(): never {
  throw new DurableJobRepositoryError('JOB_COMMAND_INVALID');
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

export interface DurableJobInput {
  readonly jobType: string;
  readonly businessKey: string;
  readonly payload: object;
}

export interface DurableJobRepository {
  enqueue(input: DurableJobInput): Promise<string>;
}

export class PostgresDurableJobRepository implements DurableJobRepository {
  readonly #database: ManagedDatabase;

  public constructor(database: ManagedDatabase) {
    this.#database = database;
  }

  public async enqueue(inputInput: DurableJobInput): Promise<string> {
    const input = ownRecord(inputInput as unknown);
    const jobType = stringField(input, 'jobType', 1, 200);
    const businessKey = stringField(input, 'businessKey', 1, 300);
    const payload = field(input, 'payload');
    scanPayload(payload);

    try {
      const result = await this.#database
        .insertInto('durable_jobs')
        .values({
          job_type: jobType,
          business_key: businessKey,
          payload: JSON.stringify(payload) as never,
          status: 'READY',
          attempt_count: 0,
          available_at: sql`clock_timestamp()` as never
        })
        .returning('job_id')
        .executeTakeFirstOrThrow();
      return result.job_id;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        ((error as { constraint?: unknown }).constraint ===
          'uq_durable_job_business_key' ||
          (error as { code?: unknown }).code === '23505')
      ) {
        throw new DurableJobRepositoryError('JOB_DUPLICATE_BUSINESS_KEY');
      }
      throw error;
    }
  }
}
