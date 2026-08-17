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
import { RecoveryCaseService } from '../../src/modules/security/application/recovery-case.service.js';
import { CredentialEntryBuffer } from '../../src/modules/security/domain/credential-processor.js';
import { hashCredentialDigits } from '../../src/modules/security/domain/credential-hash.js';
import { generateTotpSecret, totpCode } from '../../src/modules/security/domain/totp.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const credentials = new PostgresCredentialRepository();
let verifier: VerifyPaymentCredential;
let recovery: RecoveryCaseService;

interface Seed {
  readonly uid: Uid;
  readonly registeredOn: string;
  readonly externalUserId: string;
}

async function seed(): Promise<Seed> {
  const created = await unitOfWork.execute(async (context) => {
    const user = await context.executeSql<{ uid: string; created: Date }>(
      `INSERT INTO users (status) VALUES ('ACTIVE')
       RETURNING uid, created_at AS created`,
      []
    );
    const uid = user.rows[0]!.uid;
    await context.executeSql(
      `INSERT INTO memberships (uid, status) VALUES ($1::uuid, 'ACTIVE')`,
      [uid]
    );
    await context.executeSql(
      `INSERT INTO channel_bindings
         (channel_type, external_user_id, uid, status)
       VALUES ('TELEGRAM', '8901', $1::uuid, 'ACTIVE')`,
      [uid]
    );
    return {
      uid,
      registeredOn: new Date(user.rows[0]!.created)
        .toISOString()
        .slice(0, 10)
    };
  });
  const bytes = new Uint8Array(6);
  '135790'.split('').forEach((c, i) => (bytes[i] = c.charCodeAt(0)));
  const hashed = await hashCredentialDigits(bytes);
  await unitOfWork.execute(async (context) => {
    await credentials.upsertActiveCredential(context, {
      uid: created.uid as Uid,
      hashV1: hashed.hashV1,
      hashAlgorithm: 'scrypt' as never,
      hashParamVersion: hashed.paramVersion
    });
  });
  return { ...created, uid: created.uid as Uid, externalUserId: '8901' };
}

async function bufferOf(digits: string): Promise<CredentialEntryBuffer> {
  const buffer = new CredentialEntryBuffer();
  for (const digit of digits) buffer.appendDigit(digit);
  return buffer;
}

