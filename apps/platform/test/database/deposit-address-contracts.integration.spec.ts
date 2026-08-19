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
  PostgresConfirmationPolicyRepository,
  PostgresDepositDetectionRepository
} from '../../src/modules/deposits/infrastructure/postgres-deposit.repository.js';
import { FakeDerivationSource } from '../../src/modules/deposits/domain/fake-derivation.source.js';
import { DepositError } from '../../src/modules/deposits/domain/deposit.errors.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const addresses = new PostgresDepositAddressRepository();
const policies = new PostgresConfirmationPolicyRepository();
const detections = new PostgresDepositDetectionRepository();
const derivation = new FakeDerivationSource();

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function assignAddress(
  uid: Uid,
  asset = 'USDT-TRC20',
  network = 'TRON' as const
) {
  return unitOfWork.execute((context) =>
    addresses.createNextAddress(context, {
      uid, assetCode: asset, network, derivation
    })
  );
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot, startupTimeoutMillis: 120_000, stopTimeoutMillis: 10_000
  });
  const evidence = await migrateAndValidate(fixture, {
    projectRoot, configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  expect(evidence.firstMigrate.appliedVersions).toEqual([
    '1', '2', '3', '4', '5', '6'
  ]);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s41-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s41-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never, fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
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

describe.sequential('S4-1 deposit address contracts', () => {
  it('S4DA01: V6 creates the five tables with confirmation seeds', async () => {
    const policies = await cleanupPool.query<{
      network: string; required_confirmations: number;
    }>(`SELECT network, required_confirmations FROM confirmation_policies ORDER BY network`);
    expect(policies.rows).toEqual([
      { network: 'BITCOIN', required_confirmations: 6 },
      { network: 'ETHEREUM', required_confirmations: 12 },
      { network: 'TRON', required_confirmations: 19 }
    ]);
  });

  it('S4DA02: address creation assigns deterministically with fake derivation', async () => {
    const uid = await seedUser();
    const first = await assignAddress(uid);
    expect(first.status).toBe('ACTIVE');
    expect(first.network).toBe('TRON');
    expect(first.addressText).toMatch(/^T[a-f0-9]{40}$/);
    expect(first.derivationPath).toBe("m/44'/195'/0'/0/0");
    const second = await unitOfWork.execute((context) =>
      addresses.findAssignedAddress(context, {
        uid, assetCode: 'USDT-TRC20'
      })
    );
    expect(second?.addressId).toBe(first.addressId);
  });

  it('S4DA03: derivation indexes are monotonically increasing', async () => {
    const uidA = await seedUser();
    const uidB = await seedUser();
    const a1 = await assignAddress(uidA);
    const b1 = await assignAddress(uidB);
    expect(a1.derivationIndex).toBe(0);
    expect(b1.derivationIndex).toBe(1);
    const a2 = await assignAddress(uidA);
    expect(a2.derivationIndex).toBe(2);
  });

  it('S4DA04: unsupported networks are rejected', async () => {
    const uid = await seedUser();
    await expect(
      unitOfWork.execute((context) =>
        addresses.createNextAddress(context, {
          uid, assetCode: 'BTC', network: 'SOLANA' as never, derivation
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S4DA05: detections are idempotent by (network, txid, address)', async () => {
    const uid = await seedUser();
    const addr = await assignAddress(uid);
    const detection = await unitOfWork.execute((context) =>
      detections.upsertDetection(context, {
        addressId: addr.addressId,
        network: 'TRON',
        networkTxid: 'tx-abc-123',
        networkTimestamp: new Date(),
        amount: '5000000',
        confirmations: 3
      })
    );
    expect(detection.created).toBe(true);
    const replay = await unitOfWork.execute((context) =>
      detections.upsertDetection(context, {
        addressId: addr.addressId,
        network: 'TRON',
        networkTxid: 'tx-abc-123',
        networkTimestamp: new Date(),
        amount: '5000000',
        confirmations: 10
      })
    );
    expect(replay.detectionId).toBe(detection.detectionId);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM deposit_detections`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S4DA06: confirmations reach threshold and detections transition', async () => {
    const uid = await seedUser();
    const addr = await assignAddress(uid);
    const detection = await unitOfWork.execute((context) =>
      detections.upsertDetection(context, {
        addressId: addr.addressId,
        network: 'TRON',
        networkTxid: 'tx-confirm-1',
        networkTimestamp: new Date(),
        amount: '1000000',
        confirmations: 19
      })
    );
    const confirmed = await unitOfWork.execute((context) =>
      detections.findConfirmedDetections(context, 'TRON')
    );
    expect(confirmed.length).toBe(1);
    expect(confirmed[0]?.detectionId).toBe(detection.detectionId);
    expect(confirmed[0]?.amount).toBe('1000000');
    const transitioned = await unitOfWork.execute((context) =>
      detections.transitionStatus(context, detection.detectionId, 'DETECTED', 'POSTED')
    );
    expect(transitioned).toBe(true);
    const afterPost = await unitOfWork.execute((context) =>
      detections.findConfirmedDetections(context, 'TRON')
    );
    expect(afterPost).toEqual([]);
    const stale = await unitOfWork.execute((context) =>
      detections.transitionStatus(context, detection.detectionId, 'DETECTED', 'POSTED')
    );
    expect(stale).toBe(false);
  });

  it('S4DA07: worker role has read-only access to deposit tables', async () => {
    const workerClient = await new Pool({
      connectionString: fixture.workerLogin.connectionString, max: 1
    }).connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      const readable = await workerClient.query(
        `SELECT count(*)::int AS n FROM confirmation_policies`
      );
      expect(readable.rows[0]?.n).toBe(3);
      await expect(
        workerClient.query(
          `INSERT INTO deposit_addresses (uid, asset_code, network, address_text, derivation_path, derivation_index)
           VALUES ($1::uuid, 'BTC', 'BITCOIN', 'x', 'y', 0)`,
          [randomUUID()]
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
  });
});
