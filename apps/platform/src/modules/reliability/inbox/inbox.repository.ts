import { timingSafeEqual } from 'node:crypto';
import { isProxy } from 'node:util/types';
import { sql } from 'kysely';
import {
  isInboxDigestKeyVersion,
  isInboxPayloadDigest,
  type InboxDigestCandidate,
  type InboxDigestKeyVersion,
  type InboxDigestSet
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import {
  InboxRepositoryError,
  type InboxClaimCommand,
  type InboxClaimLease,
  type InboxClaimResult,
  type InboxRepository,
  type InboxStatus,
  type MarkInboxProcessedCommand
} from './inbox.types.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalidCommand(): never {
  throw new InboxRepositoryError('INBOX_COMMAND_INVALID');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) invalidCommand();
  if (isProxy(value)) invalidCommand();
  if (Array.isArray(value)) invalidCommand();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidCommand();
  return value as Record<string, unknown>;
}

function data(recordValue: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(recordValue, key);
  if (descriptor === undefined || !('value' in descriptor)) invalidCommand();
  return descriptor.value;
}

function stringField(
  recordValue: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): string {
  const value = data(recordValue, key);
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    invalidCommand();
  }
  return value;
}

function finiteDate(value: unknown): Date {
  if (typeof value !== 'object' || value === null) invalidCommand();
  if (isProxy(value)) invalidCommand();
  if (Object.getPrototypeOf(value) !== Date.prototype) invalidCommand();
  if (Reflect.ownKeys(value).length !== 0) invalidCommand();
  let milliseconds: number;
  try {
    milliseconds = Date.prototype.getTime.call(value);
  } catch {
    invalidCommand();
  }
  if (!Number.isFinite(milliseconds)) invalidCommand();
  return new Date(milliseconds);
}

function candidate(value: unknown): InboxDigestCandidate {
  const candidateRecord = record(value);
  const keyVersion = data(candidateRecord, 'keyVersion');
  const payloadDigest = data(candidateRecord, 'payloadDigest');
  if (
    typeof keyVersion !== 'string' ||
    typeof payloadDigest !== 'string' ||
    !isInboxDigestKeyVersion(keyVersion) ||
    !isInboxPayloadDigest(payloadDigest)
  ) {
    invalidCommand();
  }
  return Object.freeze({ keyVersion, payloadDigest });
}

function denseDataArray(value: unknown): readonly unknown[] {
  if (typeof value !== 'object' || value === null) invalidCommand();
  if (isProxy(value)) invalidCommand();
  if (!Array.isArray(value)) invalidCommand();
  if (Object.getOwnPropertySymbols(value).length !== 0) invalidCommand();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1
  ) invalidCommand();
  const length = lengthDescriptor.value;
  const ownNames = Object.getOwnPropertyNames(value);
  if (ownNames.length !== length + 1) invalidCommand();
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) invalidCommand();
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

function digestSet(value: unknown): InboxDigestSet {
  const digestRecord = record(value);
  const current = candidate(data(digestRecord, 'current'));
  const rawCandidates = denseDataArray(data(digestRecord, 'comparisonCandidates'));
  const comparisonCandidates = rawCandidates.map((value) => candidate(value));
  const versions = new Set<string>();
  let currentMatches = 0;
  for (const comparisonCandidate of comparisonCandidates) {
    if (versions.has(comparisonCandidate.keyVersion)) invalidCommand();
    versions.add(comparisonCandidate.keyVersion);
    if (
      comparisonCandidate.keyVersion === current.keyVersion &&
      comparisonCandidate.payloadDigest === current.payloadDigest
    ) currentMatches += 1;
  }
  if (currentMatches !== 1) invalidCommand();
  return Object.freeze({
    current,
    comparisonCandidates: Object.freeze(comparisonCandidates)
  });
}

function parseClaimCommand(value: unknown): InboxClaimCommand {
  try {
    const commandRecord = record(value);
    const consumer = stringField(commandRecord, 'consumer', 1, 100);
    const externalMessageId = stringField(commandRecord, 'externalMessageId', 1, 255);
    const claimant = stringField(commandRecord, 'claimant', 1, 128);
    const correlationId = stringField(commandRecord, 'correlationId', 36, 36);
    if (!UUID_PATTERN.test(correlationId)) invalidCommand();
    return Object.freeze({
      consumer,
      externalMessageId,
      digests: digestSet(data(commandRecord, 'digests')),
      correlationId,
      claimant,
      receivedAt: finiteDate(data(commandRecord, 'receivedAt'))
    });
  } catch {
    invalidCommand();
  }
}

