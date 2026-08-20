import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  AuthorizePaymentProofV1,
  PayoutCommand,
  PayoutOrderSnapshot,
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
import { RiskGate } from '../../src/modules/crosscutting/application/crosscutting.services.js';
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
  PayoutSettlementService
} from '../../src/modules/fiatpayout/application/payout-settlement.service.js';
import {
  PayoutReconciliationService
} from '../../src/modules/fiatpayout/application/payout-reconciliation.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const orders = new PostgresPayoutOrderRepository();
const configs = new PostgresProviderConfigRepository();
const outbox = new PostgresOutboxRepository();
let provider: FakeBankProvider;
let requestService: PayoutRequestService;
let submissionService: PayoutSubmissionService;
let settlementService: PayoutSettlementService;
let reconciliation: PayoutReconciliationService;

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

async function reservedPayout(): Promise<PayoutOrderSnapshot> {
  const uid = await seedUser();
  await fundUser(uid, '10000000');
  const command: PayoutCommand = {
    orderRef: `PO-${randomUUID().slice(0, 8)}`,
    uid,
    route: 'US:USD',
    amount: '5000000',
    beneficiaryRef: 'BEN-TEST-0001'
  };
  const proof: AuthorizePaymentProofV1 = Object.freeze({
    type: 'security.payment-authorized.v1',
    uid,
    operationType: 'fiat-payout',
    orderRef: command.orderRef,
    amountSummary: command.amount,
    assetSummary: command.route,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sessionId: randomUUID()
  });
  const result = await requestService.request(command, proof);
  return (result as { order: PayoutOrderSnapshot }).order;
}

async function seedUpstreamFloat(): Promise<void> {
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'UPSTREAM_COST')`
  );
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'CLEARING_DIFF')`
  );
  const tx = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
    [tx, `upstream-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     SELECT $1::uuid, a.account_id,
            CASE a.purpose WHEN 'UPSTREAM_COST' THEN 'DEBIT' ELSE 'CREDIT' END,
            100000000::bigint,
            CASE a.purpose WHEN 'UPSTREAM_COST' THEN 0 ELSE 1 END
       FROM ledger_accounts a
      WHERE a.owner_uid IS NULL AND a.asset_code = 'USDT-TRC20'
        AND a.purpose IN ('UPSTREAM_COST', 'CLEARING_DIFF')`,
    [tx]
  );
  await cleanupPool.query(
    `INSERT INTO account_balances (account_id, signed_balance)
     SELECT a.account_id,
            CASE a.purpose WHEN 'UPSTREAM_COST' THEN 100000000 ELSE -100000000 END
       FROM ledger_accounts a
      WHERE a.owner_uid IS NULL AND a.asset_code = 'USDT-TRC20'
        AND a.purpose IN ('UPSTREAM_COST', 'CLEARING_DIFF')
     ON CONFLICT (account_id) DO UPDATE
        SET signed_balance = EXCLUDED.signed_balance`
  );
}

