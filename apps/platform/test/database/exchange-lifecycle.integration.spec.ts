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
import {
  ConfigStore
} from '../../src/modules/crosscutting/application/crosscutting.services.js';
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

async function confirmedOrder(
  sellAmount: string,
  fund: string
): Promise<ExchangeOrderSnapshot> {
  const uid = await seedUser();
  await fundUser(uid, fund);
  const quote = await quoteService.createQuote({
    marketKey: 'USDT-TRC20:USDT-ERC20',
    sellAmount
  });
  expect(quote.outcome).toBe('CREATED');
  const result = await confirmService.confirm({
    quoteId: (quote as { quote: { quoteId: string } }).quote.quoteId,
    uid
  });
  expect(result.outcome).toBe('CONFIRMED');
  return (result as { order: ExchangeOrderSnapshot }).order;
}

async function available(uid: string): Promise<string | null> {
  const rows = await cleanupPool.query<{ signed: string }>(
    `SELECT b.signed_balance::text AS signed
       FROM account_balances b
       JOIN ledger_accounts a ON a.account_id = b.account_id
      WHERE a.owner_uid = $1::uuid
        AND a.asset_code = 'USDT-TRC20' AND a.purpose = 'USER_AVAILABLE'`,
    [uid]
  );
  return rows.rows[0]?.signed ?? null;
}

