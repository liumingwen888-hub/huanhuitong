import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  AuthorizePaymentProofV1,
  StageOneDatabase,
  Uid,
  WithdrawalCommand
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
import {
  PostgresSignerPolicyRepository,
  PostgresWithdrawalApprovalRepository,
  PostgresWithdrawalOrderRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';
import { WithdrawalRequestService } from '../../src/modules/withdrawals/application/withdrawal-request.service.js';
import {
  WithdrawalApprovalService,
  type ApprovalDecisionResult
} from '../../src/modules/withdrawals/application/withdrawal-approval.service.js';

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
let requestService: WithdrawalRequestService;
let approvalService: WithdrawalApprovalService;

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
}

async function seedAdmin(
  role: 'FINANCE_OFFICER' | 'SUPPORT' | 'SUPER_ADMIN' = 'FINANCE_OFFICER',
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE'
): Promise<string> {
  const admin = await cleanupPool.query<{ id: string }>(
    `INSERT INTO admin_principals (status)
     VALUES ($1) RETURNING admin_id::text AS id`,
    [status]
  );
  const adminId = admin.rows[0]!.id;
  if (role !== null) {
    await cleanupPool.query(
      `INSERT INTO admin_role_grants (admin_id, role)
       VALUES ($1::uuid, $2)`,
      [adminId, role]
    );
  }
  return adminId;
}

async function seedPolicy(): Promise<void> {
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
}

