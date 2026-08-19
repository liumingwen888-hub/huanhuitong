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
import { PostgresDepositAddressRepository } from '../../src/modules/deposits/infrastructure/postgres-deposit.repository.js';
import { DepositAddressService } from '../../src/modules/deposits/application/deposit-address.service.js';
import { FakeDerivationSource } from '../../src/modules/deposits/domain/fake-derivation.source.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
let unitOfWorkB: UnitOfWork;
let service: DepositAddressService;
let serviceB: DepositAddressService;

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot, startupTimeoutMillis: 120_000, stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, {
    projectRoot, configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s42-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 6, application_name: 'xht-s42-platform'
  });
  const mk = (): UnitOfWork => {
    const k = new Kysely<StageOneDatabase>({
      dialect: new PostgresDialect({
        pool: new RoleEnforcingPostgresPool(
          platformPool as never, fixture.platformLogin.username
        )
      })
    });
    return createUnitOfWork(k);
  };
  unitOfWork = mk();
  unitOfWorkB = mk();
  const repo = new PostgresDepositAddressRepository();
  const fake = new FakeDerivationSource();
  service = new DepositAddressService(unitOfWork, repo, fake);
  serviceB = new DepositAddressService(unitOfWorkB, repo, fake);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'deposit_detections', 'address_assignments', 'deposit_addresses', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S4-2 deposit address service', () => {
  it('S4AS01: getOrCreate is idempotent for the same uid and asset', async () => {
    const uid = await seedUser();
    const first = await service.getOrCreateAddress(uid, 'USDT-TRC20');
    const second = await service.getOrCreateAddress(uid, 'USDT-TRC20');
    expect(second.addressId).toBe(first.addressId);
    expect(second.addressText).toBe(first.addressText);
  });

  it('S4AS02: concurrent getOrCreate yields exactly one address', async () => {
    const uid = await seedUser();
    const [a, b] = await Promise.all([
      service.getOrCreateAddress(uid, 'ETH'),
      serviceB.getOrCreateAddress(uid, 'ETH')
    ]);
    expect(a.addressId).toBe(b.addressId);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM deposit_addresses WHERE uid=$1::uuid`,
      [uid]
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S4AS03: different assets get different addresses; fiat is rejected', async () => {
    const uid = await seedUser();
    const usdt = await service.getOrCreateAddress(uid, 'USDT-TRC20');
    const eth = await service.getOrCreateAddress(uid, 'ETH');
    expect(usdt.network).toBe('TRON');
    expect(eth.network).toBe('ETHEREUM');
    expect(usdt.addressText).not.toBe(eth.addressText);
    await expect(
      service.getOrCreateAddress(uid, 'USD-FIAT')
    ).rejects.toMatchObject({ code: 'DEPOSIT_NETWORK_UNSUPPORTED' });
  });

  it('S4AS04-05: retire and compromise trigger new address on next getOrCreate', async () => {
    const uid = await seedUser();
    const original = await service.getOrCreateAddress(uid, 'BTC');
    expect(await service.retireAddress(original.addressId)).toBe(true);
    expect(
      await service.getOrCreateAddress(uid, 'BTC')
    ).toMatchObject({ derivationIndex: original.derivationIndex + 1 });
    const second = await service.getOrCreateAddress(uid, 'BTC');
    expect(await service.markCompromised(second.addressId)).toBe(true);
    const third = await service.getOrCreateAddress(uid, 'BTC');
    expect(third.derivationIndex).toBe(second.derivationIndex + 1);
    expect(await service.retireAddress(original.addressId)).toBe(false);
  });
});
