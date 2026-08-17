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
import {
  CredentialSessionRegistryError
} from '../../src/modules/security/application/credential-session.registry.js';
import { hashCredentialDigits } from '../../src/modules/security/domain/credential-hash.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
let service: CredentialSessionService;
const credentials = new PostgresCredentialRepository();

function digitBytes(digits: string): Uint8Array {
  const bytes = new Uint8Array(digits.length);
  for (let index = 0; index < digits.length; index += 1) {
    bytes[index] = digits.charCodeAt(index);
  }
  return bytes;
}

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function seedActiveCredential(uid: Uid, digits: string): Promise<void> {
  const hashed = await hashCredentialDigits(digitBytes(digits));
  await unitOfWork.execute(async (context) => {
    await credentials.upsertActiveCredential(context, {
      uid,
      hashV1: hashed.hashV1,
      hashAlgorithm: 'scrypt' as never,
      hashParamVersion: hashed.paramVersion
    });
  });
}

function feed(
  sessionId: string,
  phase: 'primary' | 'confirmation',
  digits: string
): void {
  for (const digit of digits) {
    service.appendDigit({
      sessionId,
      actionNonce: randomUUID(),
      digit,
      phase
    });
  }
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
    application_name: 'xht-s23-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s23-platform'
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
  service = new CredentialSessionService(
    unitOfWork,
    new PostgresCredentialSessionRepository(),
    credentials,
    new VerifyPaymentCredential(unitOfWork, credentials)
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

async function sessionStatus(sessionId: string): Promise<string> {
  const rows = await cleanupPool.query<{ status: string }>(
    `SELECT status FROM credential_sessions WHERE session_id=$1::uuid`,
    [sessionId]
  );
  return rows.rows[0]?.status ?? 'MISSING';
}

describe.sequential('S2-3 credential session service', () => {
  it('S3D01: full setup flow creates an ACTIVE credential', async () => {
    const uid = await seedUser();
    const begin = await service.beginSetup(uid);
    feed(begin.sessionId, 'primary', '135790');
    feed(begin.sessionId, 'confirmation', '135790');
    await service.confirmSetup(begin.sessionId);
    expect(await sessionStatus(begin.sessionId)).toBe('CONFIRMED');
    const credential = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(credential?.status).toBe('ACTIVE');
    expect(service.registry.size).toBe(0);
  });

  it('S3D02: mismatched confirmation fails the session and stores nothing', async () => {
    const uid = await seedUser();
    const begin = await service.beginSetup(uid);
    feed(begin.sessionId, 'primary', '135790');
    feed(begin.sessionId, 'confirmation', '135791');
    await expect(service.confirmSetup(begin.sessionId)).rejects.toThrowError(
      'ENTRIES_MISMATCH'
    );
    expect(await sessionStatus(begin.sessionId)).toBe('FAILED');
    const credential = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(credential).toBeNull();
  });

  it('S3D03: digit count below policy fails closed', async () => {
    const uid = await seedUser();
    const begin = await service.beginSetup(uid);
    feed(begin.sessionId, 'primary', '13579');
    feed(begin.sessionId, 'confirmation', '13579');
    await expect(service.confirmSetup(begin.sessionId)).rejects.toThrowError(
      'DIGITS_OUT_OF_POLICY_RANGE'
    );
    expect(await sessionStatus(begin.sessionId)).toBe('FAILED');
  });

  it('S3D04: reused nonce is rejected and never mutates buffers', async () => {
    const uid = await seedUser();
    const begin = await service.beginSetup(uid);
    const nonce = randomUUID();
    service.appendDigit({
      sessionId: begin.sessionId,
      actionNonce: nonce,
      digit: '1',
      phase: 'primary'
    });
    expect(() =>
      service.appendDigit({
        sessionId: begin.sessionId,
        actionNonce: nonce,
        digit: '2',
        phase: 'primary'
      })
    ).toThrowError(CredentialSessionRegistryError);
    const entry = service.registry.get(begin.sessionId);
    expect(entry?.primary.length).toBe(1);
  });

  it('S3D05: authorization issues a complete frozen proof', async () => {
    const uid = await seedUser();
    await seedActiveCredential(uid, '135790');
    const begin = await service.beginAuthorization({
      uid,
      operationType: 'withdrawal',
      orderRef: 'order-42',
      amountSummary: '100.50',
      assetSummary: 'USDT-TRC20'
    });
    feed(begin.sessionId, 'primary', '135790');
    const outcome = await service.authorizePayment(begin.sessionId);
    expect(outcome.kind).toBe('authorized');
    if (outcome.kind === 'authorized') {
      expect(outcome.proof).toMatchObject({
        type: 'security.payment-authorized.v1',
        operationType: 'withdrawal',
        orderRef: 'order-42',
        amountSummary: '100.50',
        assetSummary: 'USDT-TRC20'
      });
      expect(Object.isFrozen(outcome.proof)).toBe(true);
      expect(outcome.proof.sessionId).toBe(begin.sessionId);
    }
    expect(await sessionStatus(begin.sessionId)).toBe('CONFIRMED');
  });

  it('S3D06: wrong digits reject and fail the session', async () => {
    const uid = await seedUser();
    await seedActiveCredential(uid, '135790');
    const begin = await service.beginAuthorization({
      uid,
      operationType: 'exchange',
      orderRef: 'order-43',
      amountSummary: '10',
      assetSummary: 'USDT-TRC20'
    });
    feed(begin.sessionId, 'primary', '000000');
    const outcome = await service.authorizePayment(begin.sessionId);
    expect(outcome).toMatchObject({ kind: 'rejected' });
    expect(await sessionStatus(begin.sessionId)).toBe('FAILED');
    const credential = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(credential?.failedAttempts).toBe(1);
  });

  it('S3D07: cancel closes the session and forbids further input', async () => {
    const uid = await seedUser();
    const begin = await service.beginSetup(uid);
    feed(begin.sessionId, 'primary', '13');
    await service.cancel(begin.sessionId);
    expect(await sessionStatus(begin.sessionId)).toBe('CANCELLED');
    expect(() =>
      service.appendDigit({
        sessionId: begin.sessionId,
        actionNonce: randomUUID(),
        digit: '5',
        phase: 'primary'
      })
    ).toThrowError('SESSION_NOT_IN_MEMORY');
  });

  it('S3D08: an expired session is rejected and transitioned EXPIRED', async () => {
    const uid = await seedUser();
    await seedActiveCredential(uid, '135790');
    const begin = await service.beginAuthorization({
      uid,
      operationType: 'withdrawal',
      orderRef: 'order-44',
      amountSummary: '1',
      assetSummary: 'USDT'
    });
    await cleanupPool.query(
      `UPDATE credential_sessions
          SET expires_at = clock_timestamp() - interval '1 second'
        WHERE session_id=$1::uuid`,
      [begin.sessionId]
    );
    feed(begin.sessionId, 'primary', '135790');
    await expect(service.authorizePayment(begin.sessionId)).rejects.toThrowError(
      'SESSION_EXPIRED'
    );
    expect(await sessionStatus(begin.sessionId)).toBe('EXPIRED');
  });
});
