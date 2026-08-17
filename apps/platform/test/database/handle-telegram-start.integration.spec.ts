import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  HandleTelegramStartCommand,
  StageOneDatabase
} from '@xht/contracts';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoleEnforcingPostgresPool } from '../../src/infrastructure/database/database.js';
import {
  createUnitOfWork,
  type UnitOfWork
} from '../../src/infrastructure/database/unit-of-work.js';
import { PostgresInboxRepository } from '../../src/modules/reliability/inbox/inbox.repository.js';
import { PostgresOutboxRepository } from '../../src/modules/reliability/outbox/outbox.repository.js';
import { PostgresIdentityRepository } from '../../src/modules/identity/infrastructure/postgres-identity.repository.js';
import { PostgresRegistrationIdempotencyRepository } from '../../src/modules/identity/infrastructure/postgres-registration-idempotency.repository.js';
import { ResolveOrCreateUid } from '../../src/modules/identity/application/resolve-or-create-uid.js';
import { injectedIdentityIdFactory } from '../../src/modules/identity/application/identity-event-factory.js';
import { HandleTelegramStart } from '../../src/modules/telegram/application/handle-telegram-start.js';
import { toWebhookOutcome } from '../../src/modules/telegram/http/telegram-webhook.controller.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const flywaySources = {
  projectRoot,
  configFile: 'database/flyway.toml',
  migrationsDirectory: 'database/migrations',
  callbacksDirectory: 'database/flyway-callbacks'
} as const;

function digestSet(digest: string): {
  current: { keyVersion: string; payloadDigest: string };
  comparisonCandidates: ReadonlyArray<{ keyVersion: string; payloadDigest: string }>;
} {
  return {
    current: { keyVersion: 'v1', payloadDigest: digest },
    comparisonCandidates: [{ keyVersion: 'v1', payloadDigest: digest }]
  };
}

function startCommand(overrides: {
  updateId: string;
  externalUserId: string;
  digest?: string;
}): HandleTelegramStartCommand {
  return {
    updateId: overrides.updateId,
    externalUserId: overrides.externalUserId,
    chatId: overrides.externalUserId,
    username: 'synthetic_user',
    displayName: 'Synthetic User',
    inboxDigests: digestSet(overrides.digest ?? `hmac-sha256:${'a'.repeat(43)}`),
    correlationId: randomUUID(),
    receivedAt: new Date('2026-08-17T12:00:00.000Z'),
    claimant: 'telegram-webhook-v1'
  };
}

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let handler: HandleTelegramStart;

async function countRows(sql: string): Promise<number> {
  const result = await cleanupPool.query(`SELECT count(*)::int AS n ${sql}`);
  return result.rows[0]?.n ?? 0;
}

