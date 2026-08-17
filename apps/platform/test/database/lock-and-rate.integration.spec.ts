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
import { VerifyPaymentCredential } from '../../src/modules/security/application/verify-payment-credential.js';
import { CredentialSessionService } from '../../src/modules/security/application/credential-session.service.js';
import { SessionRateLimiter } from '../../src/modules/security/application/session-rate-limiter.js';
import { CredentialEntryBuffer } from '../../src/modules/security/domain/credential-processor.js';
import { hashCredentialDigits } from '../../src/modules/security/domain/credential-hash.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const credentials = new PostgresCredentialRepository();
let verifier: VerifyPaymentCredential;
let service: CredentialSessionService;
let looseService: CredentialSessionService;

async function seedUserWithCredential(digits: string): Promise<Uid> {
  const uid = await unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    return created.rows[0]!.uid as Uid;
  });
  const bytes = new Uint8Array(digits.length);
  for (let index = 0; index < digits.length; index += 1) {
    bytes[index] = digits.charCodeAt(index);
  }
  const hashed = await hashCredentialDigits(bytes);
  await unitOfWork.execute(async (context) => {
    await credentials.upsertActiveCredential(context, {
      uid,
      hashV1: hashed.hashV1,
      hashAlgorithm: 'scrypt' as never,
      hashParamVersion: hashed.paramVersion
    });
  });
  return uid;
}

async function bufferOf(digits: string): Promise<CredentialEntryBuffer> {
  const buffer = new CredentialEntryBuffer();
  for (const digit of digits) buffer.appendDigit(digit);
  return buffer;
}

async function locks(uid: string): Promise<
  ReadonlyArray<{ lock_reason: string; released_at: string | null }>
> {
  const rows = await cleanupPool.query<{
    lock_reason: string;
    released_at: string | null;
  }>(
    `SELECT lock_reason, released_at FROM security_locks
      WHERE uid=$1::uuid ORDER BY locked_at`,
    [uid]
  );
  return rows.rows;
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
    application_name: 'xht-s24-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s24-platform'
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
  service = new CredentialSessionService(
    unitOfWork,
    new PostgresCredentialSessionRepository(),
    credentials,
    verifier,
    new SessionRateLimiter({ maxPerWindow: 3, windowMillis: 60_000 })
  );
  looseService = new CredentialSessionService(
    unitOfWork,
    new PostgresCredentialSessionRepository(),
    credentials,
    verifier,
    new SessionRateLimiter({ maxPerWindow: 1000, windowMillis: 60_000 })
  );
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

describe.sequential('S2-4 locks, rate limiting and rehash', () => {
  it('S4D01: threshold lock writes an audit row; later success releases it', async () => {
    const uid = await seedUserWithCredential('135790');
    for (let index = 0; index < 5; index += 1) {
      await verifier.execute(uid, await bufferOf('000000'));
    }
    let rows = await locks(uid);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lock_reason).toBe('credential-failed-attempts');
    expect(rows[0]?.released_at).toBeNull();
    const credential = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(credential?.status).toBe('LOCKED');

    await cleanupPool.query(
      `UPDATE payment_credentials SET status='ACTIVE', locked_until=NULL
        WHERE uid=$1::uuid`,
      [uid]
    );
    const outcome = await verifier.execute(uid, await bufferOf('135790'));
    expect(outcome).toBe('verified');
    rows = await locks(uid);
    expect(rows[0]?.released_at).not.toBeNull();
  });

  it('S4D02: a second OPEN session is rejected until the first closes', async () => {
    const uid = await seedUserWithCredential('135790');
    const first = await looseService.beginSetup(uid);
    await expect(looseService.beginSetup(uid)).rejects.toThrowError(
      'SESSION_ALREADY_OPEN'
    );
    await expect(
      looseService.beginAuthorization({
        uid,
        operationType: 'withdrawal',
        orderRef: 'o',
        amountSummary: '1',
        assetSummary: 'USDT'
      })
    ).rejects.toThrowError('SESSION_ALREADY_OPEN');
    await looseService.cancel(first.sessionId);
    const second = await looseService.beginSetup(uid);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it('S4D03: the per-window rate limit blocks session flooding', async () => {
    const uid = await seedUserWithCredential('135790');
    const openings: Array<Promise<unknown>> = [];
    for (let index = 0; index < 3; index += 1) {
      const begin = service.beginSetup(uid);
      openings.push(begin);
      const settled = await begin.then(
        (value) => value,
        () => undefined
      );
      if (settled !== undefined) await service.cancel(settled.sessionId);
    }
    void openings;
    await expect(service.beginSetup(uid)).rejects.toThrowError(
      'SESSION_RATE_LIMITED'
    );
  });

  it('S4D04: a legacy param version is transparently rehashed on success', async () => {
    const uid = await seedUserWithCredential('135790');
    await cleanupPool.query(
      `UPDATE payment_credentials SET hash_param_version = 0
        WHERE uid=$1::uuid`,
      [uid]
    );
    const outcome = await verifier.execute(uid, await bufferOf('135790'));
    expect(outcome).toBe('verified');
    const row = await cleanupPool.query<{
      hash_param_version: number;
      hash_algorithm: string;
    }>(
      `SELECT hash_param_version, hash_algorithm FROM payment_credentials
        WHERE uid=$1::uuid`,
      [uid]
    );
    expect(row.rows[0]?.hash_param_version).toBe(1);
    expect(row.rows[0]?.hash_algorithm).toBe('scrypt');
    const again = await verifier.execute(uid, await bufferOf('135790'));
    expect(again).toBe('verified');
    void randomUUID;
  });
});
