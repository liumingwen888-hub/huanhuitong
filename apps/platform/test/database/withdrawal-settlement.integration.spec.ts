import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  AuthorizePaymentProofV1,
  StageOneDatabase,
  Uid,
  WithdrawalCommand,
  WithdrawalOrderSnapshot
} from '@xht/contracts';
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
  PostgresLedgerAccountRepository,
  PostgresLedgerTransactionRepository
} from '../../src/modules/ledger/infrastructure/postgres-ledger.repository.js';
import { PostMoneyService } from '../../src/modules/ledger/application/post-money.service.js';
import { PostgresOutboxRepository } from '../../src/modules/reliability/outbox/outbox.repository.js';
import {
  AdminAuthorizer,
  ConfigStore,
  RiskGate
} from '../../src/modules/crosscutting/application/crosscutting.services.js';
import { FakeSigner } from '../../src/modules/signer/domain/fake-signer.js';
import {
  DeterministicBroadcasterFake
} from '../../src/modules/withdrawals/infrastructure/deterministic-broadcaster.fake.js';
import {
  PostgresSignerPolicyRepository,
  PostgresWithdrawalApprovalRepository,
  PostgresWithdrawalOrderRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';
import { WithdrawalRequestService } from '../../src/modules/withdrawals/application/withdrawal-request.service.js';
import { WithdrawalApprovalService } from '../../src/modules/withdrawals/application/withdrawal-approval.service.js';
import { WithdrawalSigningService } from '../../src/modules/withdrawals/application/withdrawal-signing.service.js';
import {
  WithdrawalBroadcastService
} from '../../src/modules/withdrawals/application/withdrawal-broadcast.service.js';
import {
  WithdrawalSettlementService
} from '../../src/modules/withdrawals/application/withdrawal-settlement.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const orders = new PostgresWithdrawalOrderRepository();
const approvals = new PostgresWithdrawalApprovalRepository();
const policies = new PostgresSignerPolicyRepository();
const outbox = new PostgresOutboxRepository();
let broadcaster: DeterministicBroadcasterFake;
let requestService: WithdrawalRequestService;
let approvalService: WithdrawalApprovalService;
let broadcastService: WithdrawalBroadcastService;
let settlementService: WithdrawalSettlementService;

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
}

async function seedAdmin(): Promise<string> {
  const admin = await cleanupPool.query<{ id: string }>(
    `INSERT INTO admin_principals (status) VALUES ('ACTIVE')
     RETURNING admin_id::text AS id`
  );
  const adminId = admin.rows[0]!.id;
  await cleanupPool.query(
    `INSERT INTO admin_role_grants (admin_id, role) VALUES ($1::uuid, 'FINANCE_OFFICER')`,
    [adminId]
  );
  return adminId;
}

async function fundUser(uid: Uid, amount: string): Promise<void> {
  const poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  const account = await unitOfWork.execute((context) =>
    ledgerAccounts.openUserAccount(context, {
      ownerUid: uid,
      assetCode: 'USDT-TRC20',
      purpose: 'USER_AVAILABLE',
      idempotencyKey: `open:${uid}:USDT-TRC20:USER_AVAILABLE`
    })
  );
  const custody = await unitOfWork.execute(async (context) => {
    const rows = await context.executeSql<{ account_id: string }>(
      `SELECT account_id FROM ledger_accounts
        WHERE owner_uid IS NULL AND asset_code = 'USDT-TRC20'
          AND purpose = 'PLATFORM_CUSTODY' LIMIT 1`
    );
    return rows.rows[0]!.account_id;
  });
  await poster.post({
    idempotencyKey: `fund-${randomUUID()}`,
    transactionType: 'DEPOSIT',
    occurredAt: new Date().toISOString(),
    lines: [
      { accountId: custody, direction: 'DEBIT', amount },
      { accountId: account.accountId, direction: 'CREDIT', amount }
    ]
  });
}

async function createOrder(
  amount: string,
  fund: string
): Promise<{ order: WithdrawalOrderSnapshot; command: WithdrawalCommand }> {
  const uid = await seedUser();
  await fundUser(uid, fund);
  const command: WithdrawalCommand = {
    orderRef: `WD-${randomUUID().slice(0, 8)}`,
    uid,
    assetCode: 'USDT-TRC20',
    amount,
    destinationAddress: 'TDestinationTestAddress'
  };
  const result = await requestService.request(
    command,
    Object.freeze({
      type: 'security.payment-authorized.v1',
      uid: command.uid,
      operationType: 'withdrawal',
      orderRef: command.orderRef,
      amountSummary: command.amount,
      assetSummary: command.assetCode,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      sessionId: randomUUID()
    }) as AuthorizePaymentProofV1
  );
  expect(result.outcome).toBe('ACCEPTED');
  return {
    order: (result as { order: WithdrawalOrderSnapshot }).order,
    command
  };
}

async function driveToBroadcast(
  amount: string,
  fund: string
): Promise<{ order: WithdrawalOrderSnapshot; txid: string }> {
  const { order } = await createOrder(amount, fund);
  await unitOfWork.execute((c) => orders.markApproved(c, order.withdrawalId));
  const broadcast = (await broadcastService.broadcast(order.withdrawalId)) as {
    broadcastTxid: string;
    order: WithdrawalOrderSnapshot;
  };
  return { order: broadcast.order, txid: broadcast.broadcastTxid };
}

