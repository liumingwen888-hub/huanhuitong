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
let fakeSigner: FakeSigner;
let broadcaster: DeterministicBroadcasterFake;
let requestService: WithdrawalRequestService;
let approvalService: WithdrawalApprovalService;
let signingService: WithdrawalSigningService;
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
    `INSERT INTO admin_role_grants (admin_id, role)
     VALUES ($1::uuid, 'FINANCE_OFFICER')`,
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

function makeProof(command: WithdrawalCommand): AuthorizePaymentProofV1 {
  return Object.freeze({
    type: 'security.payment-authorized.v1',
    uid: command.uid,
    operationType: 'withdrawal',
    orderRef: command.orderRef,
    amountSummary: command.amount,
    assetSummary: command.assetCode,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sessionId: randomUUID()
  });
}

async function requestWithdrawal(
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
  const result = await requestService.request(command, makeProof(command));
  expect(result.outcome).toBe('ACCEPTED');
  return {
    order: (result as { order: WithdrawalOrderSnapshot }).order,
    command
  };
}

async function driveToSettled(
  amount: string,
  fund: string,
  options: { readonly approvals?: number } = {}
): Promise<{
  readonly order: WithdrawalOrderSnapshot;
  readonly command: WithdrawalCommand;
  readonly txid: string;
}> {
  const { order, command } = await requestWithdrawal(amount, fund);
  const needed = options.approvals ?? 0;
  for (let i = 0; i < needed; i += 1) {
    await approvalService.decide({
      withdrawalId: order.withdrawalId,
      adminId: await seedAdmin(),
      decision: 'APPROVE'
    });
  }
  if (needed === 0) {
    await unitOfWork.execute((c) =>
      orders.markApproved(c, order.withdrawalId)
    );
  }
  const broadcast = (await broadcastService.broadcast(order.withdrawalId)) as {
    broadcastTxid: string;
  };
  broadcaster.setStatus(broadcast.broadcastTxid, 'CONFIRMED');
  const settled = await settlementService.settleConfirmed(order.withdrawalId);
  expect(settled.outcome).toBe('CONFIRMED');
  const final = await unitOfWork.execute((c) =>
    orders.findById(c, order.withdrawalId)
  );
  return { order: final!, command, txid: broadcast.broadcastTxid };
}

async function accountRow(
  where: string,
  params: readonly unknown[]
): Promise<{ purpose: string; owner: string | null; signed: string }[]> {
  const rows = await cleanupPool.query<{
    purpose: string;
    owner: string | null;
    signed: string;
  }>(
    `SELECT a.purpose, a.owner_uid::text AS owner, b.signed_balance::text AS signed
       FROM account_balances b
       JOIN ledger_accounts a ON a.account_id = b.account_id
      WHERE ${where}`,
    params
  );
  return rows.rows;
}

