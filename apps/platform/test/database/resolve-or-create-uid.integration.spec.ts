import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { ResolveOrCreateUidCommand, StageOneDatabase } from '@xht/contracts';
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
import { PostgresOutboxRepository } from '../../src/modules/reliability/outbox/outbox.repository.js';
import { PostgresIdentityRepository } from '../../src/modules/identity/infrastructure/postgres-identity.repository.js';
import { PostgresRegistrationIdempotencyRepository } from '../../src/modules/identity/infrastructure/postgres-registration-idempotency.repository.js';
import { ResolveOrCreateUid } from '../../src/modules/identity/application/resolve-or-create-uid.js';
import { injectedIdentityIdFactory } from '../../src/modules/identity/application/identity-event-factory.js';
import { createRegistrationKey } from '../../src/modules/identity/domain/identity.types.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const flywaySources = {
  projectRoot,
  configFile: 'database/flyway.toml',
  migrationsDirectory: 'database/migrations',
  callbacksDirectory: 'database/flyway-callbacks'
} as const;

function command(overrides: {
  externalUserId: string;
  username: string | null;
  sourceMessageId?: string;
}): ResolveOrCreateUidCommand {
  return {
    channelType: 'telegram',
    externalUserId: overrides.externalUserId,
    sourceMessageId: overrides.sourceMessageId ?? `update-${overrides.externalUserId}`,
    username: overrides.username,
    displayName: 'Synthetic User',
    correlationId: randomUUID(),
    occurredAt: '2026-08-17T12:00:00.000Z'
  };
}

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
let unitOfWorkB: UnitOfWork;
let resolveOrCreate: ResolveOrCreateUid;

function makeUnitOfWork(pool: Pool): UnitOfWork {
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        pool as never,
        fixture.platformLogin.username
      )
    })
  });
  return createUnitOfWork(kysely);
}

async function execute(commandInput: ResolveOrCreateUidCommand) {
  return unitOfWork.execute((context) =>
    resolveOrCreate.execute(context, commandInput)
  );
}

async function countRows(sql: string, values?: ReadonlyArray<unknown>): Promise<number> {
  const result = await cleanupPool.query(`SELECT count(*)::int AS n ${sql}`, values as unknown[]);
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
    application_name: 'xht-task8-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 5,
    application_name: 'xht-task8-platform'
  });
  unitOfWork = makeUnitOfWork(platformPool);
  unitOfWorkB = makeUnitOfWork(platformPool);
  resolveOrCreate = new ResolveOrCreateUid(
    new PostgresIdentityRepository(),
    new PostgresRegistrationIdempotencyRepository(),
    new PostgresOutboxRepository(),
    injectedIdentityIdFactory
  );
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'outbox_messages',
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

