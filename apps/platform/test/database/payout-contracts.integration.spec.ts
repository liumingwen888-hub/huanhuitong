import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { StageOneDatabase, Uid } from '@xht/contracts';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleEnforcingPostgresPool } from '../../src/infrastructure/database/database.js';
import {
  createUnitOfWork,
  type UnitOfWork
} from '../../src/infrastructure/database/unit-of-work.js';
import {
  PostgresPayoutOrderRepository,
  PostgresProviderConfigRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-payout.repository.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const orders = new PostgresPayoutOrderRepository();
const configs = new PostgresProviderConfigRepository();

function digestOf(token: string): string {
  return `sha256:${createHash('sha256')
    .update(token)
    .digest('base64url')}`;
}

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
}

async function freezeTx(): Promise<string> {
  return cleanupPool
    .query<{ id: string }>(
      `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
       VALUES ($1::uuid, $2, 'ADJUSTMENT') RETURNING transaction_id::text AS id`,
      [randomUUID(), `test-${randomUUID()}`]
    )
    .then((r) => r.rows[0]!.id);
}

async function createOrder(overrides: Partial<{
  orderRef: string;
  providerIdempotencyKey: string;
  beneficiaryRef: string;
  beneficiaryDigest: string;
}> = {}): Promise<{ uid: Uid; orderRef: string }> {
  const uid = await seedUser();
  const tx = await freezeTx();
  const orderRef = overrides.orderRef ?? `PO-${randomUUID().slice(0, 8)}`;
  await unitOfWork.execute((c) =>
    orders.createOrder(c, {
      orderRef,
      uid,
      sourceAssetCode: 'USDT-TRC20',
      route: 'US:USD',
      amount: '5000000',
      feeAmount: '2000',
      beneficiaryRef: overrides.beneficiaryRef ?? 'BEN-TEST-0001',
      beneficiaryDigest:
        overrides.beneficiaryDigest ?? digestOf('BEN-TEST-0001'),
      providerId: 'fake-bank-v1',
      providerConfigVersion: 1,
      providerIdempotencyKey:
        overrides.providerIdempotencyKey ?? `PPO:${orderRef}`,
      freezeLedgerTransactionId: tx
    })
  );
  return { uid, orderRef };
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
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
  ]);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s81-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s81-platform'
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

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S8-1 payout contracts and V12 schema', () => {
  it('S8PO01: the seed config lands with strict role separation', async () => {
    const config = await unitOfWork.execute((c) =>
      configs.findLatestByRoute(c, 'US:USD')
    );
    expect(config).toMatchObject({
      providerId: 'fake-bank-v1',
      configVersion: 1,
      route: 'US:USD',
      sourceAssetCode: 'USDT-TRC20',
      fixedFee: '2000',
      callbackSecretRef: 'vault:fake-bank-callback-v1'
    });
    const workerClient = await new Pool({
      connectionString: fixture.workerLogin.connectionString, max: 1
    }).connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      const readable = await workerClient.query(
        `SELECT count(*)::int AS n FROM payout_orders`
      );
      expect(readable.rows[0]?.n).toBe(0);
      await expect(
        workerClient.query(
          `INSERT INTO provider_configs
             (provider_id, config_version, provider_name, route,
              source_asset_code, fixed_fee, min_amount, max_amount,
              callback_secret_ref)
           VALUES ('hack', 1, 'H', 'US:USD', 'USDT-TRC20', 1, 1, 1,
                   'vault:x')`
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        workerClient.query(`DELETE FROM payout_orders`)
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
    await expect(
      unitOfWork.execute(async (context) => {
        await context.executeSql(
          `UPDATE provider_configs SET fixed_fee = 0`,
          []
        );
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S8PO02: order creation is idempotent by order_ref', async () => {
    const { orderRef } = await createOrder();
    const again = await createOrder({ orderRef });
    expect(again.orderRef).toBe(orderRef);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM payout_orders WHERE order_ref = $1`,
      [orderRef]
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S8PO03: the provider idempotency key is globally unique', async () => {
    await createOrder({ providerIdempotencyKey: 'PPO:SHARED-KEY' });
    await expect(createOrder({ providerIdempotencyKey: 'PPO:SHARED-KEY' }))
      .rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM payout_orders
        WHERE provider_idempotency_key = 'PPO:SHARED-KEY'`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S8PO04: status and shape CHECKs reject invalid rows', async () => {
    const uid = await seedUser();
    const tx = await freezeTx();
    const base = {
      uid,
      sourceAssetCode: 'USDT-TRC20',
      route: 'US:USD',
      amount: '1000',
      feeAmount: '0',
      beneficiaryRef: 'BEN-TEST-0002',
      beneficiaryDigest: digestOf('BEN-TEST-0002'),
      providerId: 'fake-bank-v1',
      providerConfigVersion: 1,
      freezeLedgerTransactionId: tx
    };
    const insert = (status: string | null, settlement: string | null) =>
      cleanupPool.query(
        `INSERT INTO payout_orders
           (order_ref, uid, source_asset_code, route, amount, fee_amount,
            beneficiary_ref, beneficiary_digest, status, provider_id,
            provider_config_version, provider_idempotency_key,
            ledger_transaction_id, settlement_ledger_transaction_id)
         VALUES ($1, $2::uuid, $3, $4, $5::bigint, $6::bigint, $7, $8,
                 $9, $10, $11, $12, $13::uuid, $14::uuid)`,
        [
          `PO-${randomUUID().slice(0, 8)}`, base.uid, base.sourceAssetCode,
          base.route, base.amount, base.feeAmount, base.beneficiaryRef,
          base.beneficiaryDigest, status, base.providerId,
          base.providerConfigVersion, `PPO:${randomUUID()}`,
          base.freezeLedgerTransactionId, settlement
        ]
      );
    await expect(insert('NOT_A_STATUS', null))
      .rejects.toMatchObject({ code: '23514' });
    await expect(insert('SUCCEEDED', null))
      .rejects.toMatchObject({ code: '23514' });
    await expect(
      cleanupPool.query(
        `INSERT INTO payout_orders
           (order_ref, uid, source_asset_code, route, amount,
            beneficiary_ref, beneficiary_digest, provider_id,
            provider_config_version, provider_idempotency_key,
            ledger_transaction_id)
         VALUES ($1, $2::uuid, $3, $4, $5::bigint,
                 'plain text beneficiary', $6, $7, $8, $9, $10::uuid)`,
        [
          `PO-${randomUUID().slice(0, 8)}`, base.uid, base.sourceAssetCode,
          base.route, base.amount, base.beneficiaryDigest,
          base.providerId, base.providerConfigVersion,
          `PPO:${randomUUID()}`, base.freezeLedgerTransactionId
        ]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      cleanupPool.query(
        `INSERT INTO payout_orders
           (order_ref, uid, source_asset_code, route, amount,
            beneficiary_ref, beneficiary_digest, provider_id,
            provider_config_version, provider_idempotency_key,
            ledger_transaction_id)
         VALUES ($1, $2::uuid, $3, $4, $5::bigint, $6, 'md5:deadbeef', $7,
                 $8, $9, $10::uuid)`,
        [
          `PO-${randomUUID().slice(0, 8)}`, base.uid, base.sourceAssetCode,
          base.route, base.amount, base.beneficiaryRef, base.providerId,
          base.providerConfigVersion, `PPO:${randomUUID()}`,
          base.freezeLedgerTransactionId
        ]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('S8PO05: provider configs version without overwriting', async () => {
    const before = await unitOfWork.execute((c) =>
      configs.findLatestByProvider(c, 'fake-bank-v1')
    );
    expect(before?.configVersion).toBe(1);
    await unitOfWork.execute((c) =>
      configs.insert(c, {
        providerId: 'fake-bank-v1',
        configVersion: 2,
        providerName: 'Fake Bank',
        route: 'US:USD',
        sourceAssetCode: 'USDT-TRC20',
        fixedFee: '2500',
        minAmount: '200000',
        maxAmount: '50000000',
        callbackSecretRef: 'vault:fake-bank-callback-v2'
      })
    );
    const after = await unitOfWork.execute((c) =>
      configs.findLatestByProvider(c, 'fake-bank-v1')
    );
    expect(after?.configVersion).toBe(2);
    expect(after?.fixedFee).toBe('2500');
    const rows = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM provider_configs
        WHERE provider_id = 'fake-bank-v1'`
    );
    expect(rows.rows[0]?.n).toBe(2);
    await cleanupPool.query(
      `DELETE FROM provider_configs WHERE config_version > 1`
    );
  });
});
