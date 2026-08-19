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
  PostgresDepositAddressRepository,
  PostgresDepositDetectionRepository
} from '../../src/modules/deposits/infrastructure/postgres-deposit.repository.js';
import { DepositAddressService } from '../../src/modules/deposits/application/deposit-address.service.js';
import { DepositDetectionWorker } from '../../src/modules/deposits/application/deposit-detection.worker.js';
import {
  DepositConfirmationService
} from '../../src/modules/deposits/application/deposit-confirmation.service.js';
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
let confirmationService: DepositConfirmationService;

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function createDetection(
  uid: Uid,
  txid: string,
  confirmations: number,
  status = 'DETECTED'
): Promise<string> {
  const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
  return unitOfWork.execute(async (context) => {
    const result = await context.executeSql<{ detection_id: string }>(
      `INSERT INTO deposit_detections
         (address_id, network, network_txid, network_timestamp,
          amount, confirmations, status)
       VALUES ($1::uuid, 'TRON', $2, clock_timestamp(), 1000000, $3, $4)
       RETURNING detection_id`,
      [addr.addressId, txid, confirmations, status]
    );
    return result.rows[0]!.detection_id;
  });
}

async function detectionStatus(detectionId: string): Promise<string> {
  const rows = await cleanupPool.query<{ status: string }>(
    `SELECT status FROM deposit_detections WHERE detection_id=$1::uuid`,
    [detectionId]
  );
  return rows.rows[0]?.status ?? 'MISSING';
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
    max: 1, application_name: 'xht-s44-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s44-platform'
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
  confirmationService = new DepositConfirmationService(
    unitOfWork, detections
  );
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'deposit_detections', 'address_assignments', 'deposit_addresses',
    'chain_scan_checkpoints', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S4-4 deposit confirmation and reorg', () => {
  it('S4CF01: confirmations advance DETECTED→CONFIRMED when threshold met', async () => {
    const uid = await seedUser();
    const detection = await createDetection(uid, 'tx-cf-001', 19);
    expect(await detectionStatus(detection)).toBe('DETECTED');
    const result = await confirmationService.processConfirmations('TRON');
    expect(result.confirmed).toBe(1);
    expect(await detectionStatus(detection)).toBe('CONFIRMED');
  });

  it('S4CF02: below-threshold stays DETECTED; idempotent re-run skips', async () => {
    const uid = await seedUser();
    const low = await createDetection(uid, 'tx-cf-low', 5);
    const result1 = await confirmationService.processConfirmations('TRON');
    expect(result1.confirmed).toBe(0);
    expect(await detectionStatus(low)).toBe('DETECTED');
    await unitOfWork.execute((context) =>
      context.executeSql(
        `UPDATE deposit_detections SET confirmations = 19
          WHERE detection_id = $1::uuid`,
        [low]
      )
    );
    await confirmationService.processConfirmations('TRON');
    expect(await detectionStatus(low)).toBe('CONFIRMED');
    const result2 = await confirmationService.processConfirmations('TRON');
    expect(result2.confirmed).toBe(0);
    expect(result2.skipped).toBeGreaterThanOrEqual(0);
  });

  it('S4CF03: reorg marks CONFIRMED as REORG_DETECTED', async () => {
    const uid = await seedUser();
    const detection = await createDetection(uid, 'tx-reorg-1', 19);
    await confirmationService.processConfirmations('TRON');
    expect(await detectionStatus(detection)).toBe('CONFIRMED');
    const outcome = await confirmationService.processReorg('TRON', ['tx-reorg-1']);
    expect(outcome.blocked).toBe(1);
    expect(outcome.reversed).toBe(0);
    expect(await detectionStatus(detection)).toBe('REORG_DETECTED');
  });

  it('S4CF04: reorg marks POSTED without reversal when no reverser', async () => {
    const uid = await seedUser();
    const detection = await createDetection(uid, 'tx-reorg-2', 19, 'POSTED');
    const outcome = await confirmationService.processReorg('TRON', ['tx-reorg-2']);
    expect(outcome.markedUnknown).toBe(1);
    expect(await detectionStatus(detection)).toBe('REORG_DETECTED');
  });

  it('S4CF05: reorg on DETECTED also blocks', async () => {
    const uid = await seedUser();
    const detection = await createDetection(uid, 'tx-reorg-3', 5);
    const outcome = await confirmationService.processReorg('TRON', ['tx-reorg-3']);
    expect(outcome.blocked).toBe(1);
    expect(await detectionStatus(detection)).toBe('REORG_DETECTED');
  });

  it('S4CF06: non-existent txid is a no-op', async () => {
    const outcome = await confirmationService.processReorg('TRON', [
      randomUUID()
    ]);
    expect(outcome.processed).toBe(1);
    expect(outcome.reversed).toBe(0);
    expect(outcome.blocked).toBe(0);
  });
});