async function recordReport(
  order: PayoutOrderSnapshot,
  reportedStatus: string
): Promise<void> {
  await cleanupPool.query(
    `INSERT INTO callback_inbox
       (provider_id, provider_event_id, provider_idempotency_key, reported_status)
     VALUES ('fake-bank-v1', $1, $2, $3)`,
    [`EVT-${randomUUID().slice(0, 8)}`, order.providerIdempotencyKey,
      reportedStatus]
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
  expect(evidence.firstMigrate.appliedVersions).toEqual(
    expect.arrayContaining([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'
    ])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s87-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s87-platform'
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
    'operation_limits', 'risk_decisions', 'account_balances',
    'ledger_entries', 'account_openings', 'ledger_transactions',
    'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY')`
  );
  await seedUpstreamFloat();
  provider = new FakeBankProvider();
  requestService = new PayoutRequestService(
    unitOfWork, orders, configs, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  submissionService = new PayoutSubmissionService(
    unitOfWork, orders, provider, outbox
  );
  settlementService = new PayoutSettlementService(
    unitOfWork, orders, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox
  );
  reconciliation = new PayoutReconciliationService(unitOfWork);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S8-7 payout reconciliation', () => {
  it('S8RC01: a clean ledger across all three paths reconciles', async () => {
    const settled = await reservedPayout();
    await submissionService.submit(settled.payoutOrderId);
    await settlementService.settle(settled.payoutOrderId);
    const failedOrder = await reservedPayout();
    provider.setDefaultResult({ status: 'REJECTED', reasonCode: 'X' });
    await submissionService.submit(failedOrder.payoutOrderId);
    provider.setDefaultResult({ status: 'ACCEPTED' });
    await settlementService.release(failedOrder.payoutOrderId);
    const reversedOrder = await reservedPayout();
    await submissionService.submit(reversedOrder.payoutOrderId);
    await settlementService.settle(reversedOrder.payoutOrderId);
    await settlementService.reverse(reversedOrder.payoutOrderId);
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([]);
  });

  it('S8RC02: a duplicated settle posting surfaces a linkage gap', async () => {
    const order = await reservedPayout();
    await submissionService.submit(order.payoutOrderId);
    await settlementService.settle(order.payoutOrderId);
    const rogue = randomUUID();
    await cleanupPool.query(
      `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
       VALUES ($1::uuid, $2, 'FIAT_PAYOUT')`,
      [rogue, `FIAT_PAYOUT:${order.orderRef}:SETTLE:1`]
    );
    await cleanupPool.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
       SELECT $1::uuid, a.account_id, 5000000::bigint, 0
         FROM ledger_accounts a LIMIT 1`,
      [rogue]
    ).catch(() => undefined);
    const report = await reconciliation.runAll();
    const linkage = report.discrepancies.filter(
      (d) => d.kind === 'ORDER_LEDGER_LINKAGE'
    );
    expect(linkage).toEqual([
      {
        kind: 'ORDER_LEDGER_LINKAGE',
        orderRef: order.orderRef,
        detail: expect.stringContaining('settle=2')
      }
    ]);
  });

  it('S8RC03: a FAILED report on a settled order is the worst signal', async () => {
    const order = await reservedPayout();
    await submissionService.submit(order.payoutOrderId);
    await settlementService.settle(order.payoutOrderId);
    await recordReport(order, 'FAILED');
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([
      {
        kind: 'REPORT_ORDER_MISMATCH',
        providerIdempotencyKey: order.providerIdempotencyKey,
        reportedStatus: 'FAILED',
        orderStatus: 'SUCCEEDED'
      }
    ]);
  });

  it('S8RC04: a report without an order surfaces as an orphan', async () => {
    await cleanupPool.query(
      `INSERT INTO callback_inbox
         (provider_id, provider_event_id, provider_idempotency_key, reported_status)
       VALUES ('fake-bank-v1', $1, 'PPO:ghost:key', 'SUCCEEDED')`,
      [`EVT-${randomUUID().slice(0, 8)}`]
    );
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([
      {
        kind: 'ORPHAN_REPORT',
        providerIdempotencyKey: 'PPO:ghost:key'
      }
    ]);
  });

  it('S8RC05: reconciliation writes nothing', async () => {
    const order = await reservedPayout();
    await submissionService.submit(order.payoutOrderId);
    await settlementService.settle(order.payoutOrderId);
    const before = await cleanupPool.query<{ n: number }>(
      `SELECT
         (SELECT count(*)::int FROM ledger_entries)
         + (SELECT count(*)::int FROM ledger_transactions)
         + (SELECT count(*)::int FROM account_balances)
         + (SELECT count(*)::int FROM payout_orders)
         + (SELECT count(*)::int FROM callback_inbox)
         + (SELECT count(*)::int FROM outbox_messages) AS n`
    );
    await reconciliation.runAll();
    const after = await cleanupPool.query<{ n: number }>(
      `SELECT
         (SELECT count(*)::int FROM ledger_entries)
         + (SELECT count(*)::int FROM ledger_transactions)
         + (SELECT count(*)::int FROM account_balances)
         + (SELECT count(*)::int FROM payout_orders)
         + (SELECT count(*)::int FROM callback_inbox)
         + (SELECT count(*)::int FROM outbox_messages) AS n`
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});
