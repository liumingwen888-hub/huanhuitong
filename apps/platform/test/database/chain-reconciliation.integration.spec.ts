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
import { PostgresDepositAddressRepository } from '../../src/modules/deposits/infrastructure/postgres-deposit.repository.js';
import { DepositAddressService } from '../../src/modules/deposits/application/deposit-address.service.js';
import { ChainReconciliationService } from '../../src/modules/deposits/application/chain-reconciliation.service.js';
import { FakeDerivationSource } from '../../src/modules/deposits/domain/fake-derivation.source.js';
import { FakeChainScanner } from '../../src/modules/deposits/domain/fake-chain-scanner.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const depositAddresses = new PostgresDepositAddressRepository();
const derivation = new FakeDerivationSource();
let addressService: DepositAddressService;
let scanner: FakeChainScanner;
let reconciliation: ChainReconciliationService;

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function createAddressWithPostedDetection(
  uid: Uid,
  amount: string
): Promise<string> {
  const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
  await unitOfWork.execute(async (context) => {
    await context.executeSql(
      `INSERT INTO deposit_detections
         (address_id, network, network_txid, network_timestamp,
          amount, confirmations, status)
       VALUES ($1::uuid, 'TRON', $2, clock_timestamp(), $3, 19, 'POSTED')`,
      [addr.addressId, `tx-${randomUUID()}`, amount]
    );
  });
  return addr.addressText;
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
    max: 1, application_name: 'xht-s47-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s47-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never, fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
  addressService = new DepositAddressService(
    unitOfWork, depositAddresses, derivation
  );
  scanner = new FakeChainScanner();
  reconciliation = new ChainReconciliationService(unitOfWork, scanner);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'risk_decisions', 'deposit_detections', 'address_assignments',
    'deposit_addresses', 'chain_scan_checkpoints', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  scanner = new FakeChainScanner();
  reconciliation = new ChainReconciliationService(unitOfWork, scanner);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S4-7 chain reconciliation', () => {
  it('S4CR01: matching balances produce zero discrepancies', async () => {
    const uid = await seedUser();
    const addrText = await createAddressWithPostedDetection(uid, '500000');
    scanner.setAddressBalance('TRON', addrText, '500000');
    const report = await reconciliation.reconcileAll('TRON');
    expect(report.addressesChecked).toBe(1);
    expect(report.discrepancyCount).toBe(0);
  });

  it('S4CR02: chain > ledger is reported as a discrepancy', async () => {
    const uid = await seedUser();
    const addrText = await createAddressWithPostedDetection(uid, '500000');
    scanner.setAddressBalance('TRON', addrText, '600000');
    const report = await reconciliation.reconcileAll('TRON');
    expect(report.discrepancyCount).toBe(1);
    expect(report.discrepancies[0]?.chainBalance).toBe('600000');
    expect(report.discrepancies[0]?.ledgerBalance).toBe('500000');
    expect(report.discrepancies[0]?.difference).toBe('100000');
    const alerts = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM risk_decisions
        WHERE reason_code = 'CHAIN_RECONCILIATION_DISCREPANCY'`
    );
    expect(alerts.rows[0]?.n).toBe(1);
  });

  it('S4CR03: chain < ledger is also reported', async () => {
    const uid = await seedUser();
    const addrText = await createAddressWithPostedDetection(uid, '500000');
    scanner.setAddressBalance('TRON', addrText, '400000');
    const report = await reconciliation.reconcileAll('TRON');
    expect(report.discrepancyCount).toBe(1);
    expect(report.discrepancies[0]?.difference).toBe('-100000');
  });

  it('S4CR04: alerts are idempotent per address per window', async () => {
    const uid = await seedUser();
    const addrText = await createAddressWithPostedDetection(uid, '100000');
    scanner.setAddressBalance('TRON', addrText, '200000');
    await reconciliation.reconcileAll('TRON');
    const first = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM risk_decisions
        WHERE reason_code = 'CHAIN_RECONCILIATION_DISCREPANCY'`
    );
    expect(first.rows[0]?.n).toBe(1);
    await reconciliation.reconcileAll('TRON');
    const second = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM risk_decisions
        WHERE reason_code = 'CHAIN_RECONCILIATION_DISCREPANCY'`
    );
    expect(second.rows[0]?.n).toBe(1);
  });

  it('S4CR05: multiple addresses are reconciled in batch', async () => {
    const uidA = await seedUser();
    const uidB = await seedUser();
    const addrA = await createAddressWithPostedDetection(uidA, '100000');
    const addrB = await createAddressWithPostedDetection(uidB, '200000');
    scanner.setAddressBalance('TRON', addrA, '100000');
    scanner.setAddressBalance('TRON', addrB, '250000');
    const report = await reconciliation.reconcileAll('TRON');
    expect(report.addressesChecked).toBe(2);
    expect(report.discrepancyCount).toBe(1);
    expect(report.discrepancies[0]?.addressText).toBe(addrB);
  });
});