async function caseRow(caseId: string): Promise<{
  status: string;
  factors_achieved: number;
  cooldown_until: Date | null;
}> {
  const rows = await cleanupPool.query<{
    status: string;
    factors_achieved: number;
    cooldown_until: Date | null;
  }>(
    `SELECT status, factors_achieved, cooldown_until FROM recovery_cases
      WHERE case_id=$1::uuid`,
    [caseId]
  );
  return rows.rows[0]!;
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
    application_name: 'xht-s25-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s25-platform'
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
  recovery = new RecoveryCaseService(unitOfWork, credentials, verifier);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'recovery_cases',
    'security_locks',
    'credential_sessions',
    'payment_credentials',
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

describe.sequential('S2-5 recovery cases and cooldown', () => {
  it('S5D01: full recovery chain ends in APPROVED with credential cooldown', async () => {
    const seedInfo = await seed();
    const totpSecret = generateTotpSecret();
    const now = Date.now();
    const begun = await recovery.beginRecovery({
      uid: seedInfo.uid,
      factorsRequired: 3,
      totpSecret
    });

    expect(
      await recovery.achieveFactorMemory(
        begun.caseId,
        await bufferOf('135790')
      )
    ).toBe(1);
    expect(
      await recovery.achieveFactorTotp(begun.caseId, totpCode(totpSecret, now), now)
    ).toBe(2);
    await recovery.submitEvidenceForReview(begun.caseId, 'evidence-1');
    expect((await caseRow(begun.caseId)).factors_achieved).toBe(3);

    const approved = await recovery.approve(begun.caseId);
    expect(approved.cooldownUntil).toBeTruthy();
    const row = await caseRow(begun.caseId);
    expect(row.status).toBe('APPROVED');
    expect(row.cooldown_until).not.toBeNull();
    const credential = await unitOfWork.execute((context) =>
      credentials.findCredential(context, seedInfo.uid)
    );
    expect(credential?.status).toBe('COOLDOWN');
    const outcome = await verifier.execute(
      seedInfo.uid,
      await bufferOf('135790')
    );
    expect(outcome).toBe('cooldown');

    const locks = await cleanupPool.query(
      `SELECT count(*)::int AS n FROM security_locks
        WHERE uid=$1::uuid AND lock_reason='recovery-open'`,
      [seedInfo.uid]
    );
    expect(locks.rows[0]?.n).toBe(1);
  });

  it('S5D02: history factor accepts exact claims and rejects mismatches', async () => {
    const seedInfo = await seed();
    const begun = await recovery.beginRecovery({ uid: seedInfo.uid });
    await expect(
      recovery.achieveFactorHistory(begun.caseId, {
        registeredOn: '1999-01-01'
      })
    ).rejects.toThrowError('HISTORY_MISMATCH');
    await expect(
      recovery.achieveFactorHistory(begun.caseId, {})
    ).rejects.toThrowError('HISTORY_MISMATCH');
    expect(
      await recovery.achieveFactorHistory(begun.caseId, {
        registeredOn: seedInfo.registeredOn,
        externalUserId: '8901'
      })
    ).toBe(1);
  });

  it('S5D03: approving without enough factors fails closed', async () => {
    const seedInfo = await seed();
    const begun = await recovery.beginRecovery({ uid: seedInfo.uid });
    await recovery.submitEvidenceForReview(begun.caseId, 'evidence-2');
    await expect(recovery.approve(begun.caseId)).rejects.toThrowError(
      'FACTORS_INSUFFICIENT'
    );
    expect((await caseRow(begun.caseId)).status).toBe('PENDING_REVIEW');
  });

  it('S5D04: concurrent approve allows exactly one winner', async () => {
    const seedInfo = await seed();
    const totpSecret = generateTotpSecret();
    const now = Date.now();
    const begun = await recovery.beginRecovery({
      uid: seedInfo.uid,
      factorsRequired: 2,
      totpSecret
    });
    await recovery.achieveFactorMemory(begun.caseId, await bufferOf('135790'))
    await recovery.achieveFactorTotp(
      begun.caseId,
      totpCode(totpSecret, now),
      now
);
    await recovery.submitEvidenceForReview(begun.caseId, 'evidence-3')
    const results = await Promise.allSettled([
      recovery.approve(begun.caseId),
      recovery.approve(begun.caseId)
    ]);
    const fulfilled = results.filter(
      (r) => r.status === 'fulfilled'
    ).length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(fulfilled + rejected).toBe(2);
    expect((await caseRow(begun.caseId)).status).toBe('APPROVED');
    expect(
      results.some(
        (r) => r.status === 'rejected'
      )
    ).toBe(true);
  });

  it('S5D05: rejected cases are terminal', async () => {
    const seedInfo = await seed();
    const begun = await recovery.beginRecovery({ uid: seedInfo.uid });
    await recovery.submitEvidenceForReview(begun.caseId, 'evidence-4');
    expect(await recovery.reject(begun.caseId)).toBe(true);
    expect(await recovery.reject(begun.caseId)).toBe(false);
    expect((await caseRow(begun.caseId)).status).toBe('REJECTED');
    await expect(
      recovery.achieveFactorTotp(begun.caseId, '123456', Date.now())
    ).rejects.toThrowError('CASE_NOT_OPEN');
  });

  it('S5D06: TOTP factor requires enrollment for the case', async () => {
    const seedInfo = await seed();
    const begun = await recovery.beginRecovery({ uid: seedInfo.uid });
    await expect(
      recovery.achieveFactorTotp(begun.caseId, '123456', Date.now())
    ).rejects.toThrowError('TOTP_NOT_ENROLLED');
  });
});
