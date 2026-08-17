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
import { VerifyPaymentCredential } from '../../src/modules/security/application/verify-payment-credential.js';
import { hashCredentialDigits } from '../../src/modules/security/domain/credential-hash.js';
import { CredentialEntryBuffer } from '../../src/modules/security/domain/credential-processor.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

async function digitsBuffer(digits: string): Promise<CredentialEntryBuffer> {
  const buffer = new CredentialEntryBuffer();
  for (const digit of digits) buffer.appendDigit(digit);
  return buffer;
}

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const credentials = new PostgresCredentialRepository();
let verifier: VerifyPaymentCredential;

async function seedCredential(digits: string): Promise<Uid> {
  const uid = await unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    return created.rows[0]!.uid as Uid;
  });
  const hashed = await hashCredentialDigits(
    (() => {
      const bytes = new Uint8Array(digits.length);
      for (let index = 0; index < digits.length; index += 1) {
        bytes[index] = digits.charCodeAt(index);
      }
      return bytes;
    })()
  );
  await unitOfWork.execute(async (context) => {
    await credentials.upsertActiveCredential(context, {
      uid,
      hashV1: hashed.hashV1,
      hashAlgorithm: 'argon2id' as never,
      hashParamVersion: hashed.paramVersion
    });
  });
  return uid;
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, {
    projectRoot,
    configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-s22-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s22-platform'
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
  verifier = new VerifyPaymentCredential(unitOfWork, credentials);
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
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S2-2 verify payment credential', () => {
  it('S2D01: correct digits verify and reset counters', async () => {
    const uid = await seedCredential('135790');
    await unitOfWork.execute((context) =>
      credentials.recordFailedAttempt(context, uid, null)
    );
    const outcome = await verifier.execute(uid, await digitsBuffer('135790'));
    expect(outcome).toBe('verified');
    const after = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(after?.failedAttempts).toBe(0);
    expect(after?.status).toBe('ACTIVE');
  });

  it('S2D02: wrong digits reject and count', async () => {
    const uid = await seedCredential('135790');
    const outcome = await verifier.execute(uid, await digitsBuffer('111111'));
    expect(outcome).toBe('rejected');
    const after = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(after?.failedAttempts).toBe(1);
  });

  it('S2D03: five failures lock; locked window rejects locked', async () => {
    const uid = await seedCredential('135790');
    for (let index = 0; index < 4; index += 1) {
      expect(await verifier.execute(uid, await digitsBuffer('000000'))).toBe(
        'rejected'
      );
    }
    expect(await verifier.execute(uid, await digitsBuffer('000000'))).toBe(
      'rejected'
    );
    const locked = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(locked?.status).toBe('LOCKED');
    expect(locked?.lockedUntil).not.toBeNull();
    expect(await verifier.execute(uid, await digitsBuffer('135790'))).toBe(
      'locked'
    );
  });

  it('S2D04: users without credentials resolve not_set', async () => {
    const uid = await unitOfWork.execute(async (context) => {
      const created = await context.executeSql<{ uid: string }>(
        `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
        []
      );
      return created.rows[0]!.uid as Uid;
    });
    expect(await verifier.execute(uid, await digitsBuffer('123456'))).toBe(
      'not_set'
    );
  });

  it('S2D05: revoked credentials are refused outright', async () => {
    const uid = await seedCredential('135790');
    await cleanupPool.query(
      `UPDATE payment_credentials SET status='REVOKED',
         hash_v1=NULL, hash_algorithm=NULL, hash_param_version=NULL
       WHERE uid=$1::uuid`,
      [uid]
    );
    expect(await verifier.execute(uid, await digitsBuffer('135790'))).toBe(
      'revoked'
    );
  });
});