describe.sequential('Task 8 ResolveOrCreateUid', () => {
  it('T8C01: first execution creates the full five-piece set exactly once', async () => {
    const result = await execute(command({ externalUserId: '8001', username: 'old_name' }));
    expect(result).toMatchObject({ created: true });
    expect(
      await countRows('FROM users')
    ).toBe(1);
    expect(await countRows('FROM memberships')).toBe(1);
    expect(await countRows("FROM channel_bindings WHERE status='ACTIVE'")).toBe(1);
    expect(await countRows("FROM registration_idempotency WHERE status='COMPLETED'")).toBe(1);
    expect(await countRows("FROM outbox_messages WHERE topic='identity.uid-created.v1'")).toBe(1);
  });

  it('T8C02: repeat execution returns the same uid with one seen event', async () => {
    const first = await execute(command({ externalUserId: '8002', username: 'a', sourceMessageId: 'u-8002-1' }));
    expect(first).toMatchObject({ created: true });
    const second = await execute(command({ externalUserId: '8002', username: 'a', sourceMessageId: 'u-8002-2' }));
    expect(second).toMatchObject({ created: false, uid: (first as { uid: string }).uid });
    expect(await countRows("FROM outbox_messages WHERE topic='identity.uid-created.v1'")).toBe(1);
    expect(await countRows("FROM outbox_messages WHERE topic='identity.telegram-user-seen.v1'")).toBe(1);
  });

  it('T8C03: username change keeps uid and updates the snapshot only', async () => {
    const first = await execute(command({ externalUserId: '8003', username: 'old_name', sourceMessageId: 'u-8003-1' }));
    await execute(command({ externalUserId: '8003', username: 'new_name', sourceMessageId: 'u-8003-2' }));
    const uid = (first as { uid: string }).uid;
    const snapshot = await cleanupPool.query(
      'SELECT username_snapshot FROM identity_profiles WHERE uid=$1::uuid',
      [uid]
    );
    expect(snapshot.rows[0]?.username_snapshot).toBe('new_name');
    expect(await countRows('FROM users')).toBe(1);
  });

  it('T8C04: null username resolves with a NULL snapshot', async () => {
    const result = await execute(command({ externalUserId: '8004', username: null }));
    expect(result).toMatchObject({ created: true });
    const snapshot = await cleanupPool.query(
      'SELECT username_snapshot FROM identity_profiles'
    );
    expect(snapshot.rows[0]?.username_snapshot).toBeNull();
  });

  it('T8C05: outbox enqueue failure rolls back the whole transaction atomically', async () => {
    const first = await execute(command({ externalUserId: '8005', username: 'before', sourceMessageId: 'u-8005-1' }));
    const uid = (first as { uid: string }).uid;
    // Pre-occupy the deterministic telegram-seen event key for update "dup".
    await cleanupPool.query(
      `INSERT INTO outbox_messages
         (outbox_id, topic, event_key, version, payload, correlation_id,
          status, attempt_count, available_at)
       VALUES ($1::uuid, 'identity.telegram-user-seen.v1', 'telegram-seen:dup',
               1, '{}'::jsonb, $2::uuid, 'READY', 0, clock_timestamp())`,
      [randomUUID(), randomUUID()]
    );
    await expect(
      execute(command({ externalUserId: '8005', username: 'after', sourceMessageId: 'dup' }))
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    // The snapshot update must have rolled back with the failed enqueue.
    const snapshot = await cleanupPool.query(
      'SELECT username_snapshot FROM identity_profiles WHERE uid=$1::uuid',
      [uid]
    );
    expect(snapshot.rows[0]?.username_snapshot).toBe('before');
    expect(await countRows("FROM outbox_messages WHERE topic='identity.telegram-user-seen.v1'")).toBe(1);
  });

  it('T8C06: a PROCESSING placeholder yields zero writes and stable in_progress', async () => {
    const key8007 = createRegistrationKey('telegram', '8007');
    await cleanupPool.query(
      `INSERT INTO registration_idempotency
         (registration_key, channel_type, external_user_id, status)
       VALUES ($1::uuid, 'TELEGRAM', '8007', 'PROCESSING')`,
      [key8007.registrationKey]
    );
    const result = await execute(command({ externalUserId: '8007', username: 'x' }));
    expect(result).toEqual({ status: 'in_progress' });
    expect(await countRows('FROM users')).toBe(0);
    expect(await countRows('FROM channel_bindings')).toBe(0);
    expect(await countRows('FROM outbox_messages')).toBe(0);
  });

  it('T8C07: after the placeholder is cleared a retry becomes the owner', async () => {
    const key8008 = createRegistrationKey('telegram', '8008');
    await cleanupPool.query(
      `INSERT INTO registration_idempotency
         (registration_key, channel_type, external_user_id, status)
       VALUES ($1::uuid, 'TELEGRAM', '8008', 'PROCESSING')`,
      [key8008.registrationKey]
    );
    await execute(command({ externalUserId: '8008', username: 'x' }));
    await cleanupPool.query(`DELETE FROM registration_idempotency`);
    const result = await execute(command({ externalUserId: '8008', username: 'x' }));
    expect(result).toMatchObject({ created: true });
  });

  it('T8C08/T8C10: two concurrent executions yield exactly one uid and no cross-talk', async () => {
    const [a, b] = await Promise.all([
      unitOfWork.execute((context) =>
        resolveOrCreate.execute(context, command({ externalUserId: '8009', username: 'a', sourceMessageId: 'u-8009-a' }))
      ),
      unitOfWorkB.execute((context) =>
        resolveOrCreate.execute(context, command({ externalUserId: '8009', username: 'a', sourceMessageId: 'u-8009-b' }))
      )
    ]);
    const created = [a, b].filter((r) => 'created' in r && r.created);
    expect(created).toHaveLength(1);
    if ('uid' in a && 'uid' in b) {
      expect((a as { uid: string }).uid).toBe((b as { uid: string }).uid);
    }
    expect(await countRows('FROM users')).toBe(1);
    expect(await countRows("FROM outbox_messages WHERE topic='identity.uid-created.v1'")).toBe(1);
    const other = await execute(command({ externalUserId: '8010', username: 'b', sourceMessageId: 'u-8010' }));
    expect(other).toMatchObject({ created: true });
    expect(await countRows('FROM users')).toBe(2);
  });

  it('T8C09: orchestration source stays pure (no bot calls, no audit, no BEGIN)', async () => {
    for (const file of ['identity-event-factory.ts', 'resolve-or-create-uid.ts']) {
      const content = await readFile(
        resolve(projectRoot, 'apps/platform/src/modules/identity/application', file),
        'utf8'
      );
      expect(content.match(/sendMessage|getMe|bot\.|audit_events|BEGIN/iu) ?? []).toEqual([]);
    }
  });
});
