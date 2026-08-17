import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import type { StageOneDatabase, Uid } from '@xht/contracts';
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
import { PostgresIdentityRepository } from '../../src/modules/identity/infrastructure/postgres-identity.repository.js';
import { PostgresRegistrationIdempotencyRepository } from '../../src/modules/identity/infrastructure/postgres-registration-idempotency.repository.js';
import { createRegistrationKey } from '../../src/modules/identity/domain/identity.types.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const flywaySources = {
  projectRoot,
  configFile: 'database/flyway.toml',
  migrationsDirectory: 'database/migrations',
  callbacksDirectory: 'database/flyway-callbacks'
} as const;

const identityRepository = new PostgresIdentityRepository();
const idempotencyRepository = new PostgresRegistrationIdempotencyRepository();

let fixture: PostgresFixture;
let platformPool: Pool;
let workerPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;

async function insertActiveBinding(
  uid: string,
  externalUserId: string
): Promise<string> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ binding_id: string }>(
      `INSERT INTO channel_bindings
           (channel_type, external_user_id, uid, status)
         VALUES ('TELEGRAM', $1, $2::uuid, 'ACTIVE')
       RETURNING binding_id`,
      [externalUserId, uid]
    );
    return created.rows[0]!.binding_id;
  });
}

async function createUser(): Promise<string> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    return created.rows[0]!.uid;
  });
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
    application_name: 'xht-task7-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 5,
    application_name: 'xht-task7-platform'
  });
  workerPool = new Pool({
    connectionString: fixture.workerLogin.connectionString,
    max: 2,
    application_name: 'xht-task7-worker'
  });
  const platformKysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never,
        fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(platformKysely);
}, 180_000);