async function countTopic(topic: string): Promise<number> {
  const result = await cleanupPool.query(
    'SELECT count(*)::int AS n FROM outbox_messages WHERE topic = $1',
    [topic]
  );
  return result.rows[0]?.n ?? 0;
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, flywaySources);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-task10-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 5,
    application_name: 'xht-task10-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never,
        fixture.platformLogin.username
      )
    })
  });
  const unitOfWork: UnitOfWork = createUnitOfWork(kysely);
  handler = new HandleTelegramStart(
    unitOfWork,
    new PostgresInboxRepository(),
    new ResolveOrCreateUid(
      new PostgresIdentityRepository(),
      new PostgresRegistrationIdempotencyRepository(),
      new PostgresOutboxRepository(),
      injectedIdentityIdFactory
    ),
    new PostgresOutboxRepository(),
    injectedIdentityIdFactory
  );
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'outbox_messages',
    'inbox_messages',
    'registration_idempotency',
    'channel_bindings',
    'identity_profiles',
    'memberships',
    'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('Task 10 HandleTelegramStart', () => {
  it('T10C01: first /start is atomic across inbox, identity and outbox', async () => {
    const result = await handler.execute(
      startCommand({ updateId: '9100', externalUserId: '8100' })
    );
    expect(result).toMatchObject({ kind: 'processed', created: true });
    expect(await countRows('FROM inbox_messages WHERE status=\'PROCESSED\'')).toBe(1);
    expect(await countRows('FROM users')).toBe(1);
    expect(await countRows('FROM memberships')).toBe(1);
    expect(await countRows('FROM channel_bindings')).toBe(1);
    expect(await countTopic('identity.uid-created.v1')).toBe(1);
    expect(await countTopic('telegram.main-menu-requested.v1')).toBe(1);
  });

  it('T10C02: duplicated same-payload update is a safe no-op', async () => {
    const command = startCommand({ updateId: '9101', externalUserId: '8101' });
    await handler.execute(command);
    const duplicate = await handler.execute(command);
    expect(duplicate).toMatchObject({ kind: 'duplicate_same_payload' });
    expect(await countRows('FROM users')).toBe(1);
    expect(await countTopic('telegram.main-menu-requested.v1')).toBe(1);
    expect(toWebhookOutcome(duplicate).status).toBe(200);
  });

  it('T10C03: conflicting payload has zero effects', async () => {
    await handler.execute(
      startCommand({ updateId: '9102', externalUserId: '8102', digest: `hmac-sha256:${'b'.repeat(43)}` })
    );
    const conflict = await handler.execute(
      startCommand({ updateId: '9102', externalUserId: '8102', digest: `hmac-sha256:${'c'.repeat(43)}` })
    );
    expect(conflict).toMatchObject({ kind: 'conflict' });
    expect(await countRows('FROM users')).toBe(1);
    expect(await countTopic('telegram.main-menu-requested.v1')).toBe(1);
    expect(toWebhookOutcome(conflict).status).toBe(200);
  });

  it('T10C04: retained key unavailable maps to 503 with zero effects', async () => {
    await cleanupPool.query(
      `INSERT INTO inbox_messages
         (inbox_id, consumer, external_message_id, payload_digest,
          digest_key_version, correlation_id, status, received_at)
       VALUES ($1::uuid, 'telegram-webhook-v1', '9103',
               $2, 'v9', $3::uuid, 'RECEIVED', clock_timestamp())`,
      [randomUUID(), `hmac-sha256:${'d'.repeat(43)}`, randomUUID()]
    );
    const result = await handler.execute(
      startCommand({ updateId: '9103', externalUserId: '8103' })
    );
    expect(result).toMatchObject({ kind: 'digest_key_unavailable' });
    expect(await countRows('FROM users')).toBe(0);
    expect(await countRows('FROM outbox_messages')).toBe(0);
    expect(
      await countRows("FROM inbox_messages WHERE status='RECEIVED'")
    ).toBe(1);
    expect(toWebhookOutcome(result).status).toBe(503);
  });

  it('T10C05: mid-orchestration failure rolls the whole transaction back', async () => {
    // Pre-occupy the deterministic menu event key so the enqueue fails after
    // identity writes have already happened inside the same transaction.
    await cleanupPool.query(
      `INSERT INTO outbox_messages
         (outbox_id, topic, event_key, version, payload, correlation_id,
          status, attempt_count, available_at)
       VALUES ($1::uuid, 'telegram.main-menu-requested.v1', 'telegram:menu:9104',
               1, '{}'::jsonb, $2::uuid, 'READY', 0, clock_timestamp())`,
      [randomUUID(), randomUUID()]
    );
    await expect(
      handler.execute(startCommand({ updateId: '9104', externalUserId: '8104' }))
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    expect(await countRows('FROM users')).toBe(0);
    expect(await countRows('FROM memberships')).toBe(0);
    expect(await countRows('FROM channel_bindings')).toBe(0);
    expect(await countRows('FROM registration_idempotency')).toBe(0);
    expect(await countRows('FROM inbox_messages')).toBe(0);
  });

  it('T10C07: existing user /start again creates no second uid', async () => {
    await handler.execute(
      startCommand({ updateId: '9105', externalUserId: '8105' })
    );
    const second = await handler.execute(
      startCommand({ updateId: '9106', externalUserId: '8105' })
    );
    expect(second).toMatchObject({ kind: 'processed', created: false });
    expect(await countRows('FROM users')).toBe(1);
    expect(await countTopic('identity.uid-created.v1')).toBe(1);
    expect(await countTopic('identity.telegram-user-seen.v1')).toBe(1);
    expect(await countTopic('telegram.main-menu-requested.v1')).toBe(2);
  });

  it('T10C08: commands carrying sensitive keys are rejected before any write', async () => {
    const poisoned = {
      ...startCommand({ updateId: '9107', externalUserId: '8107' }),
      rawUpdate: { message: 'leak' }
    } as unknown as HandleTelegramStartCommand;
    await expect(handler.execute(poisoned)).rejects.toMatchObject({
      code: 'TRANSACTION_CALLBACK_FAILED'
    });
    expect(await countRows('FROM inbox_messages')).toBe(0);
    expect(await countRows('FROM users')).toBe(0);
  });
});