function parseMarkCommand(value: unknown): MarkInboxProcessedCommand {
  try {
    const commandRecord = record(value);
    const leaseRecord = record(data(commandRecord, 'lease'));
    const inboxId = stringField(leaseRecord, 'inboxId', 36, 36);
    const claimant = stringField(leaseRecord, 'claimant', 1, 128);
    const generation = data(leaseRecord, 'generation');
    if (
      !UUID_PATTERN.test(inboxId) ||
      typeof generation !== 'number' ||
      !Number.isSafeInteger(generation) ||
      generation < 1
    ) invalidCommand();
    return Object.freeze({
      lease: Object.freeze({
        inboxId,
        claimant,
        generation,
        claimedUntil: finiteDate(data(leaseRecord, 'claimedUntil'))
      })
    });
  } catch {
    invalidCommand();
  }
}

function digestsMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  try {
    return (
      leftBytes.byteLength === rightBytes.byteLength &&
      timingSafeEqual(leftBytes, rightBytes)
    );
  } finally {
    leftBytes.fill(0);
    rightBytes.fill(0);
  }
}

function candidateFor(
  digests: InboxDigestSet,
  version: InboxDigestKeyVersion
): InboxDigestCandidate | undefined {
  return digests.comparisonCandidates.find(
    (candidate) => candidate.keyVersion === version
  );
}

function lease(
  inboxId: string,
  claimant: string,
  generation: number,
  claimedUntil: Date
): InboxClaimLease {
  return Object.freeze({
    inboxId,
    claimant,
    generation,
    claimedUntil: new Date(claimedUntil.getTime())
  });
}