async function ledgerTxCount(action: string, orderRef: string): Promise<number> {
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
    max: 1, application_name: 'xht-s6a-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s6a-platform'
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
  fakeSigner = new FakeSigner();
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
  signingService = new WithdrawalSigningService(
    unitOfWork, orders, policies, fakeSigner
  );
  broadcastService = new WithdrawalBroadcastService(
    unitOfWork, orders, policies, signingService, broadcaster, outbox
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

describe.sequential('S6-8 stage six acceptance', () => {
  it('S6A01: low-amount auto track settles end to end', async () => {
    const { order } = await driveToSettled('500000', '10000000');
    expect(order.status).toBe('CONFIRMED');
    const user = await accountRow('a.owner_uid = $1::uuid', [order.uid]);
    const byPurpose = new Map(user.map((r) => [r.purpose, r.signed]));
    // 10,000,000 funded - 500,000 withdrawn - 1,000 fee
    expect(byPurpose.get('USER_AVAILABLE')).toBe('-9499000');
    expect(byPurpose.get('USER_FROZEN')).toBe('0');
    const platform = await accountRow(
      'a.owner_uid IS NULL AND a.asset_code = $1',
      ['USDT-TRC20']
    );
    const platformMap = new Map(platform.map((r) => [r.purpose, r.signed]));
    const custody = BigInt(platformMap.get('PLATFORM_CUSTODY') ?? '0');
    const feeIncome = BigInt(platformMap.get('FEE_INCOME') ?? '0');
    expect(feeIncome).toBe(BigInt('-1000'));
    // funding put +10,000,000 into custody; payout removed 500,000
    expect(custody).toBe(BigInt('9500000'));
  });

  it('S6A02: high-amount dual approval settles end to end', async () => {
    const { order } = await driveToSettled('5000000', '20000000', {
      approvals: 2
    });
    expect(order.status).toBe('CONFIRMED');
    expect(order.settlementLedgerTransactionId).not.toBeNull();
  });

  it('S6A03: rejection refunds the full frozen amount', async () => {
    const { order } = await requestWithdrawal('2000000', '10000000');
    const admin = await seedAdmin();
    await approvalService.decide({
      withdrawalId: order.withdrawalId, adminId: admin, decision: 'REJECT',
      reason: 'acceptance rejection'
    });
    const released = await settlementService.release(order.withdrawalId);
    expect(released.outcome).toBe('REFUNDED');
    const user = await accountRow('a.owner_uid = $1::uuid', [order.uid]);
    const byPurpose = new Map(user.map((r) => [r.purpose, r.signed]));
    expect(byPurpose.get('USER_AVAILABLE')).toBe('-10000000');
    expect(byPurpose.get('USER_FROZEN')).toBe('0');
  });

  it('S6A04: chain failure refunds after authoritative FAILED', async () => {
    const { order } = await requestWithdrawal('2000000', '10000000');
    await unitOfWork.execute((c) => orders.markApproved(c, order.withdrawalId));
    const broadcast = (await broadcastService.broadcast(order.withdrawalId)) as {
      broadcastTxid: string;
    };
    broadcaster.setStatus(broadcast.broadcastTxid, 'FAILED');
    const checked = await broadcastService.checkOnChainStatus(
      order.withdrawalId
    );
    expect(checked.outcome).toBe('FAILED_MARKED');
    const released = await settlementService.release(order.withdrawalId);
    expect(released.outcome).toBe('REFUNDED');
    const user = await accountRow('a.owner_uid = $1::uuid', [order.uid]);
    const byPurpose = new Map(user.map((r) => [r.purpose, r.signed]));
    expect(byPurpose.get('USER_AVAILABLE')).toBe('-10000000');
  });

  it('S6A05: expiry sweeps only stale orders and refunds', async () => {
    const stale = await requestWithdrawal('2000000', '10000000');
    const fresh = await requestWithdrawal('2000000', '10000000');
    await cleanupPool.query(
      `UPDATE withdrawal_orders
          SET created_at = clock_timestamp() - interval '2 hours'
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
    const freshOrder = await unitOfWork.execute((c) =>
      orders.findById(c, fresh.order.withdrawalId)
    );
    expect(freshOrder?.status).toBe('PENDING_APPROVAL');
  });

  it('S6A06: replaying every step leaves one ledger effect per action', async () => {
    const { order, command } = await requestWithdrawal('500000', '10000000');
    await unitOfWork.execute((c) => orders.markApproved(c, order.withdrawalId));
    // signing is idempotent while the order sits in SIGNING
    await signingService.signForBroadcast(order.withdrawalId);
    await signingService.signForBroadcast(order.withdrawalId);
    // crash window: the chain accepted the transaction but the
    // markBroadcast write never happened — order stays SIGNING
    const beforeCrash = await broadcaster.broadcast({
      network: 'TRON',
      fromAddress: 'THotWalletTest',
      toAddress: 'TDestinationTestAddress',
      amount: '500000',
      feeRate: '1000'
    });
    const replay = (await broadcastService.broadcast(order.withdrawalId)) as {
      broadcastTxid: string;
    };
    expect(replay.broadcastTxid).toBe(beforeCrash.broadcastTxid);
    broadcaster.setStatus(replay.broadcastTxid, 'CONFIRMED');
    await settlementService.settleConfirmed(order.withdrawalId);
    // settling a CONFIRMED order again is denied, not duplicated
    const resettle = await settlementService.settleConfirmed(order.withdrawalId);
    expect(resettle).toEqual({
      outcome: 'DENIED', reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
    });
    const replayRequest = await requestService.request(
      command, makeProof(command)
    );
    expect(replayRequest.outcome).toBe('ALREADY_REQUESTED');
    expect(await ledgerTxCount('FREEZE', command.orderRef)).toBe(1);
    expect(await ledgerTxCount('SETTLE', command.orderRef)).toBe(1);
  });

  it('S6A07: unknown broadcast outcome recovers on retry', async () => {
    const { order } = await requestWithdrawal('500000', '10000000');
    await unitOfWork.execute((c) => orders.markApproved(c, order.withdrawalId));
    broadcaster.setShouldThrow(true);
    const unknown = await broadcastService.broadcast(order.withdrawalId);
    expect(unknown).toEqual({ outcome: 'UNKNOWN' });
    const stuck = await unitOfWork.execute((c) =>
      orders.findById(c, order.withdrawalId)
    );
    expect(stuck?.status).toBe('SIGNING');
    broadcaster.setShouldThrow(false);
    const recovered = await broadcastService.broadcast(order.withdrawalId);
    expect(recovered.outcome).toBe('BROADCAST');
  });

  it('S6A08: concurrent dual approval converges to one transition', async () => {
    const { order } = await requestWithdrawal('5000000', '20000000');
    const adminA = await seedAdmin();
    const adminB = await seedAdmin();
    const results = await Promise.all([
      approvalService.decide({
        withdrawalId: order.withdrawalId, adminId: adminA, decision: 'APPROVE'
      }),
      approvalService.decide({
        withdrawalId: order.withdrawalId, adminId: adminB, decision: 'APPROVE'
      })
    ]);
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes.filter((o) => o === 'APPROVED')).toHaveLength(1);
    const final = await unitOfWork.execute((c) =>
      orders.findById(c, order.withdrawalId)
    );
    expect(final?.status).toBe('APPROVED');
    const votes = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM withdrawal_approvals`
    );
    expect(votes.rows[0]?.n).toBe(2);
  });

  it('S6A09: ledger stays balanced and projections match truth', async () => {
    await driveToSettled('500000', '10000000');
    await driveToSettled('5000000', '20000000', { approvals: 2 });
    const totals = await cleanupPool.query<{ debits: string; credits: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0)::text AS debits,
              COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0)::text AS credits
         FROM ledger_entries`
    );
    expect(totals.rows[0]).toBeDefined();
    expect(BigInt(totals.rows[0]!.debits))
      .toBe(BigInt(totals.rows[0]!.credits));
    const mismatches = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM account_balances b
        WHERE b.signed_balance <> (
          SELECT COALESCE(SUM(
            CASE e.direction WHEN 'DEBIT' THEN e.amount ELSE -e.amount END
          ), 0)
            FROM ledger_entries e
           WHERE e.account_id = b.account_id
        )`
    );
    expect(mismatches.rows[0]?.n).toBe(0);
  });

  it('S6A10: the success chain emits exactly the expected topics', async () => {
    const { order } = await driveToSettled('5000000', '20000000', {
      approvals: 2
    });
    const topics = await cleanupPool.query<{ topic: string; n: number }>(
      `SELECT topic, count(*)::int AS n FROM outbox_messages
        WHERE topic LIKE 'telegram.withdrawal-%'
           OR topic LIKE 'admin.withdrawal-%'
        GROUP BY topic ORDER BY topic`
    );
    const byTopic = new Map(topics.rows.map((r) => [r.topic, r.n]));
    expect(byTopic.get('admin.withdrawal-pending-approval.v1')).toBe(1);
    expect(byTopic.get('admin.withdrawal-approval-recorded.v1')).toBe(1);
    expect(byTopic.get('telegram.withdrawal-requested.v1')).toBe(1);
    expect(byTopic.get('telegram.withdrawal-approved.v1')).toBe(1);
    expect(byTopic.get('telegram.withdrawal-broadcast.v1')).toBe(1);
    expect(byTopic.get('telegram.withdrawal-succeeded.v1')).toBe(1);
    expect(byTopic.has('telegram.withdrawal-failed.v1')).toBe(false);
    expect(byTopic.has('telegram.withdrawal-rejected.v1')).toBe(false);
    expect(order.status).toBe('CONFIRMED');
  });

  it('S6A11: withdrawal outbox payloads carry no sensitive fields', async () => {
    await driveToSettled('500000', '10000000');
    const leaks = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic LIKE '%withdrawal%'
          AND (
            payload::text ~* '"(password|secret|privatekey|private_key|mnemonic|seed|digest)"'
            OR payload::text ~* '"key"'
          )`
    );
    expect(leaks.rows[0]?.n).toBe(0);
  });

  it('S6A12: terminal orders carry both ledger links, open ones neither', async () => {
    const settled = await driveToSettled('500000', '10000000');
    const releasedOrder = await requestWithdrawal('2000000', '10000000');
    const admin = await seedAdmin();
    await approvalService.decide({
      withdrawalId: releasedOrder.order.withdrawalId,
      adminId: admin, decision: 'REJECT', reason: 'x'
    });
    await settlementService.release(releasedOrder.order.withdrawalId);
    const rows = await cleanupPool.query<{
      status: string;
      freeze: string | null;
      settlement: string | null;
    }>(
      `SELECT status, ledger_transaction_id::text AS freeze,
              settlement_ledger_transaction_id::text AS settlement
         FROM withdrawal_orders`
    );
    const byStatus = new Map(rows.rows.map((r) => [r.status, r]));
    const confirmed = byStatus.get('CONFIRMED');
    expect(confirmed?.freeze).not.toBeNull();
    expect(confirmed?.settlement).not.toBeNull();
    const refunded = byStatus.get('REFUNDED');
    expect(refunded?.freeze).not.toBeNull();
    expect(refunded?.settlement).not.toBeNull();
    expect(settled.order.status).toBe('CONFIRMED');
  });
});
