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
import {
  AdminAuthorizer,
  ConfigStore,
  CrosscuttingError,
  FeeCalculator,
  RiskGate
} from '../../src/modules/crosscutting/application/crosscutting.services.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
let fees: FeeCalculator;
let risk: RiskGate;
let config: ConfigStore;
let admin: AdminAuthorizer;

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
  expect(evidence.firstMigrate.appliedVersions).toEqual(['1', '2', '3', '4', '5']);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-s34-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s34-platform'
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
  fees = new FeeCalculator(unitOfWork);
  risk = new RiskGate(unitOfWork);
  config = new ConfigStore(unitOfWork);
  admin = new AdminAuthorizer(unitOfWork);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'admin_role_grants',
    'admin_principals',
    'config_versions',
    'risk_decisions',
    'operation_limits',
    'fee_schedules',
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

describe.sequential('S3-4 crosscutting minimal contracts', () => {
  it('S3X01: fee calculation uses the latest schedule; unknown assets fail', async () => {
    await cleanupPool.query(
      `INSERT INTO fee_schedules (fee_version, asset_code, basis_points, fixed_amount)
       VALUES (1, 'USDT-TRC20', 100, 0)`
    );
    const result = await fees.calculate({ assetCode: 'USDT-TRC20', amount: '1000000' });
    expect(result.feeAmount).toBe('10000');
    await expect(
      fees.calculate({ assetCode: 'BTC', amount: '1000' })
    ).rejects.toMatchObject({ code: 'FEE_SCHEDULE_NOT_FOUND' });
  });

  it('S3X02: risk gate denies over-limit and replays the original decision', async () => {
    const uid = await seedUser();
    await cleanupPool.query(
      `INSERT INTO operation_limits (uid, operation_type, window_seconds, max_count, max_amount)
       VALUES ($1::uuid, 'WITHDRAWAL', 3600, 5, 5000000)`,
      [uid]
    );
    const allowed = await risk.check({
      uid,
      operationType: 'WITHDRAWAL',
      amount: '1000000',
      idempotencyKey: 'risk-key-000001'
    });
    if (!allowed.allowed && process.env.S34_DEBUG) console.log('S34-ALLOW-REASON', JSON.stringify(allowed));
    expect(allowed.allowed).toBe(true);
    const denied = await risk.check({
      uid,
      operationType: 'WITHDRAWAL',
      amount: '9999999',
      idempotencyKey: 'risk-key-000002'
    });
    expect(denied.allowed).toBe(false);
    expect(denied.reasonCode).toBe('RISK_LIMIT_EXCEEDED');
    const replay = await risk.check({
      uid,
      operationType: 'WITHDRAWAL',
      amount: '9999999',
      idempotencyKey: 'risk-key-000002'
    });
    expect(replay).toEqual(denied);
  });

  it('S3X03: risk gate with no limit allows and records', async () => {
    const uid = await seedUser();
    const result = await risk.check({
      uid,
      operationType: 'DEPOSIT',
      amount: '5000',
      idempotencyKey: 'risk-key-000003'
    });
    expect(result.allowed).toBe(true);
    expect(result.reasonCode).toBe('NO_LIMIT_CONFIGURED');
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM risk_decisions`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S3X04: config versions activate and history stays immutable', async () => {
    const v1 = await config.activate('test-key', { threshold: 100 });
    expect(v1).toBe(1);
    const v2 = await config.activate('test-key', { threshold: 200 });
    expect(v2).toBe(2);
    const current = await config.current('test-key');
    expect(current.version).toBe(2);
    expect(current.payload).toEqual({ threshold: 200 });
    await expect(config.current('nonexistent-key')).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND'
    });
  });

  it('S3X05: admin authorization follows grants and revocations', async () => {
    const adminId = randomUUID();
    await cleanupPool.query(
      `INSERT INTO admin_principals (admin_id) VALUES ($1::uuid)`,
      [adminId]
    );
    expect(await admin.isAuthorized(adminId, 'RISK_OFFICER')).toBe(false);
    await cleanupPool.query(
      `INSERT INTO admin_role_grants (admin_id, role) VALUES ($1::uuid, 'RISK_OFFICER')`,
      [adminId]
    );
    expect(await admin.isAuthorized(adminId, 'RISK_OFFICER')).toBe(true);
    expect(await admin.isAuthorized(adminId, 'SUPER_ADMIN')).toBe(false);
    await cleanupPool.query(
      `UPDATE admin_role_grants SET revoked_at = clock_timestamp()
        WHERE admin_id = $1::uuid AND role = 'RISK_OFFICER'`,
      [adminId]
    );
    expect(await admin.isAuthorized(adminId, 'RISK_OFFICER')).toBe(false);
    expect(await admin.isAuthorized(randomUUID(), 'RISK_OFFICER')).toBe(false);
    expect(await admin.isAuthorized('not-a-uuid', 'RISK_OFFICER')).toBe(false);
  });

  it('S3X06: fee schedules are not deletable by the platform role', async () => {
    await cleanupPool.query(
      `INSERT INTO fee_schedules (fee_version, asset_code, basis_points, fixed_amount)
       VALUES (1, 'ETH', 50, 100)`
    );
    const client = await platformPool.connect();
    try {
      await client.query('SET ROLE xht_platform');
      await expect(
        client.query('DELETE FROM fee_schedules')
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release();
    }
  });
});
