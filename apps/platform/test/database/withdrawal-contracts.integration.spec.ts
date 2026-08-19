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
  PostgresSignerPolicyRepository,
  PostgresWithdrawalApprovalRepository,
  PostgresWithdrawalOrderRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const orders = new PostgresWithdrawalOrderRepository();
const approvals = new PostgresWithdrawalApprovalRepository();
const policies = new PostgresSignerPolicyRepository();

async function createLedgerTx(): Promise<string> {
  return cleanupPool
    .query<{ id: string }>(
      `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
       VALUES ($1::uuid, $2, 'ADJUSTMENT') RETURNING transaction_id::text AS id`,
      [randomUUID(), `test-${randomUUID()}`]
    )
    .then((r) => r.rows[0]!.id);
}

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
}

async function seedAdmin(): Promise<string> {
  return cleanupPool
    .query<{ id: string }>(
      `INSERT INTO admin_principals (status)
       VALUES ('ACTIVE') RETURNING admin_id::text AS id`
    )
    .then((r) => r.rows[0]!.id);
}

async function seedOrder(orderRef: string): Promise<string> {
  const uid = await seedUser();
  const freezeTx = await createLedgerTx();
  const order = await unitOfWork.execute((c) =>
    orders.createOrder(c, {
      orderRef,
      uid,
      assetCode: 'USDT-TRC20',
      amount: '500000',
      feeAmount: '1000',
      destinationAddress: 'TTestDestinationAddress0001',
      freezeLedgerTransactionId: freezeTx
    })
  );
  return order.withdrawalId;
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
  expect(evidence.firstMigrate.appliedVersions).toEqual(
    expect.arrayContaining(['1', '2', '3', '4', '5', '6', '7', '8'])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s61-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s61-platform'
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
    'withdrawal_approvals', 'withdrawal_orders', 'signer_policies',
    'admin_principals', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S6-1 withdrawal contracts and V8 schema', () => {
  it('S6WC01: withdrawal order is created FROZEN with idempotent order_ref', async () => {
    const uid = await seedUser();
    const freezeTx = await createLedgerTx();
    const input = {
      orderRef: 'WD-001',
      uid,
      assetCode: 'USDT-TRC20',
      amount: '500000',
      feeAmount: '1000',
      destinationAddress: 'TTestDestinationAddress0001',
      freezeLedgerTransactionId: freezeTx
    };
    const first = await unitOfWork.execute((c) => orders.createOrder(c, input));
    expect(first.status).toBe('FROZEN');
    expect(first.freezeLedgerTransactionId).toBe(freezeTx);
    expect(first.settlementLedgerTransactionId).toBeNull();
    const second = await unitOfWork.execute((c) => orders.createOrder(c, input));
    expect(second.withdrawalId).toBe(first.withdrawalId);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM withdrawal_orders`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S6WC02: status transitions are CAS-guarded against illegal jumps', async () => {
    const withdrawalId = await seedOrder('WD-CAS-1');
    const freezeTx = await createLedgerTx();
    const illegalBroadcast = await unitOfWork.execute((c) =>
      orders.markBroadcast(c, {
        withdrawalId, broadcastTxid: 'tx-illegal'
      })
    );
    expect(illegalBroadcast).toBe(false);
    const illegalConfirmed = await unitOfWork.execute((c) =>
      orders.markConfirmed(c, {
        withdrawalId, settlementLedgerTransactionId: freezeTx
      })
    );
    expect(illegalConfirmed).toBe(false);
    const happyPath = await unitOfWork.execute(async (c) => {
      const pending = await orders.markPendingApproval(c, withdrawalId);
      const approved = await orders.markApproved(c, withdrawalId);
      const signing = await orders.markSigning(c, withdrawalId);
      const broadcast = await orders.markBroadcast(c, {
        withdrawalId, broadcastTxid: 'tx-ok-1'
      });
      return { pending, approved, signing, broadcast };
    });
    expect(happyPath).toEqual({
      pending: true, approved: true, signing: true, broadcast: true
    });
    const doubleBroadcast = await unitOfWork.execute((c) =>
      orders.markBroadcast(c, {
        withdrawalId, broadcastTxid: 'tx-ok-2'
      })
    );
    expect(doubleBroadcast).toBe(false);
    const settleTx = await createLedgerTx();
    const confirmed = await unitOfWork.execute((c) =>
      orders.markConfirmed(c, {
        withdrawalId, settlementLedgerTransactionId: settleTx
      })
    );
    expect(confirmed).toBe(true);
    const afterClose = await unitOfWork.execute((c) =>
      orders.markRefunded(c, {
        withdrawalId, settlementLedgerTransactionId: settleTx
      })
    );
    expect(afterClose).toBe(false);
  });

  it('S6WC03: approvals reject duplicate admin and count only APPROVE', async () => {
    const withdrawalId = await seedOrder('WD-APR-1');
    const adminA = await seedAdmin();
    const adminB = await seedAdmin();
    const first = await unitOfWork.execute((c) =>
      approvals.record(c, {
        withdrawalId, adminId: adminA, level: 1, decision: 'APPROVE'
      })
    );
    expect(first.decision).toBe('APPROVE');
    await expect(
      unitOfWork.execute((c) =>
        approvals.record(c, {
          withdrawalId, adminId: adminA, level: 2, decision: 'APPROVE'
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    const afterDuplicate = await unitOfWork.execute((c) =>
      approvals.findByWithdrawal(c, withdrawalId)
    );
    expect(afterDuplicate).toHaveLength(1);
    await unitOfWork.execute((c) =>
      approvals.record(c, {
        withdrawalId, adminId: adminB, level: 1, decision: 'REJECT',
        reason: 'suspicious'
      })
    );
    const recorded = await unitOfWork.execute((c) =>
      approvals.findByWithdrawal(c, withdrawalId)
    );
    expect(recorded).toHaveLength(2);
    const approvedCount = await unitOfWork.execute((c) =>
      approvals.countApproved(c, withdrawalId)
    );
    expect(approvedCount).toBe(1);
  });

  it('S6WC04: signer policies version by insertion and never overwrite', async () => {
    await unitOfWork.execute((c) =>
      policies.insert(c, {
        policyVersion: 1,
        network: 'TRON',
        hotWalletAddress: 'THotWalletV1',
        feeAmount: '1000',
        minAutoAmount: '100000',
        maxAmount: '10000000'
      })
    );
    const v1 = await unitOfWork.execute((c) =>
      policies.findActive(c, 'TRON')
    );
    expect(v1?.policyVersion).toBe(1);
    await unitOfWork.execute((c) =>
      policies.insert(c, {
        policyVersion: 2,
        network: 'TRON',
        hotWalletAddress: 'THotWalletV2',
        feeAmount: '1500',
        minAutoAmount: '200000',
        maxAmount: '20000000'
      })
    );
    const v2 = await unitOfWork.execute((c) =>
      policies.findActive(c, 'TRON')
    );
    expect(v2?.policyVersion).toBe(2);
    expect(v2?.hotWalletAddress).toBe('THotWalletV2');
    const rows = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM signer_policies WHERE network = 'TRON'`
    );
    expect(rows.rows[0]?.n).toBe(2);
    const missing = await unitOfWork.execute((c) =>
      policies.findActive(c, 'BITCOIN')
    );
    expect(missing).toBeNull();
  });

  it('S6WC05: worker role has read-only access to V8 tables', async () => {
    const workerClient = await new Pool({
      connectionString: fixture.workerLogin.connectionString, max: 1
    }).connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      for (const table of [
        'withdrawal_orders', 'withdrawal_approvals', 'signer_policies'
      ]) {
        const readable = await workerClient.query(
          `SELECT count(*)::int AS n FROM ${table}`
        );
        expect(readable.rows[0]?.n).toBe(0);
      }
      await expect(
        workerClient.query(
          `INSERT INTO signer_policies
             (policy_version, network, hot_wallet_address, fee_amount,
              min_auto_amount, max_amount)
           VALUES (1, 'TRON', 'THack', 1, 1, 1)`
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        workerClient.query(`DELETE FROM withdrawal_orders`)
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
  });

  it('S6WC06: CHECK constraints reject invalid shapes at the database level', async () => {
    const uid = await seedUser();
    await expect(
      cleanupPool.query(
        `INSERT INTO withdrawal_orders
           (order_ref, uid, asset_code, amount, destination_address,
            ledger_transaction_id)
         VALUES ('WD-BAD-1', $1::uuid, 'USDT-TRC20', 0, 'TDest',
                 $2::uuid)`,
        [uid, randomUUID()]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      cleanupPool.query(
        `INSERT INTO withdrawal_orders
           (order_ref, uid, asset_code, amount, destination_address,
            ledger_transaction_id, status)
         VALUES ('WD-BAD-2', $1::uuid, 'USDT-TRC20', 100, 'TDest',
                 $2::uuid, 'REQUESTED')`,
        [uid, randomUUID()]
      )
    ).rejects.toMatchObject({ code: '23514' });
    const withdrawalId = await seedOrder('WD-SHAPE-1');
    await expect(
      cleanupPool.query(
        `UPDATE withdrawal_orders SET status = 'REJECTED'
         WHERE withdrawal_id = $1::uuid`,
        [withdrawalId]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      cleanupPool.query(
        `UPDATE withdrawal_orders SET status = 'CONFIRMED'
         WHERE withdrawal_id = $1::uuid`,
        [withdrawalId]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });
});
