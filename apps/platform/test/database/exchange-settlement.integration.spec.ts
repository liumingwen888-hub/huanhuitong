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

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
}

async function fundUser(
  uid: Uid,
  assetCode: string,
  amount: string
): Promise<void> {
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

async function confirmedOrder(
  marketKey: string,
  sellAmount: string,
  fundAsset: string,
  fundAmount: string
): Promise<ExchangeOrderSnapshot> {
  const uid = await seedUser();
  await fundUser(uid, fundAsset, fundAmount);
  const quote = await quoteService.createQuote({ marketKey, sellAmount });
  expect(quote.outcome).toBe('CREATED');
  const quoteId = (quote as { quote: { quoteId: string } }).quote.quoteId;
  const result = await confirmService.confirm({ quoteId, uid });
  expect(result.outcome).toBe('CONFIRMED');
  return (result as { order: ExchangeOrderSnapshot }).order;
}

async function signedBalance(
  owner: string | null,
  assetCode: string,
  purpose: string
): Promise<string | null> {
  const rows = await cleanupPool.query<{ signed: string }>(
    `SELECT b.signed_balance::text AS signed
       FROM account_balances b
       JOIN ledger_accounts a ON a.account_id = b.account_id
      WHERE (a.owner_uid::text = $1 OR ($1::text IS NULL AND a.owner_uid IS NULL))
        AND a.asset_code = $2 AND a.purpose = $3`,
    [owner, assetCode, purpose]
  );
  return rows.rows[0]?.signed ?? null;
}

async function settleTxCount(orderRef: string): Promise<number> {
  const rows = await cleanupPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger_transactions
      WHERE idempotency_key = $1`,
    [`EXCHANGE:${orderRef}:SETTLE:0`]
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
    expect.arrayContaining([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'
    ])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s74-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s74-platform'
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
    'outbox_messages', 'exchange_orders', 'quotes',
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
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S7-4 exchange settlement', () => {
  it('S7XS01: same-asset cross-chain settlement balances four accounts', async () => {
    const order = await confirmedOrder(
      'USDT-TRC20:USDT-ERC20', '2000000', 'USDT-TRC20', '10000000'
    );
    const result = await settlementService.settle(order.exchangeOrderId);
    expect(result.outcome).toBe('SETTLED');
    const settled = (result as { order: ExchangeOrderSnapshot }).order;
    expect(settled.status).toBe('SETTLED');
    expect(settled.settlementLedgerTransactionId).not.toBeNull();
    expect(await signedBalance(order.uid, 'USDT-TRC20', 'USER_AVAILABLE'))
      .toBe('-8000000');
    expect(await signedBalance(order.uid, 'USDT-TRC20', 'USER_FROZEN'))
      .toBe('0');
    expect(await signedBalance(order.uid, 'USDT-ERC20', 'USER_AVAILABLE'))
      .toBe('-1990000');
    expect(await signedBalance(null, 'USDT-TRC20', 'CLEARING_DIFF'))
      .toBe('-2000000');
    expect(await signedBalance(null, 'USDT-ERC20', 'CLEARING_DIFF'))
      .toBe('1990000');
  });

  it('S7XS02: cross-asset settlement balances each asset leg', async () => {
    const order = await confirmedOrder(
      'BTC:USDT-TRC20', '1000', 'BTC', '100000'
    );
    const result = await settlementService.settle(order.exchangeOrderId);
    expect(result.outcome).toBe('SETTLED');
    expect((result as { order: { buyAmount: string } }).order.buyAmount)
      .toBe('945250');
    expect(await signedBalance(order.uid, 'BTC', 'USER_AVAILABLE'))
      .toBe('-99000');
    expect(await signedBalance(order.uid, 'BTC', 'USER_FROZEN')).toBe('0');
    expect(await signedBalance(order.uid, 'USDT-TRC20', 'USER_AVAILABLE'))
      .toBe('-945250');
    expect(await signedBalance(null, 'BTC', 'CLEARING_DIFF')).toBe('-1000');
    expect(await signedBalance(null, 'USDT-TRC20', 'CLEARING_DIFF'))
      .toBe('945250');
    const totals = await cleanupPool.query<{ d: string; c: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0)::text AS d,
              COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0)::text AS c
         FROM ledger_entries`
    );
    expect(BigInt(totals.rows[0]!.d)).toBe(BigInt(totals.rows[0]!.c));
  });

  it('S7XS03: settling is idempotent and EXECUTING re-entry converges', async () => {
    const order = await confirmedOrder(
      'USDT-TRC20:USDT-ERC20', '2000000', 'USDT-TRC20', '10000000'
    );
    await unitOfWork.execute((c) =>
      orders.markExecuting(c, order.exchangeOrderId)
    );
    const crashRecovery = await settlementService.settle(
      order.exchangeOrderId
    );
    expect(crashRecovery.outcome).toBe('SETTLED');
    const again = await settlementService.settle(order.exchangeOrderId);
    expect(again.outcome).toBe('SETTLED');
    expect(await settleTxCount(order.orderRef)).toBe(1);
  });

  it('S7XS04: settlement notifies exactly once', async () => {
    const order = await confirmedOrder(
      'USDT-TRC20:USDT-ERC20', '2000000', 'USDT-TRC20', '10000000'
    );
    await settlementService.settle(order.exchangeOrderId);
    await settlementService.settle(order.exchangeOrderId);
    const events = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.exchange-settled.v1'`
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it('S7XS05: non-settleable states are denied', async () => {
    const order = await confirmedOrder(
      'USDT-TRC20:USDT-ERC20', '2000000', 'USDT-TRC20', '10000000'
    );
    await cleanupPool.query(
      `UPDATE exchange_orders SET status = 'REFUNDED'
        WHERE exchange_order_id = $1::uuid`,
      [order.exchangeOrderId]
    );
    const denied = await settlementService.settle(order.exchangeOrderId);
    expect(denied).toEqual({
      outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID'
    });
    const unknown = await settlementService.settle(randomUUID());
    expect(unknown).toEqual({
      outcome: 'DENIED', reasonCode: 'EXCHANGE_ORDER_NOT_FOUND'
    });
  });
});
