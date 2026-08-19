import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
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
import { PostgresCredentialRepository } from '../../src/modules/security/infrastructure/postgres-credential.repository.js';
import { PostgresCredentialSessionRepository } from '../../src/modules/security/infrastructure/postgres-credential-session.repository.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

const VALID_HASH =
  'argon2id$v=19,m=65536,t=3,p=4$c2FsdHNhbHRzYWx0$3q2+7wZGUN0eQPLzLQ1fQEG0aMP4XZKqNK0GKBKeLjg';

let fixture: PostgresFixture;
let platformPool: Pool;
let workerPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const credentials = new PostgresCredentialRepository();
const sessions = new PostgresCredentialSessionRepository();

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    return created.rows[0]!.uid as Uid;
  });
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  const evidence = await migrateAndValidate(fixture, {
    projectRoot,
    configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  expect(evidence.firstMigrate.appliedVersions).toEqual(
    expect.arrayContaining(['1', '2'])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-s21-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s21-platform'
  });
  workerPool = new Pool({
    connectionString: fixture.workerLogin.connectionString,
    max: 2,
    application_name: 'xht-s21-worker'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never,
        fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'recovery_cases',
    'security_locks',
    'credential_sessions',
    'payment_credentials',
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

describe.sequential('S2-1 credential contracts and V2 schema', () => {
  it('S2C01: V2 tables exist with expected constraints', async () => {
    const columns = await cleanupPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='payment_credentials'`
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain('hash_v1');
    expect(names).toContain('hash_algorithm');
    expect(names).toContain('cooldown_until');
    for (const forbidden of ['password', 'password_plain', 'pin', 'secret']) {
      expect(names).not.toContain(forbidden);
    }
    const policy = await unitOfWork.execute((context) =>
      credentials.activePolicy(context)
    );
    expect(policy).toMatchObject({
      policyVersion: 1,
      minDigits: 6,
      maxDigits: 8,
      maxFailedAttempts: 5,
      lockDurationSeconds: 900,
      cooldownSeconds: 86400
    });
  });

  it('S2C02: hash shape CHECK rejects malformed and plaintext hashes', async () => {
    const uid = await seedUser();
    await expect(
      cleanupPool.query(
        `INSERT INTO payment_credentials (uid, status, hash_v1, hash_algorithm, hash_param_version)
         VALUES ($1::uuid, 'ACTIVE', 'plaintext-password', 'argon2id', 1)`,
        [uid]
      )
    ).rejects.toMatchObject({ constraint: 'ck_payment_credentials_hash_shape' });
    await expect(
      cleanupPool.query(
        `INSERT INTO payment_credentials (uid, status)
         VALUES ($1::uuid, 'ACTIVE')`,
        [uid]
      )
    ).rejects.toMatchObject({ constraint: 'ck_payment_credentials_hash_shape' });
  });

  it('S2C03: lock shape CHECK and status CHECK reject inconsistent rows', async () => {
    const uid = await seedUser();
    await expect(
      cleanupPool.query(
        `INSERT INTO payment_credentials (uid, status, hash_v1, hash_algorithm, hash_param_version)
         VALUES ($1::uuid, 'WEIRD', $2, 'argon2id', 1)`,
        [uid, VALID_HASH]
      )
    ).rejects.toSatisfy(
      (error: { constraint?: string }) =>
        error.constraint === 'ck_payment_credentials_status' ||
        error.constraint === 'ck_payment_credentials_hash_shape'
    );
    await expect(
      cleanupPool.query(
        `INSERT INTO payment_credentials (uid, status, hash_v1, hash_algorithm, hash_param_version)
         VALUES ($1::uuid, 'LOCKED', $2, 'argon2id', 1)`,
        [uid, VALID_HASH]
      )
    ).rejects.toMatchObject({ constraint: 'ck_payment_credentials_lock_shape' });
  });

  it('S2C04: credential repository upsert/find/failure lifecycle', async () => {
    const uid = await seedUser();
    await unitOfWork.execute(async (context) => {
      await credentials.upsertActiveCredential(context, {
        uid,
        hashV1: VALID_HASH,
        hashAlgorithm: 'argon2id',
        hashParamVersion: 1
      });
    });
    const found = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    ).catch((error) => { console.log('STEP-FAIL find', String(error).slice(0,120)); throw error; });
    expect(found).toMatchObject({ status: 'ACTIVE', failedAttempts: 0 });
    if (process.env.T13_DEBUG) console.log('S2C04-upsert-ok');
    const lockUntil = new Date(Date.now() + 900_000);
    let attempts: number;
    try {
      attempts = await unitOfWork.execute((context) =>
        credentials.recordFailedAttempt(context, uid, lockUntil)
      );
    } catch (error) {
      console.log('FAIL-STEP recordFailedAttempt', String(error));
      throw error;
    }
    expect(attempts).toBe(1);
    const locked = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(locked?.status).toBe('LOCKED');
    expect(locked?.lockedUntil).not.toBeNull();
    await expect(
      unitOfWork.execute((context) =>
        credentials.upsertActiveCredential(context, {
          uid,
          hashV1: 'bad-shape',
          hashAlgorithm: 'argon2id',
          hashParamVersion: 1
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S2C05: session lifecycle with nonce uniqueness and transitions', async () => {
    const uid = await seedUser();
    const nonce = randomUUID();
    const session = await unitOfWork.execute((context) =>
      sessions.createSession(context, {
        uid,
        purpose: 'authorize-payment',
        orderRef: 'order-1',
        amountSummary: '100.50',
        assetSummary: 'USDT-TRC20',
        actionNonce: nonce,
        expiresAt: new Date(Date.now() + 300_000)
      })
    );
    expect(session.status).toBe('OPEN');
    await expect(
      unitOfWork.execute((context) =>
        sessions.createSession(context, {
          uid,
          purpose: 'credential-setup',
          actionNonce: nonce,
          expiresAt: new Date(Date.now() + 300_000)
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    await expect(
      unitOfWork.execute((context) =>
        sessions.createSession(context, {
          uid,
          purpose: 'authorize-payment',
          orderRef: null,
          amountSummary: null,
          assetSummary: null,
          actionNonce: randomUUID(),
          expiresAt: new Date(Date.now() + 300_000)
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    const confirmed = await unitOfWork.execute((context) =>
      sessions.transitionSession(context, session.sessionId, 'OPEN', 'CONFIRMED')
    );
    expect(confirmed).toBe(true);
    const stale = await unitOfWork.execute((context) =>
      sessions.transitionSession(context, session.sessionId, 'OPEN', 'CANCELLED')
    );
    expect(stale).toBe(false);
    const resolved = await unitOfWork.execute((context) =>
      sessions.findSession(context, session.sessionId)
    );
    expect(resolved?.status).toBe('CONFIRMED');
  });

  it('S2C06: decimal amount CHECK and recovery factors CHECK', async () => {
    const uid = await seedUser();
    await expect(
      cleanupPool.query(
        `INSERT INTO credential_sessions
           (uid, purpose, status, order_ref, amount_summary, asset_summary,
            action_nonce, expires_at)
         VALUES ($1::uuid, 'authorize-payment', 'OPEN', 'o', '12.3.4', 'USDT',
                 $2::uuid, clock_timestamp() + interval '5 minutes')`,
        [uid, randomUUID()]
      )
    ).rejects.toMatchObject({ constraint: 'ck_credential_sessions_amount_decimal' });
    await expect(
      cleanupPool.query(
        `INSERT INTO recovery_cases (uid, status, factors_achieved, factors_required)
         VALUES ($1::uuid, 'OPEN', 3, 2)`,
        [uid]
      )
    ).rejects.toMatchObject({ constraint: 'ck_recovery_cases_factors' });
    await expect(
      cleanupPool.query(
        `INSERT INTO recovery_cases (uid, status, factors_required)
         VALUES ($1::uuid, 'OPEN', 1)`,
        [uid]
      )
    ).rejects.toMatchObject({ constraint: 'ck_recovery_cases_factors' });
  });

  it('S2C07: worker role has zero access to credential tables', async () => {
    const workerClient = await workerPool.connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      await expect(
        workerClient.query('SELECT count(*) FROM payment_credentials')
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        workerClient.query('SELECT count(*) FROM credential_sessions')
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
    const platformClient = await platformPool.connect();
    try {
      await platformClient.query('SET ROLE xht_platform');
      await expect(
        platformClient.query('DELETE FROM payment_credentials')
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      platformClient.release();
    }
  });
});
