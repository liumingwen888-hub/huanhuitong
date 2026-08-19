import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  ExchangeOrderSnapshot,
  StageOneDatabase,
  Uid
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
import { FakeQuoteSource } from '../../src/modules/exchange/domain/fake-quote.source.js';
import {
  PostgresMarketRepository
} from '../../src/modules/exchange/infrastructure/postgres-market.repository.js';
import {
  PostgresQuoteRepository
} from '../../src/modules/exchange/infrastructure/postgres-quote.repository.js';
import {
  PostgresExchangeOrderRepository
} from '../../src/modules/exchange/infrastructure/postgres-exchange-order.repository.js';
import { QuoteService } from '../../src/modules/exchange/application/quote.service.js';
import {
  ExchangeConfirmService
} from '../../src/modules/exchange/application/exchange-confirm.service.js';
import {
  ExchangeSettlementService
} from '../../src/modules/exchange/application/exchange-settlement.service.js';
import {
  ExchangeLifecycleService
} from '../../src/modules/exchange/application/exchange-lifecycle.service.js';
import {
  ExchangeReconciliationService
} from '../../src/modules/exchange/application/exchange-reconciliation.service.js';
import {
  ConfigStore
} from '../../src/modules/crosscutting/application/crosscutting.services.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const markets = new PostgresMarketRepository();
const quotes = new PostgresQuoteRepository();
const orders = new PostgresExchangeOrderRepository();
const outbox = new PostgresOutboxRepository();
let source: FakeQuoteSource;
let quoteService: QuoteService;
let confirmService: ExchangeConfirmService;
let settlementService: ExchangeSettlementService;
let lifecycleService: ExchangeLifecycleService;
let reconciliation: ExchangeReconciliationService;

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
}