async function releaseTxCount(orderRef: string): Promise<number> {
  const rows = await cleanupPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger_transactions
      WHERE idempotency_key = $1`,
    [`EXCHANGE:${orderRef}:RELEASE:0`]
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
    max: 1, application_name: 'xht-s75-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s75-platform'
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
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S7-5 exchange failure, expiry and release', () => {
  it('S7XR01: fail then release restores funds exactly once', async () => {
    const order = await confirmedOrder('2000000', '10000000');
    const failed = await lifecycleService.fail({
      exchangeOrderId: order.exchangeOrderId,
      reason: 'risk hold'
    });
    expect(failed.outcome).toBe('FAILED');
    expect((failed as { order: { status: string; failureReason: string } })
      .order.failureReason).toBe('risk hold');
    const released = await lifecycleService.release(order.exchangeOrderId);
    expect(released.outcome).toBe('REFUNDED');
    expect((released as { order: { status: string } }).order.status)
      .toBe('REFUNDED');
    expect(await available(order.uid)).toBe('-10000000');
    expect(await releaseTxCount(order.orderRef)).toBe(1);
    const events = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.exchange-refunded.v1'`
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it('S7XR02: an EXECUTING crash-stuck order can be released', async () => {
    const order = await confirmedOrder('2000000', '10000000');
    await unitOfWork.execute((c) =>
      orders.markExecuting(c, order.exchangeOrderId)
    );
    const failed = await lifecycleService.fail({
      exchangeOrderId: order.exchangeOrderId,
      reason: 'settlement repeatedly failing'
    });
    expect(failed.outcome).toBe('FAILED');
    const released = await lifecycleService.release(order.exchangeOrderId);
    expect(released.outcome).toBe('REFUNDED');
    const settle = await settlementService.settle(order.exchangeOrderId);
    expect(settle).toEqual({
      outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID'
    });
    expect(await available(order.uid)).toBe('-10000000');
  });

  it('S7XR03: settled orders can neither fail nor release', async () => {
    const order = await confirmedOrder('2000000', '10000000');
    await settlementService.settle(order.exchangeOrderId);
    const failed = await lifecycleService.fail({
      exchangeOrderId: order.exchangeOrderId, reason: 'late attempt'
    });
    expect(failed).toEqual({
      outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID'
    });
    const released = await lifecycleService.release(order.exchangeOrderId);
    expect(released).toEqual({
      outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID'
    });
    expect(await releaseTxCount(order.orderRef)).toBe(0);
  });

  it('S7XR04: order expiry sweeps only stale orders and needs config', async () => {
    await cleanupPool.query(
      `INSERT INTO config_versions (config_key, version, payload)
       VALUES ('exchange.execution', 1, $1::jsonb)`,
      [JSON.stringify({ settleTtlSeconds: 3600 })]
    );
    const stale = await confirmedOrder('2000000', '10000000');
    const fresh = await confirmedOrder('2000000', '10000000');
    await cleanupPool.query(
      `UPDATE exchange_orders
          SET created_at = clock_timestamp() - interval '2 hours'
        WHERE exchange_order_id = $1::uuid`,
      [stale.exchangeOrderId]
    );
    const expired = await lifecycleService.expireStaleOrders(10);
    expect(expired).toEqual({
      outcome: 'EXPIRED', ids: [stale.exchangeOrderId]
    });
    const released = await lifecycleService.release(stale.exchangeOrderId);
    expect(released.outcome).toBe('REFUNDED');
    expect(await available(stale.uid)).toBe('-10000000');
    const freshOrder = await unitOfWork.execute((c) =>
      orders.findById(c, fresh.exchangeOrderId)
    );
    expect(freshOrder?.status).toBe('FUNDS_RESERVED');
    await cleanupPool.query(`DELETE FROM config_versions`);
    const skipped = await lifecycleService.expireStaleOrders(10);
    expect(skipped).toEqual({ outcome: 'SKIPPED_NO_CONFIG' });
    const stillFine = await unitOfWork.execute((c) =>
      orders.findById(c, fresh.exchangeOrderId)
    );
    expect(stillFine?.status).toBe('FUNDS_RESERVED');
  });

  it('S7XR05: the quote sweep expires only elapsed ACTIVE quotes', async () => {
    const uid = await seedUser();
    await fundUser(uid, '10000000');
    const kept = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20', sellAmount: '2000000'
    });
    const elapsed = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20', sellAmount: '3000000'
    });
    const confirmed = await confirmedOrder('1500000', '10000000');
    await cleanupPool.query(
      `UPDATE quotes
          SET created_at = clock_timestamp() - interval '2 hours',
              expires_at = clock_timestamp() - interval '1 second'
        WHERE quote_id = $1::uuid`,
      [(elapsed as { quote: { quoteId: string } }).quote.quoteId]
    );
    const sweep = await lifecycleService.expireElapsedQuotes(10);
    expect(sweep.outcome).toBe('SWEPT');
    expect(sweep.quoteIds).toEqual([
      (elapsed as { quote: { quoteId: string } }).quote.quoteId
    ]);
    const statuses = await cleanupPool.query<{
      quote_id: string;
      status: string;
    }>(
      `SELECT quote_id::text AS quote_id, status FROM quotes`
    );
    const byId = new Map(statuses.rows.map((r) => [r.quote_id, r.status]));
    expect(
      byId.get((kept as { quote: { quoteId: string } }).quote.quoteId)
    ).toBe('ACTIVE');
    expect(
      byId.get((elapsed as { quote: { quoteId: string } }).quote.quoteId)
    ).toBe('EXPIRED');
    expect(byId.get(confirmed.quoteId)).toBe('CONSUMED');
  });

  it('S7XR06: release is idempotent-closed and empty reasons are denied', async () => {
    const order = await confirmedOrder('2000000', '10000000');
    const emptyReason = await lifecycleService.fail({
      exchangeOrderId: order.exchangeOrderId, reason: ''
    });
    expect(emptyReason).toEqual({
      outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID'
    });
    await lifecycleService.fail({
      exchangeOrderId: order.exchangeOrderId, reason: 'ops decision'
    });
    await lifecycleService.release(order.exchangeOrderId);
    const again = await lifecycleService.release(order.exchangeOrderId);
    expect(again).toEqual({
      outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID'
    });
    const reFail = await lifecycleService.fail({
      exchangeOrderId: order.exchangeOrderId, reason: 'again'
    });
    expect(reFail).toEqual({
      outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID'
    });
    expect(await releaseTxCount(order.orderRef)).toBe(1);
    expect(await available(order.uid)).toBe('-10000000');
  });
});