async function signedBalance(
  uid: Uid,
  purpose: string
): Promise<string | null> {
  const rows = await cleanupPool.query<{ balance: string }>(
    `SELECT b.signed_balance::text AS balance
       FROM account_balances b
       JOIN ledger_accounts a ON a.account_id = b.account_id
      WHERE a.owner_uid = $1::uuid AND a.purpose = $2`,
    [uid, purpose]
  );
  return rows.rows[0]?.balance ?? null;
}

async function platformBalance(purpose: string): Promise<string> {
  const rows = await cleanupPool.query<{ balance: string }>(
    `SELECT b.signed_balance::text AS balance
       FROM account_balances b
       JOIN ledger_accounts a ON a.account_id = b.account_id
      WHERE a.owner_uid IS NULL AND a.asset_code = 'USDT-TRC20'
        AND a.purpose = $1`,
    [purpose]
  );
  return rows.rows[0]?.balance ?? '0';
}

async function ledgerCount(action: string, orderRef: string): Promise<number> {
  const rows = await cleanupPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger_transactions
      WHERE idempotency_key = $1`,
    [`WITHDRAWAL:${orderRef}:${action}:0`]
  );
  return rows.rows[0]?.n ?? 0;
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
    max: 1, application_name: 'xht-s66-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s66-platform'
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
    'outbox_messages', 'withdrawal_approvals', 'withdrawal_orders',
    'signer_policies', 'admin_role_grants', 'admin_principals',
    'config_versions', 'risk_decisions', 'operation_limits',
    'account_balances', 'ledger_entries', 'account_openings',
    'ledger_transactions', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY')`
  );
  await unitOfWork.execute((c) =>
    policies.insert(c, {
      policyVersion: 1,
      network: 'TRON',
      hotWalletAddress: 'THotWalletTest',
      feeAmount: '1000',
      minAutoAmount: '1000000',
      maxAmount: '50000000'
    })
  );
  await cleanupPool.query(
    `INSERT INTO config_versions (config_key, version, payload)
     VALUES ('withdrawal.approval', 1, $1::jsonb)`,
    [JSON.stringify({
      dualApprovalThreshold: '3000000',
      pendingTtlSeconds: 3600
    })]
  );
  broadcaster = new DeterministicBroadcasterFake();
  requestService = new WithdrawalRequestService(
    unitOfWork, orders, policies, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  approvalService = new WithdrawalApprovalService(
    unitOfWork, orders, approvals,
    new AdminAuthorizer(unitOfWork), new ConfigStore(unitOfWork), outbox
  );
  broadcastService = new WithdrawalBroadcastService(
    unitOfWork, orders, policies,
    new WithdrawalSigningService(unitOfWork, orders, policies, new FakeSigner()),
    broadcaster, outbox
  );
  settlementService = new WithdrawalSettlementService(
    unitOfWork, orders, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    broadcaster, outbox, new ConfigStore(unitOfWork)
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S6-6 withdrawal settlement and release', () => {
  it('S6WF01: full success path settles with balanced four-account effect', async () => {
    const { order } = await driveToBroadcast('2000000', '10000000');
    broadcaster.setStatus(order.broadcastTxid!, 'CONFIRMED');
    const custodyBefore = await platformBalance('PLATFORM_CUSTODY');
    const result = await settlementService.settleConfirmed(order.withdrawalId);
    expect(result.outcome).toBe('CONFIRMED');
    const settled = (result as { order: WithdrawalOrderSnapshot }).order;
    expect(settled.status).toBe('CONFIRMED');
    expect(settled.settlementLedgerTransactionId).not.toBeNull();
    expect(await ledgerCount('SETTLE', order.orderRef)).toBe(1);
    expect(await signedBalance(order.uid, 'USER_AVAILABLE')).toBe('-7999000');
    expect(await signedBalance(order.uid, 'USER_FROZEN')).toBe('0');
    expect(await signedBalance(order.uid, 'USER_FROZEN')).not.toBeNull();
    // custody is debit-normal: the on-chain payout decreases it
    const custodyAfter = await platformBalance('PLATFORM_CUSTODY');
    expect(BigInt(custodyAfter) - BigInt(custodyBefore))
      .toBe(BigInt('-2000000'));
    const notified = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.withdrawal-succeeded.v1'`
    );
    expect(notified.rows[0]?.n).toBe(1);
  });

  it('S6WF02: settling a CONFIRMED order again is denied with one SETTLE', async () => {
    const { order } = await driveToBroadcast('2000000', '10000000');
    broadcaster.setStatus(order.broadcastTxid!, 'CONFIRMED');
    await settlementService.settleConfirmed(order.withdrawalId);
    const again = await settlementService.settleConfirmed(order.withdrawalId);
    expect(again).toEqual({
      outcome: 'DENIED', reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
    });
    expect(await ledgerCount('SETTLE', order.orderRef)).toBe(1);
  });

  it('S6WF03: settling before chain confirmation is NOT_READY with zero writes', async () => {
    const { order } = await driveToBroadcast('2000000', '10000000');
    const notReady = await settlementService.settleConfirmed(order.withdrawalId);
    expect(notReady).toEqual({ outcome: 'NOT_READY', chainStatus: 'PENDING' });
    const after = await unitOfWork.execute((c) =>
      orders.findById(c, order.withdrawalId)
    );
    expect(after?.status).toBe('BROADCAST');
    expect(await ledgerCount('SETTLE', order.orderRef)).toBe(0);
  });

  it('S6WF04: fee lands in fee income; frozen carried amount only', async () => {
    const { order } = await driveToBroadcast('2000000', '10000000');
    broadcaster.setStatus(order.broadcastTxid!, 'CONFIRMED');
    await settlementService.settleConfirmed(order.withdrawalId);
    expect(await platformBalance('FEE_INCOME')).toBe('-1000');
    expect(await signedBalance(order.uid, 'USER_FROZEN')).toBe('0');
  });

  it('S6WF05: rejected order releases frozen funds back to available', async () => {
    const { order } = await createOrder('2000000', '10000000');
    const admin = await seedAdmin();
    await approvalService.decide({
      withdrawalId: order.withdrawalId, adminId: admin, decision: 'REJECT',
      reason: 'test rejection'
    });
    const released = await settlementService.release(order.withdrawalId);
    expect(released.outcome).toBe('REFUNDED');
    const refunded = (released as { order: WithdrawalOrderSnapshot }).order;
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.settlementLedgerTransactionId).not.toBeNull();
    expect(await ledgerCount('RELEASE', order.orderRef)).toBe(1);
    expect(await signedBalance(order.uid, 'USER_AVAILABLE')).toBe('-10000000');
    expect(await signedBalance(order.uid, 'USER_FROZEN')).toBe('0');
    const notified = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.withdrawal-refunded.v1'`
    );
    expect(notified.rows[0]?.n).toBe(1);
  });

  it('S6WF06: chain-failed order releases to REFUNDED', async () => {
    const { order } = await driveToBroadcast('2000000', '10000000');
    broadcaster.setStatus(order.broadcastTxid!, 'FAILED');
    await broadcastService.checkOnChainStatus(order.withdrawalId);
    const failedOrder = await unitOfWork.execute((c) =>
      orders.findById(c, order.withdrawalId)
    );
    expect(failedOrder?.status).toBe('FAILED');
    const released = await settlementService.release(order.withdrawalId);
    expect(released.outcome).toBe('REFUNDED');
    expect(await ledgerCount('RELEASE', order.orderRef)).toBe(1);
    // failed withdrawals charge no fee: full frozen amount returns
    expect(await signedBalance(order.uid, 'USER_AVAILABLE')).toBe('-10000000');
  });

  it('S6WF07: stale expiry requires config and hits only timed-out orders', async () => {
    const stale = await createOrder('2000000', '10000000');
    const fresh = await createOrder('2000000', '10000000');
    await cleanupPool.query(
      `UPDATE withdrawal_orders SET created_at = clock_timestamp() - interval '2 hours'
        WHERE withdrawal_id = $1::uuid`,
      [stale.order.withdrawalId]
    );
    const expired = await settlementService.expireStalePending(10);
    expect(expired).toEqual({
      outcome: 'EXPIRED',
      withdrawalIds: [stale.order.withdrawalId]
    });
    const released = await settlementService.release(stale.order.withdrawalId);
    expect(released.outcome).toBe('REFUNDED');
    expect(await ledgerCount('RELEASE', stale.order.orderRef)).toBe(1);
    const freshOrder = await unitOfWork.execute((c) =>
      orders.findById(c, fresh.order.withdrawalId)
    );
    expect(freshOrder?.status).toBe('PENDING_APPROVAL');
    await cleanupPool.query(`DELETE FROM config_versions`);
    const skipped = await settlementService.expireStalePending(10);
    expect(skipped).toEqual({ outcome: 'SKIPPED_NO_CONFIG' });
    const stillPending = await unitOfWork.execute((c) =>
      orders.findById(c, fresh.order.withdrawalId)
    );
    expect(stillPending?.status).toBe('PENDING_APPROVAL');
  });

  it('S6WF08: fee cannot be covered leaves the order BROADCAST un-settled', async () => {
    const { order } = await driveToBroadcast('2000000', '2000000');
    expect(await signedBalance(order.uid, 'USER_AVAILABLE')).toBe('0');
    broadcaster.setStatus(order.broadcastTxid!, 'CONFIRMED');
    const rejected = await settlementService.settleConfirmed(order.withdrawalId);
    expect(rejected).toEqual({
      outcome: 'SETTLE_REJECTED',
      reasonCode: 'WITHDRAWAL_INSUFFICIENT_FUNDS'
    });
    const after = await unitOfWork.execute((c) =>
      orders.findById(c, order.withdrawalId)
    );
    expect(after?.status).toBe('BROADCAST');
    expect(await ledgerCount('SETTLE', order.orderRef)).toBe(0);
  });
});