async function fundUser(uid: Uid, assetCode: string, amount: string): Promise<void> {
  const poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  const account = await unitOfWork.execute((context) =>
    ledgerAccounts.openUserAccount(context, {
      ownerUid: uid,
      assetCode,
      purpose: 'USER_AVAILABLE',
      idempotencyKey: `open:${uid}:${assetCode}:USER_AVAILABLE`
    })
  );
  const custody = await unitOfWork.execute(async (context) => {
    const rows = await context.executeSql<{ account_id: string }>(
      `SELECT account_id FROM ledger_accounts
        WHERE owner_uid IS NULL AND asset_code = $1
          AND purpose = 'PLATFORM_CUSTODY' LIMIT 1`,
      [assetCode]
    );
    if (rows.rows.length > 0) {
      return rows.rows[0]!.account_id;
    }
    const created = await context.executeSql<{ account_id: string }>(
      `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
       VALUES (NULL, $1, 'PLATFORM_CUSTODY') RETURNING account_id`,
      [assetCode]
    );
    return created.rows[0]!.account_id;
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

async function settledOrder(
  marketKey: string,
  sellAmount: string,
  fundAsset: string,
  fundAmount: string
): Promise<ExchangeOrderSnapshot> {
  const uid = await seedUser();
  await fundUser(uid, fundAsset, fundAmount);
  const quote = await quoteService.createQuote({ marketKey, sellAmount });
  const result = await confirmService.confirm({
    quoteId: (quote as { quote: { quoteId: string } }).quote.quoteId,
    uid
  });
  const order = (result as { order: ExchangeOrderSnapshot }).order;
  await settlementService.settle(order.exchangeOrderId);
  return order;
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
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'
    ])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s76-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s76-platform'
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
    'outbox_messages', 'exchange_orders', 'quotes', 'config_versions',
    'account_balances', 'ledger_entries', 'account_openings',
    'ledger_transactions', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY')`
  );
  source = new FakeQuoteSource();
  source.setRate('USDT-TRC20:USDT-ERC20', '1', '1');
  source.setRate('BTC:USDT-TRC20', '95000', '95000');
  quoteService = new QuoteService(unitOfWork, markets, quotes, source);
  confirmService = new ExchangeConfirmService(
    unitOfWork, orders, quotes, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox
  );
  settlementService = new ExchangeSettlementService(
    unitOfWork, orders, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox
  );
  lifecycleService = new ExchangeLifecycleService(
    unitOfWork, orders, quotes, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new ConfigStore(unitOfWork)
  );
  reconciliation = new ExchangeReconciliationService(unitOfWork);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S7-6 exchange reconciliation', () => {
  it('S7RC01: a clean settled ledger reports zero discrepancies', async () => {
    await settledOrder('USDT-TRC20:USDT-ERC20', '2000000', 'USDT-TRC20', '10000000');
    await settledOrder('BTC:USDT-TRC20', '1000', 'BTC', '100000');
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([]);
    // clearing accounts aggregate per ASSET across markets: the BTC
    // market's buy leg also lands in the USDT-TRC20 clearing account
    const clearing = new Map(
      report.clearingBalances.map((c) => [c.assetCode, c.signed])
    );
    expect(clearing.get('USDT-TRC20')).toBe('-1054750');
    expect(clearing.get('USDT-ERC20')).toBe('1990000');
    expect(clearing.get('BTC')).toBe('-1000');
    const summary = new Map(
      report.marketValueSummary.map((m) => [m.marketKey, m.legValueDifference])
    );
    expect(summary.get('USDT-TRC20:USDT-ERC20')).toBe('10000');
    expect(summary.get('BTC:USDT-TRC20')).toBe('4750');
  });

  it('S7RC02: a missing SETTLE posting surfaces a linkage discrepancy', async () => {
    const order = await settledOrder(
      'USDT-TRC20:USDT-ERC20', '2000000', 'USDT-TRC20', '10000000'
    );
    // a buggy double posting duplicates the settle legs under a new
    // idempotency key (deleting the original is blocked by the order
    // FK and the SETTLED shape CHECK — the schema itself prevents
    // that tampering class)
    const rogue = randomUUID();
    await cleanupPool.query(
      `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
       VALUES ($1::uuid, $2, 'EXCHANGE')`,
      [rogue, `EXCHANGE:${order.orderRef}:SETTLE:1`]
    );
    await cleanupPool.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
       SELECT $1::uuid, e.account_id, e.direction, e.amount,
              e.entry_index + 10
         FROM ledger_entries e
         JOIN ledger_transactions t ON t.transaction_id = e.transaction_id
        WHERE t.idempotency_key = $2`,
      [rogue, `EXCHANGE:${order.orderRef}:SETTLE:0`]
    );
    const report = await reconciliation.runAll();
    // the duplicate settle also shifts clearing recomputation; the
    // linkage discrepancy itself must still be identified exactly
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
    expect(
      report.discrepancies.filter((d) => d.kind === 'CLEARING_ACCUMULATION')
    ).toHaveLength(2);
  });

  it('S7RC03: an altered order amount surfaces a snapshot mismatch', async () => {
    const order = await settledOrder(
      'USDT-TRC20:USDT-ERC20', '2000000', 'USDT-TRC20', '10000000'
    );
    await cleanupPool.query(
      `UPDATE exchange_orders SET buy_amount = buy_amount + 1
        WHERE exchange_order_id = $1::uuid`,
      [order.exchangeOrderId]
    );
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([
      {
        kind: 'QUOTE_SNAPSHOT_MISMATCH',
        orderRef: order.orderRef,
        field: 'buy_amount'
      }
    ]);
  });

  it('S7RC04: a deleted clearing entry surfaces an accumulation gap', async () => {
    await settledOrder('USDT-TRC20:USDT-ERC20', '2000000', 'USDT-TRC20', '10000000');
    await cleanupPool.query(
      `DELETE FROM ledger_entries e
        USING ledger_accounts a
        WHERE e.account_id = a.account_id
          AND a.owner_uid IS NULL AND a.purpose = 'CLEARING_DIFF'
          AND a.asset_code = 'USDT-ERC20'
          AND e.direction = 'DEBIT'`
    );
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([
      {
        kind: 'CLEARING_ACCUMULATION',
        assetCode: 'USDT-ERC20',
        expected: '0',
        actual: '1990000'
      }
    ]);
  });

  it('S7RC05: reconciliation writes nothing', async () => {
    await settledOrder('USDT-TRC20:USDT-ERC20', '2000000', 'USDT-TRC20', '10000000');
    const before = await cleanupPool.query<{
      table_name: string;
      n: number;
    }>(
      `SELECT 'ledger_entries' AS table_name, count(*)::int AS n FROM ledger_entries
       UNION ALL SELECT 'ledger_transactions', count(*)::int FROM ledger_transactions
       UNION ALL SELECT 'account_balances', count(*)::int FROM account_balances
       UNION ALL SELECT 'exchange_orders', count(*)::int FROM exchange_orders
       UNION ALL SELECT 'quotes', count(*)::int FROM quotes
       UNION ALL SELECT 'outbox_messages', count(*)::int FROM outbox_messages`
    );
    await reconciliation.runAll();
    const after = await cleanupPool.query<{
      table_name: string;
      n: number;
    }>(
      `SELECT 'ledger_entries' AS table_name, count(*)::int AS n FROM ledger_entries
       UNION ALL SELECT 'ledger_transactions', count(*)::int FROM ledger_transactions
       UNION ALL SELECT 'account_balances', count(*)::int FROM account_balances
       UNION ALL SELECT 'exchange_orders', count(*)::int FROM exchange_orders
       UNION ALL SELECT 'quotes', count(*)::int FROM quotes
       UNION ALL SELECT 'outbox_messages', count(*)::int FROM outbox_messages`
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('S7RC06: a released chain reconciles clean with both markets', async () => {
    await settledOrder('BTC:USDT-TRC20', '1000', 'BTC', '100000');
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quote = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20', sellAmount: '2000000'
    });
    const result = await confirmService.confirm({
      quoteId: (quote as { quote: { quoteId: string } }).quote.quoteId,
      uid
    });
    const order = (result as { order: ExchangeOrderSnapshot }).order;
    await lifecycleService.fail({
      exchangeOrderId: order.exchangeOrderId, reason: 'ops drill'
    });
    await lifecycleService.release(order.exchangeOrderId);
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([]);
    const summary = new Map(
      report.marketValueSummary.map((m) => [m.marketKey, m.legValueDifference])
    );
    expect(summary.has('USDT-TRC20:USDT-ERC20')).toBe(false);
    expect(summary.get('BTC:USDT-TRC20')).toBe('4750');
  });
});
