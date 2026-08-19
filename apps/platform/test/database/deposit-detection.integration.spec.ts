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
  PostgresDepositAddressRepository,
  PostgresDepositDetectionRepository
} from '../../src/modules/deposits/infrastructure/postgres-deposit.repository.js';
import { DepositAddressService } from '../../src/modules/deposits/application/deposit-address.service.js';
import { DepositDetectionWorker } from '../../src/modules/deposits/application/deposit-detection.worker.js';
import { FakeDerivationSource } from '../../src/modules/deposits/domain/fake-derivation.source.js';
import { FakeChainScanner } from '../../src/modules/deposits/domain/fake-chain-scanner.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const addresses = new PostgresDepositAddressRepository();
const detections = new PostgresDepositDetectionRepository();
const derivation = new FakeDerivationSource();
let addressService: DepositAddressService;
let scanner: FakeChainScanner;
let worker: DepositDetectionWorker;

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function detectionCount(): Promise<number> {
  const rows = await cleanupPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM deposit_detections`
  );
  return rows.rows[0]?.n ?? 0;
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
    max: 1, application_name: 'xht-s43-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s43-platform'
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
    unitOfWork, addresses, derivation
  );
  scanner = new FakeChainScanner();
  worker = new DepositDetectionWorker(
    unitOfWork, addresses, detections, scanner
  );
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'deposit_detections', 'address_assignments', 'deposit_addresses',
    'chain_scan_checkpoints', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  scanner = new FakeChainScanner();
  worker = new DepositDetectionWorker(
    unitOfWork, addresses, detections, scanner
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S4-3 deposit detection worker', () => {
  it('S4DW01: scans and records detections from injected transactions', async () => {
    const uid = await seedUser();
    const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
    scanner.setLatestBlock('TRON', '100');
    scanner.inject('TRON', {
      networkTxid: 'tx-detect-001',
      toAddress: addr.addressText,
      amount: '5000000',
      blockNumber: '95',
      blockTimestamp: new Date(),
      confirmations: 5
    });
    const result = await worker.runOnce('TRON');
    expect(result.addressesScanned).toBe(1);
    expect(result.detectionsUpserted).toBe(1);
    expect(result.checkpointAdvanced).toBe(true);
    expect(await detectionCount()).toBe(1);
    const rows = await cleanupPool.query<{
      network_txid: string; amount: string; confirmations: number;
    }>(`SELECT network_txid, amount::text AS amount, confirmations
         FROM deposit_detections`);
    expect(rows.rows[0]?.network_txid).toBe('tx-detect-001');
    expect(rows.rows[0]?.amount).toBe('5000000');
    expect(rows.rows[0]?.confirmations).toBe(5);
  });

  it('S4DW02: re-scanning the same transaction updates confirmations only', async () => {
    const uid = await seedUser();
    const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
    scanner.setLatestBlock('TRON', '100');
    scanner.inject('TRON', {
      networkTxid: 'tx-detect-002',
      toAddress: addr.addressText,
      amount: '1000',
      blockNumber: '50',
      blockTimestamp: new Date(),
      confirmations: 3
    });
    await worker.runOnce('TRON');
    expect(await detectionCount()).toBe(1);
    scanner.updateConfirmations('TRON', 'tx-detect-002', 19);
    await cleanupPool.query(
      `UPDATE chain_scan_checkpoints SET last_scanned_block = 0 WHERE network='TRON'`
    );
    await worker.runOnce('TRON');
    expect(await detectionCount()).toBe(1);
    const rows = await cleanupPool.query<{ confirmations: number }>(
      `SELECT confirmations FROM deposit_detections`
    );
    expect(rows.rows[0]?.confirmations).toBe(19);
  });

  it('S4DW03: multiple addresses and transactions are handled', async () => {
    const uidA = await seedUser();
    const uidB = await seedUser();
    const addrA = await addressService.getOrCreateAddress(uidA, 'USDT-TRC20');
    const addrB = await addressService.getOrCreateAddress(uidB, 'USDT-TRC20');
    scanner.setLatestBlock('TRON', '200');
    scanner.inject('TRON', {
      networkTxid: 'tx-multi-001', toAddress: addrA.addressText,
      amount: '100', blockNumber: '150', blockTimestamp: new Date(),
      confirmations: 1
    });
    scanner.inject('TRON', {
      networkTxid: 'tx-multi-002', toAddress: addrA.addressText,
      amount: '200', blockNumber: '160', blockTimestamp: new Date(),
      confirmations: 2
    });
    scanner.inject('TRON', {
      networkTxid: 'tx-multi-003', toAddress: addrB.addressText,
      amount: '300', blockNumber: '170', blockTimestamp: new Date(),
      confirmations: 3
    });
    const result = await worker.runOnce('TRON');
    expect(result.addressesScanned).toBe(2);
    expect(result.detectionsUpserted).toBe(3);
    expect(await detectionCount()).toBe(3);
  });

  it('S4DW04: checkpoint advances and does not regress', async () => {
    const uid = await seedUser();
    await addressService.getOrCreateAddress(uid, 'BTC');
    scanner.setLatestBlock('BITCOIN', '1000');
    await worker.runOnce('BITCOIN');
    let cp = await cleanupPool.query<{ last: string }>(
      `SELECT last_scanned_block::text AS last FROM chain_scan_checkpoints
        WHERE network='BITCOIN'`
    );
    expect(cp.rows[0]?.last).toBe('1000');
    scanner.setLatestBlock('BITCOIN', '500');
    await worker.runOnce('BITCOIN');
    cp = await cleanupPool.query<{ last: string }>(
      `SELECT last_scanned_block::text AS last FROM chain_scan_checkpoints
        WHERE network='BITCOIN'`
    );
    expect(cp.rows[0]?.last).toBe('1000');
  });

  it('S4DW05: retired addresses are not scanned', async () => {
    const uid = await seedUser();
    const addr = await addressService.getOrCreateAddress(uid, 'ETH');
    await addressService.retireAddress(addr.addressId);
    scanner.setLatestBlock('ETHEREUM', '100');
    scanner.inject('ETHEREUM', {
      networkTxid: 'tx-retired-01', toAddress: addr.addressText,
      amount: '100', blockNumber: '50', blockTimestamp: new Date(),
      confirmations: 1
    });
    const result = await worker.runOnce('ETHEREUM');
    expect(result.addressesScanned).toBe(0);
    expect(result.detectionsUpserted).toBe(0);
    expect(await detectionCount()).toBe(0);
  });
});
