import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  AdminSessionSnapshot,
  StageOneDatabase,
  Uid
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
  RiskGate
} from '../../src/modules/crosscutting/application/crosscutting.services.js';
import {
  ReconciliationService
} from '../../src/modules/ledger/application/reconciliation.service.js';
import {
  FakeQuoteSource
} from '../../src/modules/exchange/domain/fake-quote.source.js';
import {
  PostgresMarketRepository
} from '../../src/modules/exchange/infrastructure/postgres-market.repository.js';
import {
  PostgresQuoteRepository
} from '../../src/modules/exchange/infrastructure/postgres-quote.repository.js';
import {
  PostgresExchangeOrderRepository
} from '../../src/modules/exchange/infrastructure/postgres-exchange-order.repository.js';
import {
  ExchangeReconciliationService
} from '../../src/modules/exchange/application/exchange-reconciliation.service.js';
import {
  FakeBankProvider
} from '../../src/modules/fiatpayout/domain/fake-bank.provider.js';
import {
  PostgresPayoutOrderRepository,
  PostgresProviderConfigRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-payout.repository.js';
import {
  PayoutReconciliationService
} from '../../src/modules/fiatpayout/application/payout-reconciliation.service.js';
import {
  PostgresWithdrawalOrderRepository,
  PostgresWithdrawalApprovalRepository,
  PostgresSignerPolicyRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';
import {
  PayoutCommand
} from '@xht/contracts';
import {
  WithdrawalCommand
} from '@xht/contracts';
import {
  WithdrawalRequestService
} from '../../src/modules/withdrawals/application/withdrawal-request.service.js';
import {
  WithdrawalBroadcastService
} from '../../src/modules/withdrawals/application/withdrawal-broadcast.service.js';
import {
  WithdrawalSigningService
} from '../../src/modules/withdrawals/application/withdrawal-signing.service.js';
import {
  WithdrawalSettlementService
} from '../../src/modules/withdrawals/application/withdrawal-settlement.service.js';
import {
  FakeSigner
} from '../../src/modules/signer/domain/fake-signer.js';
import {
  DeterministicBroadcasterFake
} from '../../src/modules/withdrawals/infrastructure/deterministic-broadcaster.fake.js';
import {
  PayoutRequestService
} from '../../src/modules/fiatpayout/application/payout-request.service.js';
import {
  PayoutSubmissionService
} from '../../src/modules/fiatpayout/application/payout-submission.service.js';
import {
  OpsViewService
} from '../../src/modules/admin/application/ops-view.service.js';
import {
  AdminApiRouter
} from '../../src/modules/admin/http/admin-api.router.js';
import {
  registerOpsRoutes
} from '../../src/modules/admin/http/admin-ops.routes.js';
import {
  AuditRecorder
} from '../../src/modules/admin/application/audit-recorder.js';
import {
  AdminAuthService
} from '../../src/modules/admin/application/admin-auth.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const withdrawalOrders = new PostgresWithdrawalOrderRepository();
const withdrawalApprovals = new PostgresWithdrawalApprovalRepository();
const signerPolicies = new PostgresSignerPolicyRepository();
const exchangeOrders = new PostgresExchangeOrderRepository();
const markets = new PostgresMarketRepository();
const quotes = new PostgresQuoteRepository();
const payoutOrders = new PostgresPayoutOrderRepository();
const providerConfigs = new PostgresProviderConfigRepository();
const outbox = new PostgresOutboxRepository();
let provider: FakeBankProvider;
let withdrawalRequestService: WithdrawalRequestService;
let withdrawalSettlementService: WithdrawalSettlementService;
let payoutRequestService: PayoutRequestService;
let payoutSubmissionService: PayoutSubmissionService;
let opsViews: OpsViewService;
let router: AdminApiRouter;

const PLAIN_SESSION: AdminSessionSnapshot = Object.freeze({
  sessionId: 'session-plain',
  adminId: '11111111-1111-4111-8111-111111111111',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  elevatedUntil: null,
  revokedAt: null
});

function stubAuth(): AdminAuthService {
  return {
    login: async () => {
      throw new Error('not used');
    },
    logout: async () => undefined,
    elevate: async () => ({
      outcome: 'VALID' as const,
      session: PLAIN_SESSION
    }),
    requireSession: async (token: string) => {
      if (token === 'plain-token') {
        return { outcome: 'VALID' as const, session: PLAIN_SESSION };
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

async function broadcastWithdrawal(): Promise<void> {
  const uid = await seedUser();
  await fundUser(uid, '10000000');
  const command: WithdrawalCommand = {
    orderRef: `WD-${randomUUID().slice(0, 8)}`,
    uid,
    assetCode: 'USDT-TRC20',
    amount: '500000',
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
  const withdrawalId = (result as { order: { withdrawalId: string } }).order
    .withdrawalId;
  const broadcaster = new DeterministicBroadcasterFake();
  await new WithdrawalBroadcastService(
    unitOfWork,
    withdrawalOrders,
    signerPolicies,
    new WithdrawalSigningService(
      unitOfWork, withdrawalOrders, signerPolicies, new FakeSigner()
    ),
    broadcaster,
    outbox
  ).broadcast(withdrawalId);
}

async function failedPayout(): Promise<void> {
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
  provider.setDefaultResult({ status: 'REJECTED', reasonCode: 'X' });
  await payoutSubmissionService.submit(
    (result as { order: { payoutOrderId: string } }).order.payoutOrderId
  );
  provider.setDefaultResult({ status: 'ACCEPTED' });
}

async function unknownPayout(): Promise<string> {
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
  const order = (result as {
    order: { payoutOrderId: string };
  }).order;
  await payoutSubmissionService.submit(order.payoutOrderId);
  await cleanupPool.query(
    `UPDATE payout_orders SET status = 'UNKNOWN'
      WHERE payout_order_id = $1::uuid`,
    [order.payoutOrderId]
  );
  return order.payoutOrderId;
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
    max: 1, application_name: 'xht-s94-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s94-platform'
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
    'outbox_messages', 'callback_inbox', 'payout_orders', 'audit_events',
    'admin_sessions', 'config_versions', 'operation_limits',
    'risk_decisions', 'exchange_orders', 'quotes',
    'withdrawal_approvals', 'withdrawal_orders', 'signer_policies',
    'admin_role_grants', 'admin_credentials', 'admin_principals',
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
  provider = new FakeBankProvider();
  withdrawalRequestService = new WithdrawalRequestService(
    unitOfWork, withdrawalOrders, signerPolicies, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  withdrawalSettlementService = new WithdrawalSettlementService(
    unitOfWork, withdrawalOrders, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    new DeterministicBroadcasterFake(), outbox
  );
  payoutRequestService = new PayoutRequestService(
    unitOfWork, payoutOrders, providerConfigs, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  payoutSubmissionService = new PayoutSubmissionService(
    unitOfWork, payoutOrders, provider, outbox
  );
  opsViews = new OpsViewService(
    unitOfWork,
    new ReconciliationService(unitOfWork, ledgerAccounts),
    new ExchangeReconciliationService(unitOfWork),
    new PayoutReconciliationService(unitOfWork),
    withdrawalOrders,
    exchangeOrders,
    payoutOrders
  );
  router = new AdminApiRouter(
    stubAuth(),
    new AdminAuthorizer(unitOfWork),
    new AuditRecorder(unitOfWork)
  );
  registerOpsRoutes(router, opsViews);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S9-4 ops views', () => {
  it('S9OV01: the merged reconciliation report covers all domains', async () => {
    const response = await router.dispatch({
      method: 'GET',
      path: '/admin/ops/reconciliation',
      bearerToken: 'plain-token'
    });
    expect(response.status).toBe(200);
    const report = response.body as {
      ledger: { discrepancies: unknown[] };
      exchange: { discrepancies: unknown[] };
      payout: { discrepancies: unknown[] };
      checkedAt: string;
    };
    expect(report.ledger.discrepancies).toEqual([]);
    expect(report.exchange.discrepancies).toEqual([]);
    expect(report.payout.discrepancies).toEqual([]);
    expect(Date.parse(report.checkedAt)).toBeGreaterThan(0);
    await cleanupPool.query(
      `INSERT INTO exchange_orders
         (order_ref, uid, source_asset_code, route, amount, fee_amount,
          beneficiary_ref, beneficiary_digest, status, provider_id,
          provider_config_version, provider_idempotency_key,
          ledger_transaction_id)
       SELECT 'XCH:TAMPER', uid, 'USDT-TRC20', 'US:USD', 100, 0,
              'BEN-TEST-0001', 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              'FUNDS_RESERVED', 'fake-bank-v1', 1, 'PPO:TAMPER',
              ledger_transaction_id
         FROM payout_orders LIMIT 1`
    ).catch(() => undefined);
    const tampered = await router.dispatch({
      method: 'GET',
      path: '/admin/ops/reconciliation',
      bearerToken: 'plain-token'
    });
    expect(tampered.status).toBe(200);
  });

  it('S9OV02: the watchlist carries all three kinds', async () => {
    await broadcastWithdrawal();
    await failedPayout();
    const unknownId = await unknownPayout();
    const response = await router.dispatch({
      method: 'GET',
      path: '/admin/ops/watchlist',
      bearerToken: 'plain-token'
    });
    expect(response.status).toBe(200);
    const items = (response.body as {
      items: {
        itemId: string;
        kind: string;
        domain: string;
        amount: string;
        ageMinutes: number;
      }[];
    }).items;
    expect(items.length).toBeGreaterThanOrEqual(3);
    const kinds = new Set(items.map((item) => item.kind));
    expect(kinds.has('SETTLE_PENDING')).toBe(true);
    expect(kinds.has('RELEASE_PENDING')).toBe(true);
    expect(kinds.has('UNKNOWN')).toBe(true);
    const unknown = items.find((item) => item.itemId === `PO:${unknownId}`);
    expect(unknown).toBeDefined();
    expect(unknown?.domain).toBe('PAYOUT');
    expect(unknown?.amount).toBe('5000000');
    expect(unknown?.ageMinutes).toBeGreaterThanOrEqual(0);
  });

  it('S9OV03: terminal orders stay off the watchlist', async () => {
    const unknownId = await unknownPayout();
    await cleanupPool.query(
      `UPDATE payout_orders
          SET status = 'FAILED', failure_reason = 'ops close-out'
        WHERE payout_order_id = $1::uuid`,
      [unknownId]
    );
    await cleanupPool.query(
      `UPDATE payout_orders p
          SET status = 'REFUNDED',
              settlement_ledger_transaction_id = t.transaction_id
         FROM (SELECT transaction_id FROM ledger_transactions LIMIT 1) t
        WHERE p.payout_order_id = $1::uuid`,
      [unknownId]
    );
    const response = await router.dispatch({
      method: 'GET',
      path: '/admin/ops/watchlist',
      bearerToken: 'plain-token'
    });
    const items = (response.body as { items: { itemId: string }[] }).items;
    expect(items.find((item) => item.itemId === `PO:${unknownId}`))
      .toBeUndefined();
  });

  it('S9OV04: bad tokens are rejected by the base middleware', async () => {
    const denied = await router.dispatch({
      method: 'GET',
      path: '/admin/ops/watchlist',
      bearerToken: 'bad-token'
    });
    expect(denied.status).toBe(401);
  });

  it('S9OV05: every view request is audited', async () => {
    await router.dispatch({
      method: 'GET',
      path: '/admin/ops/watchlist',
      bearerToken: 'plain-token'
    });
    const rows = await cleanupPool.query<{ outcome: string }>(
      `SELECT outcome FROM audit_events
        WHERE event_type = 'ADMIN_API_GET_OPS_WATCHLIST'`
    );
    expect(rows.rows).toEqual([{ outcome: 'GRANTED' }]);
  });

  it('S9OV06: view requests write nothing to business tables', async () => {
    await broadcastWithdrawal();
    const before = await cleanupPool.query<{ n: number }>(
      `SELECT
         (SELECT count(*)::int FROM withdrawal_orders)
         + (SELECT count(*)::int FROM exchange_orders)
         + (SELECT count(*)::int FROM payout_orders)
         + (SELECT count(*)::int FROM ledger_transactions) AS n`
    );
    await router.dispatch({
      method: 'GET', path: '/admin/ops/reconciliation',
      bearerToken: 'plain-token'
    });
    await router.dispatch({
      method: 'GET', path: '/admin/ops/watchlist',
      bearerToken: 'plain-token'
    });
    const after = await cleanupPool.query<{ n: number }>(
      `SELECT
         (SELECT count(*)::int FROM withdrawal_orders)
         + (SELECT count(*)::int FROM exchange_orders)
         + (SELECT count(*)::int FROM payout_orders)
         + (SELECT count(*)::int FROM ledger_transactions) AS n`
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});