export class PostgresInboxRepository implements InboxRepository {
  async claim(
    context: TransactionContext,
    command: InboxClaimCommand
  ): Promise<InboxClaimResult> {
    const input = parseClaimCommand(command as unknown);
    const inserted = await context.database
      .insertInto('inbox_messages')
      .values({
        consumer: input.consumer,
        external_message_id: input.externalMessageId,
        payload_digest: input.digests.current.payloadDigest,
        digest_key_version: input.digests.current.keyVersion,
        correlation_id: input.correlationId,
        status: 'CLAIMED',
        received_at: input.receivedAt,
        claimed_by: input.claimant,
        claim_generation: 1,
        claimed_until: sql<Date>`clock_timestamp() + interval '30 seconds'`,
        processed_at: null,
        failure_code: null
      })
      .onConflict((conflict) => conflict
        .columns(['consumer', 'external_message_id'])
        .doNothing())
      .returning(['inbox_id', 'claim_generation', 'claimed_until'])
      .executeTakeFirst();

    if (inserted !== undefined && inserted.claimed_until !== null) {
      const newLease = lease(
        inserted.inbox_id,
        input.claimant,
        inserted.claim_generation,
        inserted.claimed_until
      );
      return Object.freeze({
        kind: 'claimed',
        inboxId: inserted.inbox_id,
        lease: newLease,
        reclaimed: false
      });
    }

    const existing = await context.database
      .selectFrom('inbox_messages')
      .select([
        'inbox_id',
        'payload_digest',
        'digest_key_version',
        'status',
        'claimed_by',
        'claim_generation',
        'claimed_until'
      ])
      .where('consumer', '=', input.consumer)
      .where('external_message_id', '=', input.externalMessageId)
      .forUpdate()
      .executeTakeFirst();

    if (existing === undefined) {
      throw new InboxRepositoryError('INBOX_ROW_DISAPPEARED');
    }
    if (!isInboxDigestKeyVersion(existing.digest_key_version)) {
      throw new InboxRepositoryError('INBOX_STATE_INVALID');
    }
    const comparable = candidateFor(
      input.digests,
      existing.digest_key_version
    );
    if (comparable === undefined) {
      return Object.freeze({
        kind: 'digest_key_unavailable',
        inboxId: existing.inbox_id,
        requiredKeyVersion: existing.digest_key_version
      });
    }
    if (!digestsMatch(existing.payload_digest, comparable.payloadDigest)) {
      return Object.freeze({
        kind: 'conflict',
        inboxId: existing.inbox_id
      });
    }

    if (existing.status === 'RECEIVED') {
      const transitioned = await context.executeSql<{
        readonly inbox_id: string;
        readonly claim_generation: number;
        readonly claimed_until: Date;
      }>(
        `WITH database_time AS (
           SELECT clock_timestamp() AS value
         )
         UPDATE inbox_messages AS inbox
            SET status = 'CLAIMED',
                claimed_by = $2,
                claim_generation = inbox.claim_generation + 1,
                claimed_until = database_time.value + interval '30 seconds',
                processed_at = NULL,
                failure_code = NULL
           FROM database_time
          WHERE inbox.inbox_id = $1::uuid
            AND inbox.status = 'RECEIVED'
            AND inbox.claim_generation = $3
            AND inbox.claimed_by IS NULL
            AND inbox.claimed_until IS NULL
         RETURNING inbox.inbox_id, inbox.claim_generation, inbox.claimed_until`,
        [existing.inbox_id, input.claimant, existing.claim_generation]
      );
      const updated = transitioned.rows[0];
      if (transitioned.rows.length !== 1 || updated === undefined) {
        throw new InboxRepositoryError('INBOX_STATE_INVALID');
      }
      const newLease = lease(
        updated.inbox_id,
        input.claimant,
        updated.claim_generation,
        updated.claimed_until
      );
      return Object.freeze({
        kind: 'claimed',
        inboxId: updated.inbox_id,
        lease: newLease,
        reclaimed: false
      });
    }

    if (existing.status === 'CLAIMED') {
      if (existing.claimed_by === null || existing.claimed_until === null) {
        throw new InboxRepositoryError('INBOX_STATE_INVALID');
      }
      const transitioned = await context.executeSql<{
        readonly inbox_id: string;
        readonly claim_generation: number;
        readonly claimed_until: Date;
      }>(
        `WITH database_time AS (
           SELECT clock_timestamp() AS value
         )
         UPDATE inbox_messages AS inbox
            SET claimed_by = $2,
                claim_generation = inbox.claim_generation + 1,
                claimed_until = database_time.value + interval '30 seconds'
           FROM database_time
          WHERE inbox.inbox_id = $1::uuid
            AND inbox.status = 'CLAIMED'
            AND inbox.claim_generation = $3
            AND inbox.claimed_by = $4
            AND inbox.claimed_until <= database_time.value
         RETURNING inbox.inbox_id, inbox.claim_generation, inbox.claimed_until`,
        [
          existing.inbox_id,
          input.claimant,
          existing.claim_generation,
          existing.claimed_by
        ]
      );
      const updated = transitioned.rows[0];
      if (transitioned.rows.length === 1 && updated !== undefined) {
        const newLease = lease(
          updated.inbox_id,
          input.claimant,
          updated.claim_generation,
          updated.claimed_until
        );
        return Object.freeze({
          kind: 'claimed',
          inboxId: updated.inbox_id,
          lease: newLease,
          reclaimed: true
        });
      }
      if (transitioned.rows.length !== 0) {
        throw new InboxRepositoryError('INBOX_STATE_INVALID');
      }
    }

    return Object.freeze({
      kind: 'duplicate_same_payload',
      inboxId: existing.inbox_id,
      status: existing.status as InboxStatus
    });
  }

  async markProcessed(
    context: TransactionContext,
    command: MarkInboxProcessedCommand
  ): Promise<boolean> {
    const input = parseMarkCommand(command as unknown);
    const updated = await context.executeSql<{ readonly inbox_id: string }>(
      `WITH database_time AS (
         SELECT clock_timestamp() AS value
       )
       UPDATE inbox_messages AS inbox
          SET status = 'PROCESSED',
              claimed_by = NULL,
              claimed_until = NULL,
              processed_at = database_time.value,
              failure_code = NULL
         FROM database_time
        WHERE inbox.inbox_id = $1::uuid
          AND inbox.status = 'CLAIMED'
          AND inbox.claimed_by = $2
          AND inbox.claim_generation = $3
          AND inbox.claimed_until > database_time.value
       RETURNING inbox.inbox_id`,
      [input.lease.inboxId, input.lease.claimant, input.lease.generation]
    );
    return updated.rows.length === 1;
  }
}