beforeEach(async () => {
  for (const table of [
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
  await workerPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('Task 7 identity contracts and constraints', () => {
  it('T7C11: rejects two active bindings for the same channel identity', async () => {
    const uidA = await createUser();
    const uidB = await createUser();
    await insertActiveBinding(uidA, '7001');
    await expect(insertActiveBinding(uidB, '7001')).rejects.toMatchObject({
      code: 'TRANSACTION_CALLBACK_FAILED'
    });
    const rows = await cleanupPool.query(
      `SELECT uid FROM channel_bindings WHERE external_user_id='7001'`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.uid).toBe(uidA);
  });

  it('T7C12: same uid may hold bindings for distinct external ids', async () => {
    const uid = await createUser();
    await insertActiveBinding(uid, '7101');
    await insertActiveBinding(uid, '7102');
    const rows = await cleanupPool.query(
      `SELECT count(*)::int AS n FROM channel_bindings WHERE uid = $1::uuid`,
      [uid]
    );
    expect(rows.rows[0]?.n).toBe(2);
  });

  it('T7C13: revocation CHECK enforces revoked_at consistency', async () => {
    const uid = await createUser();
    await expect(
      cleanupPool.query(
        `INSERT INTO channel_bindings (channel_type, external_user_id, uid, status)
         VALUES ('TELEGRAM', '7201', $1::uuid, 'REVOKED')`,
        [uid]
      )
    ).rejects.toMatchObject({ constraint: 'ck_channel_bindings_revocation' });
    await expect(
      cleanupPool.query(
        `INSERT INTO channel_bindings
           (channel_type, external_user_id, uid, status, revoked_at)
         VALUES ('TELEGRAM', '7202', $1::uuid, 'ACTIVE', clock_timestamp())`,
        [uid]
      )
    ).rejects.toMatchObject({ constraint: 'ck_channel_bindings_revocation' });
  });

  it('T7C14: memberships enforces one row per uid', async () => {
    const uid = await createUser();
    await cleanupPool.query(
      `INSERT INTO memberships (uid, status) VALUES ($1::uuid, 'ACTIVE')`,
      [uid]
    );
    await expect(
      cleanupPool.query(
        `INSERT INTO memberships (uid, status) VALUES ($1::uuid, 'ACTIVE')`,
        [uid]
      )
    ).rejects.toMatchObject({ constraint: 'uq_memberships_uid' });
  });

  it('T7C15: channel_bindings FK rejects unknown uid', async () => {
    await expect(
      insertActiveBinding(randomUUID(), '7301')
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('T7C16: registration_idempotency NULL combinations enforced by CHECK', async () => {
    await expect(
      cleanupPool.query(
        `INSERT INTO registration_idempotency
           (registration_key, channel_type, external_user_id, status, uid)
         VALUES ($1::uuid, 'TELEGRAM', '7401', 'FAILED', $2::uuid)`,
        [randomUUID(), await createUser()]
      )
    ).rejects.toMatchObject({ constraint: 'ck_registration_outcome' });
    await expect(
      cleanupPool.query(
        `INSERT INTO registration_idempotency
           (registration_key, channel_type, external_user_id, status,
            uid, completed_at, failure_code)
         VALUES ($1::uuid, 'TELEGRAM', '7402', 'COMPLETED', $2::uuid,
                 clock_timestamp(), 'boom')`,
        [randomUUID(), await createUser()]
      )
    ).rejects.toMatchObject({ constraint: 'ck_registration_outcome' });
  });

  it('T7C17/18: tryAcquire and complete lifecycle with findCompleted readback', async () => {
    const key = createRegistrationKey('telegram', '7501');
    const first = await unitOfWork.execute((context) =>
      idempotencyRepository.tryAcquire(context, key)
    );
    expect(first).toBe('acquired');
    const second = await unitOfWork.execute((context) =>
      idempotencyRepository.tryAcquire(context, key)
    );
    expect(second).toBe('in_progress');
    const uid = await unitOfWork.execute((context) =>
      identityRepository.createUser(context)
    );
    const completed = await unitOfWork.execute((context) =>
      idempotencyRepository.complete(context, key, uid as Uid)
    );
    expect(completed).toBe(true);
    const repeated = await unitOfWork.execute((context) =>
      idempotencyRepository.tryAcquire(context, key)
    );
    expect(repeated).toBe('completed');
    const readBack = await unitOfWork.execute((context) =>
      idempotencyRepository.findCompleted(context, key)
    );
    expect(readBack?.uid).toBe(uid);
  });

  it('T7C19: upsertProfileSnapshot updates without duplicating rows', async () => {
    const uid = await createUser();
    await unitOfWork.execute(async (context) => {
      await identityRepository.upsertProfileSnapshot(context, uid as Uid, {
        username: 'first',
        displayName: 'First'
      });
    });
    await unitOfWork.execute(async (context) => {
      await identityRepository.upsertProfileSnapshot(context, uid as Uid, {
        username: 'second',
        displayName: 'Second'
      });
    });
    const rows = await cleanupPool.query(
      `SELECT username_snapshot, display_name_snapshot FROM identity_profiles WHERE uid=$1::uuid`,
      [uid]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.username_snapshot).toBe('second');
  });

  it('T7C20: identity module sources contain zero Telegram references', async () => {
    const files = [
      'domain/identity.types.ts',
      'domain/identity.errors.ts',
      'application/identity.repository.ts',
      'infrastructure/postgres-identity.repository.ts',
      'infrastructure/postgres-registration-idempotency.repository.ts'
    ];
    for (const file of files) {
      const content = await readFile(
        resolve(projectRoot, 'apps/platform/src/modules/identity', file),
        'utf8'
      );
      expect(
        content.match(/grammy|Update|Chat|Message/gu) ?? []
      ).toEqual([]);
    }
  });

  it('T7C21: platform cannot DELETE identity rows; worker is read-only on bindings', async () => {
    const uid = await createUser();
    await insertActiveBinding(uid, '7601');
    const platformClient = await platformPool.connect();
    try {
      await platformClient.query('SET ROLE xht_platform');
      await expect(
        platformClient.query(`DELETE FROM channel_bindings`)
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      platformClient.release();
    }
    const workerClient = await workerPool.connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      const readable = await workerClient.query(
        `SELECT count(*)::int AS n FROM channel_bindings`
      );
      expect(readable.rows[0]?.n).toBe(1);
      await expect(
        workerClient.query(
          `INSERT INTO channel_bindings
             (channel_type, external_user_id, uid, status)
           VALUES ('TELEGRAM', '7602', $1::uuid, 'ACTIVE')`,
          [uid]
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
  });
});