async function seedDualThreshold(): Promise<void> {
  await cleanupPool.query(
    `INSERT INTO config_versions (config_key, version, payload)
     VALUES ('withdrawal.approval', 1, $1::jsonb)`,
    [JSON.stringify({ dualApprovalThreshold: '3000000' })]
  );
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

function makeCommand(uid: Uid, amount: string): WithdrawalCommand {
  const orderRef = `WD-${randomUUID().slice(0, 8)}`;
  return {
    orderRef,
    uid,
    assetCode: 'USDT-TRC20',
    amount,
    destinationAddress: 'TDestinationTestAddress'
  };
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

async function createPendingOrder(
  amount: string
): Promise<{ uid: Uid; withdrawalId: string; orderRef: string }> {
  const uid = await seedUser();
  await fundUser(uid, '100000000');
  const command = makeCommand(uid, amount);
  const result = await requestService.request(command, makeProof(command));
  expect(result.outcome).toBe('ACCEPTED');
  const order = (result as {
    order: { withdrawalId: string; status: string };
  }).order;
  expect(order.status).toBe('PENDING_APPROVAL');
  return { uid, withdrawalId: order.withdrawalId, orderRef: command.orderRef };
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
    max: 1, application_name: 'xht-s63-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s63-platform'
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
  await seedPolicy();
  await seedDualThreshold();
  requestService = new WithdrawalRequestService(
    unitOfWork, orders, policies, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  approvalService = new WithdrawalApprovalService(
    unitOfWork, orders, approvals,
    new AdminAuthorizer(unitOfWork), new ConfigStore(unitOfWork), outbox
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S6-3 Maker-Checker withdrawal approval', () => {
  it('S6WB01: admins without the required active role are denied', async () => {
    const { withdrawalId } = await createPendingOrder('2000000');
    const supportAdmin = await seedAdmin('SUPPORT');
    const suspendedAdmin = await seedAdmin('FINANCE_OFFICER', 'SUSPENDED');
    for (const adminId of [supportAdmin, suspendedAdmin]) {
      const result = await approvalService.decide({
        withdrawalId, adminId, decision: 'APPROVE'
      });
      expect(result).toEqual({
        outcome: 'DENIED', reasonCode: 'WITHDRAWAL_UNAUTHORIZED'
      });
    }
    const votes = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM withdrawal_approvals`
    );
    expect(votes.rows[0]?.n).toBe(0);
  });

  it('S6WB02: single approval below the dual threshold approves', async () => {
    const { withdrawalId, uid } = await createPendingOrder('2000000');
    const admin = await seedAdmin();
    const result = await approvalService.decide({
      withdrawalId, adminId: admin, decision: 'APPROVE'
    });
    expect(result.outcome).toBe('APPROVED');
    expect(
      (result as { order: { status: string; uid: string } }).order.status
    ).toBe('APPROVED');
    const notified = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.withdrawal-approved.v1'
          AND payload->>'uid' = $1`,
      [uid]
    );
    expect(notified.rows[0]?.n).toBe(1);
  });

  it('S6WB03: dual approval above the threshold needs two distinct admins', async () => {
    const { withdrawalId } = await createPendingOrder('3000000');
    const first = await seedAdmin();
    const second = await seedAdmin();
    const vote1 = await approvalService.decide({
      withdrawalId, adminId: first, decision: 'APPROVE'
    });
    expect(vote1.outcome).toBe('AWAITING_SECOND_APPROVAL');
    const stillPending = await unitOfWork.execute((c) =>
      orders.findById(c, withdrawalId)
    );
    expect(stillPending?.status).toBe('PENDING_APPROVAL');
    const adminEvent = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'admin.withdrawal-approval-recorded.v1'`
    );
    expect(adminEvent.rows[0]?.n).toBe(1);
    const vote2 = await approvalService.decide({
      withdrawalId, adminId: second, decision: 'APPROVE'
    });
    expect(vote2.outcome).toBe('APPROVED');
    expect((vote2 as { order: { status: string } }).order.status)
      .toBe('APPROVED');
  });

  it('S6WB04: the same admin cannot vote twice', async () => {
    const { withdrawalId } = await createPendingOrder('3000000');
    const admin = await seedAdmin();
    const first = await approvalService.decide({
      withdrawalId, adminId: admin, decision: 'APPROVE'
    });
    expect(first.outcome).toBe('AWAITING_SECOND_APPROVAL');
    const second = await approvalService.decide({
      withdrawalId, adminId: admin, decision: 'APPROVE'
    });
    expect(second).toEqual({
      outcome: 'DENIED', reasonCode: 'WITHDRAWAL_DUPLICATE_APPROVAL'
    });
    const votes = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM withdrawal_approvals`
    );
    expect(votes.rows[0]?.n).toBe(1);
  });

  it('S6WB05: rejection records approver and reason, then notifies', async () => {
    const { withdrawalId, uid } = await createPendingOrder('2000000');
    const admin = await seedAdmin();
    const result = await approvalService.decide({
      withdrawalId, adminId: admin, decision: 'REJECT',
      reason: 'suspected fraud pattern'
    });
    expect(result.outcome).toBe('REJECTED');
    const order = await unitOfWork.execute((c) =>
      orders.findById(c, withdrawalId)
    );
    expect(order?.status).toBe('REJECTED');
    expect(order?.rejectionReason).toBe('suspected fraud pattern');
    expect(order?.approverAdminId).toBe(admin);
    const notified = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.withdrawal-rejected.v1'
          AND payload->>'uid' = $1`,
      [uid]
    );
    expect(notified.rows[0]?.n).toBe(1);
  });

  it('S6WB06: a settled order cannot be approved again', async () => {
    const { withdrawalId } = await createPendingOrder('2000000');
    const rejecter = await seedAdmin();
    const approver = await seedAdmin();
    await approvalService.decide({
      withdrawalId, adminId: rejecter, decision: 'REJECT', reason: 'bad'
    });
    const late = await approvalService.decide({
      withdrawalId, adminId: approver, decision: 'APPROVE'
    });
    expect(late).toEqual({
      outcome: 'DENIED', reasonCode: 'WITHDRAWAL_NOT_PENDING_APPROVAL'
    });
  });

  it('S6WB07: missing configuration fails closed to dual approval', async () => {
    await cleanupPool.query(`DELETE FROM config_versions`);
    const { withdrawalId } = await createPendingOrder('2000000');
    const first = await seedAdmin();
    const vote1 = await approvalService.decide({
      withdrawalId, adminId: first, decision: 'APPROVE'
    });
    expect(vote1.outcome).toBe('AWAITING_SECOND_APPROVAL');
    const second = await seedAdmin();
    const vote2 = await approvalService.decide({
      withdrawalId, adminId: second, decision: 'APPROVE'
    });
    expect(vote2.outcome).toBe('APPROVED');
  });

  it('S6WB08: concurrent approvals converge to exactly one transition', async () => {
    const { withdrawalId } = await createPendingOrder('3000000');
    const adminA = await seedAdmin();
    const adminB = await seedAdmin();
    const results = await Promise.all([
      approvalService.decide({
        withdrawalId, adminId: adminA, decision: 'APPROVE'
      }),
      approvalService.decide({
        withdrawalId, adminId: adminB, decision: 'APPROVE'
      })
    ]) as ApprovalDecisionResult[];
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes.filter((o) => o === 'APPROVED')).toHaveLength(1);
    expect(outcomes).not.toContain('DENIED');
    const order = await unitOfWork.execute((c) =>
      orders.findById(c, withdrawalId)
    );
    expect(order?.status).toBe('APPROVED');
    const votes = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM withdrawal_approvals`
    );
    expect(votes.rows[0]?.n).toBe(2);
  });
});
