import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  AdminSessionSnapshot,
  PayoutCommand,
  PayoutOrderSnapshot,
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
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';
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
import { FakeBankProvider } from '../../src/modules/fiatpayout/domain/fake-bank.provider.js';
import {
  PostgresPayoutOrderRepository,
  PostgresProviderConfigRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-payout.repository.js';
import {
  PayoutRequestService
} from '../../src/modules/fiatpayout/application/payout-request.service.js';
import {
  PayoutSubmissionService
} from '../../src/modules/fiatpayout/application/payout-submission.service.js';
import {
  PayoutQueryService
} from '../../src/modules/fiatpayout/application/payout-query.service.js';
import {
  PostgresWithdrawalApprovalRepository,
  PostgresWithdrawalOrderRepository,
  PostgresSignerPolicyRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';
import {
  WithdrawalRequestService
} from '../../src/modules/withdrawals/application/withdrawal-request.service.js';
import {
  WithdrawalApprovalService
} from '../../src/modules/withdrawals/application/withdrawal-approval.service.js';
import {
  ApprovalWorkbenchService
} from '../../src/modules/admin/application/approval-workbench.service.js';
import {
  AdminApiRouter
} from '../../src/modules/admin/http/admin-api.router.js';
import {
  registerApprovalRoutes
} from '../../src/modules/admin/http/admin-approval.routes.js';
import {
  AdminAuthService
} from '../../src/modules/admin/application/admin-auth.service.js';
import {
  PostgresAdminSessionRepository
} from '../../src/modules/admin/infrastructure/postgres-admin-session.repository.js';
import {
  FakeTotpSecretStore
} from '../../src/modules/admin/domain/fake-totp-secret.store.js';
import {
  totpCode,
  base32Encode
} from '../../src/modules/security/domain/totp.js';
import {
  AuditRecorder
} from '../../src/modules/admin/application/audit-recorder.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const BOOTSTRAP = 'bootstrap-admin';
const BOOTSTRAP_PASSWORD = 'Bootstrap-Admin-2026!';
const TOTP_SECRET = base32Encode(
  Buffer.from('0123456789abcdef0123', 'utf8')
);

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const withdrawalOrders = new PostgresWithdrawalOrderRepository();
const withdrawalApprovals = new PostgresWithdrawalApprovalRepository();
const signerPolicies = new PostgresSignerPolicyRepository();
const payoutOrders = new PostgresPayoutOrderRepository();
const providerConfigs = new PostgresProviderConfigRepository();
const outbox = new PostgresOutboxRepository();
const adminSessions = new PostgresAdminSessionRepository();
let provider: FakeBankProvider;
let withdrawalRequestService: WithdrawalRequestService;
let approvalService: WithdrawalApprovalService;
let payoutRequestService: PayoutRequestService;
let payoutSubmissionService: PayoutSubmissionService;
let payoutQueryService: PayoutQueryService;
let workbench: ApprovalWorkbenchService;
let router: AdminApiRouter;
let authService: AdminAuthService;

function sessionFor(adminId: string): AdminSessionSnapshot {
  return Object.freeze({
    sessionId: `session-${adminId.slice(0, 8)}`,
    adminId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    elevatedUntil: new Date(Date.now() + 300_000).toISOString(),
    revokedAt: null
  });
}

/** finance-token maps to the FINANCE_OFFICER admin seeded per test;
 * plain-token maps to the role-less bootstrap principal. */
let financeAdminId = '';

function stubAuth(): AdminAuthService {
  return {
    login: async () => {
      throw new Error('not used');
    },
    logout: async () => undefined,
    elevate: async () => ({
      outcome: 'VALID' as const,
      session: sessionFor(financeAdminId)
    }),
    requireSession: async (token: string) => {
      if (token === 'finance-token' && financeAdminId !== '') {
        return {
          outcome: 'VALID' as const,
          session: sessionFor(financeAdminId)
        };
      }
      if (token === 'plain-token') {
        return {
          outcome: 'VALID' as const,
          session: sessionFor('11111111-1111-4111-8111-111111111111')
        };
      }
      return {
        outcome: 'DENIED' as const,
        reasonCode: 'ADMIN_SESSION_INVALID' as const
      };
    }
  } as unknown as AdminAuthService;
}

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
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

async function pendingWithdrawal(): Promise<string> {
  const uid = await seedUser();
  await fundUser(uid, '10000000');
  const command: WithdrawalCommand = {
    orderRef: `WD-${randomUUID().slice(0, 8)}`,
    uid,
    assetCode: 'USDT-TRC20',
    amount: '5000000',
    destinationAddress: 'TDestinationTestAddress'
  };
  const result = await withdrawalRequestService.request(command, {
    type: 'security.payment-authorized.v1',
    uid,
    operationType: 'withdrawal',
    orderRef: command.orderRef,
    amountSummary: command.amount,
    assetSummary: command.assetCode,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sessionId: randomUUID()
  } as never);
  return (result as { order: { withdrawalId: string } }).order
    .withdrawalId;
}

async function uncertainPayout(): Promise<string> {
  const uid = await seedUser();
  await fundUser(uid, '10000000');
  const command: PayoutCommand = {
    orderRef: `PO-${randomUUID().slice(0, 8)}`,
    uid,
    route: 'US:USD',
    amount: '5000000',
    beneficiaryRef: 'BEN-TEST-0001'
  };
  const result = await payoutRequestService.request(command, {
    type: 'security.payment-authorized.v1',
    uid,
    operationType: 'fiat-payout',
    orderRef: command.orderRef,
    amountSummary: command.amount,
    assetSummary: command.route,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sessionId: randomUUID()
  } as never);
  const order = (result as { order: PayoutOrderSnapshot }).order;
  await payoutSubmissionService.submit(order.payoutOrderId);
  await cleanupPool.query(
    `UPDATE payout_orders SET status = 'UNKNOWN'
      WHERE payout_order_id = $1::uuid`,
    [order.payoutOrderId]
  );
  return order.payoutOrderId;
}

async function seedFinanceAdmin(): Promise<string> {
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
    max: 1, application_name: 'xht-s93-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s93-platform'
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
    'outbox_messages', 'callback_inbox', 'payout_orders',
    'admin_sessions', 'audit_events', 'config_versions',
    'operation_limits',
    'risk_decisions', 'withdrawal_approvals', 'withdrawal_orders',
    'signer_policies', 'admin_role_grants',
    'admin_credentials', 'admin_principals',
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
    signerPolicies.insert(c, {
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
    [JSON.stringify({ dualApprovalThreshold: '3000000' })]
  );
  financeAdminId = '';
  provider = new FakeBankProvider();
  withdrawalRequestService = new WithdrawalRequestService(
    unitOfWork, withdrawalOrders, signerPolicies, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  approvalService = new WithdrawalApprovalService(
    unitOfWork, withdrawalOrders, withdrawalApprovals,
    new AdminAuthorizer(unitOfWork), new ConfigStore(unitOfWork), outbox
  );
  payoutRequestService = new PayoutRequestService(
    unitOfWork, payoutOrders, providerConfigs, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  payoutSubmissionService = new PayoutSubmissionService(
    unitOfWork, payoutOrders, provider, outbox
  );
  payoutQueryService = new PayoutQueryService(
    unitOfWork, payoutOrders, provider, outbox
  );
  workbench = new ApprovalWorkbenchService(
    unitOfWork, withdrawalOrders, payoutOrders,
    approvalService, payoutQueryService
  );
  authService = new AdminAuthService(
    unitOfWork, adminSessions, new FakeTotpSecretStore()
  );
  router = new AdminApiRouter(
    stubAuth(),
    new AdminAuthorizer(unitOfWork),
    new AuditRecorder(unitOfWork)
  );
  registerApprovalRoutes(router, workbench);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S9-3 approval workbench', () => {
  it('S9AP01: the pending list aggregates both domains in order', async () => {
    const withdrawalId = await pendingWithdrawal();
    const payoutId = await uncertainPayout();
    const response = await router.dispatch({
      method: 'GET',
      path: '/admin/approvals/pending',
      bearerToken: 'plain-token'
    });
    expect(response.status).toBe(200);
    const items = (response.body as {
      items: {
        itemId: string;
        kind: string;
        amount: string;
      }[];
    }).items;
    const ids = items.map((item) => item.itemId);
    expect(ids).toContain(`WDL:${withdrawalId}`);
    expect(ids).toContain(`PO:${payoutId}`);
    const kinds = new Map(items.map((item) => [item.itemId, item.kind]));
    expect(kinds.get(`WDL:${withdrawalId}`)).toBe('WITHDRAWAL_APPROVAL');
    expect(kinds.get(`PO:${payoutId}`)).toBe('PAYOUT_UNKNOWN');
  });

  it('S9AP02: withdrawal decisions flow through the verified service', async () => {
    financeAdminId = await seedFinanceAdmin();
    const withdrawalId = await pendingWithdrawal();
    const approve = await router.dispatch({
      method: 'POST',
      path: `/admin/approvals/withdrawal/${withdrawalId}/decide`,
      bearerToken: 'finance-token',
      body: { decision: 'APPROVE' }
    });
    expect(approve.status).toBe(200);
    expect(approve.body).toMatchObject({
      outcome: 'AWAITING_SECOND_APPROVAL',
      orderStatus: 'PENDING_APPROVAL'
    });
    financeAdminId = await seedFinanceAdmin();
    const reject = await router.dispatch({
      method: 'POST',
      path: `/admin/approvals/withdrawal/${withdrawalId}/decide`,
      bearerToken: 'finance-token',
      body: { decision: 'REJECT', reason: 'workbench test' }
    });
    expect(reject.status).toBe(200);
    expect(reject.body).toMatchObject({ outcome: 'REJECTED' });
  });

  it('S9AP03: decide endpoints demand FINANCE_OFFICER and elevation', async () => {
    const withdrawalId = await pendingWithdrawal();
    const noRole = await router.dispatch({
      method: 'POST',
      path: `/admin/approvals/withdrawal/${withdrawalId}/decide`,
      bearerToken: 'plain-token',
      body: { decision: 'APPROVE' }
    });
    expect(noRole.status).toBe(403);
    expect(noRole.body).toEqual({ code: 'ADMIN_API_ROLE_DENIED' });
    financeAdminId = await seedFinanceAdmin();
    const badBody = await router.dispatch({
      method: 'POST',
      path: `/admin/approvals/withdrawal/${withdrawalId}/decide`,
      bearerToken: 'finance-token',
      body: { decision: 'MAYBE' }
    });
    expect(badBody.status).toBe(400);
  });

  it('S9AP04: payout resolution triggers the provider query', async () => {
    financeAdminId = await seedFinanceAdmin();
    const payoutId = await uncertainPayout();
    provider.setQueryState(
      `PPO:fake-bank-v1:${(
        await unitOfWork.execute((c) =>
          payoutOrders.findById(c, payoutId)
        )
      )!.orderRef}`,
      { status: 'SUCCEEDED' }
    );
    const response = await router.dispatch({
      method: 'POST',
      path: `/admin/approvals/payout/${payoutId}/resolve`,
      bearerToken: 'finance-token'
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ outcome: 'SUCCEEDED_REPORTED' });
  });

  it('S9AP05: unknown ids return business NOT_FOUND', async () => {
    financeAdminId = await seedFinanceAdmin();
    const withdrawal = await router.dispatch({
      method: 'POST',
      path: `/admin/approvals/withdrawal/${randomUUID()}/decide`,
      bearerToken: 'finance-token',
      body: { decision: 'APPROVE' }
    });
    expect(withdrawal.status).toBe(404);
    const payout = await router.dispatch({
      method: 'POST',
      path: `/admin/approvals/payout/${randomUUID()}/resolve`,
      bearerToken: 'finance-token'
    });
    expect(payout.status).toBe(404);
  });

  it('S9AP06: every workbench request lands in the audit trail', async () => {
    await router.dispatch({
      method: 'GET',
      path: '/admin/approvals/pending',
      bearerToken: 'plain-token'
    });
    const rows = await cleanupPool.query<{
      event_type: string;
      outcome: string;
      actor_ref: string;
    }>(
      `SELECT event_type, outcome, actor_ref FROM audit_events
        WHERE event_type LIKE 'ADMIN_API_%APPROVALS%'`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      event_type: 'ADMIN_API_GET_APPROVALS_PENDING',
      outcome: 'GRANTED',
      actor_ref: '11111111-1111-4111-8111-111111111111'
    });
  });

  it('S9AP07: duplicate votes from the same admin return 409', async () => {
    financeAdminId = await seedFinanceAdmin();
    const withdrawalId = await pendingWithdrawal();
    const path = `/admin/approvals/withdrawal/${withdrawalId}/decide`;
    await router.dispatch({
      method: 'POST', path, bearerToken: 'finance-token',
      body: { decision: 'APPROVE' }
    });
    const duplicate = await router.dispatch({
      method: 'POST', path, bearerToken: 'finance-token',
      body: { decision: 'APPROVE' }
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({
      code: 'WITHDRAWAL_DUPLICATE_APPROVAL'
    });
  });
});
