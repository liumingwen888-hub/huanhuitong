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
    if (rows.rows.length === 0) {
      const created = await context.executeSql<{ account_id: string }>(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES (NULL, $1, 'PLATFORM_CUSTODY') RETURNING account_id`,
        [assetCode]
      );
      return created.rows[0]!.account_id;
    }
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

async function createQuoteFor(
  sellAmount: string
): Promise<string> {
  const result = await quoteService.createQuote({
    marketKey: 'USDT-TRC20:USDT-ERC20',
    sellAmount
  });
  expect(result.outcome).toBe('CREATED');
  return (result as { quote: { quoteId: string } }).quote.quoteId;
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
    expect.arrayContaining(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s73-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s73-platform'
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
  quoteService = new QuoteService(unitOfWork, markets, quotes, source);
  confirmService = new ExchangeConfirmService(
    unitOfWork, orders, quotes, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S7-3 exchange confirm and freeze', () => {
  it('S7XF01: confirming freezes sell funds and consumes the quote', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await createQuoteFor('2000000');
    const result = await confirmService.confirm({ quoteId, uid });
    expect(result.outcome).toBe('CONFIRMED');
    const order = (result as {
      order: {
        status: string; sellAmount: string; buyAmount: string;
        orderRef: string; freezeLedgerTransactionId: string;
      };
    }).order;
    expect(order.status).toBe('FUNDS_RESERVED');
    expect(order.orderRef).toBe(`XCHG:${quoteId}`);
    expect(order.sellAmount).toBe('2000000');
    expect(order.buyAmount).toBe('1990000');
    expect(order.freezeLedgerTransactionId).not.toBeNull();
    const quote = await unitOfWork.execute((c) =>
      quotes.findById(c, quoteId)
    );
    expect(quote?.status).toBe('CONSUMED');
    const balances = await cleanupPool.query<{
      purpose: string;
      signed: string;
    }>(
      `SELECT a.purpose, b.signed_balance::text AS signed
         FROM account_balances b
         JOIN ledger_accounts a ON a.account_id = b.account_id
        WHERE a.owner_uid = $1::uuid AND a.asset_code = 'USDT-TRC20'`,
      [uid]
    );
    const byPurpose = new Map(balances.rows.map((r) => [r.purpose, r.signed]));
    expect(byPurpose.get('USER_AVAILABLE')).toBe('-8000000');
    expect(byPurpose.get('USER_FROZEN')).toBe('-2000000');
  });

  it('S7XF02: replaying the confirmation is idempotent', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await createQuoteFor('2000000');
    const first = await confirmService.confirm({ quoteId, uid });
    expect(first.outcome).toBe('CONFIRMED');
    const second = await confirmService.confirm({ quoteId, uid });
    expect(second.outcome).toBe('ALREADY_CONFIRMED');
    expect((second as { order: { exchangeOrderId: string } }).order
      .exchangeOrderId).toBe(
      (first as { order: { exchangeOrderId: string } }).order.exchangeOrderId
    );
    const freezes = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key = $1`,
      [`EXCHANGE:XCHG:${quoteId}:FREEZE:0`]
    );
    expect(freezes.rows[0]?.n).toBe(1);
  });

  it('S7XF03: an expired quote cannot be confirmed', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await createQuoteFor('2000000');
    await cleanupPool.query(
      `UPDATE quotes
          SET created_at = clock_timestamp() - interval '2 hours',
              expires_at = clock_timestamp() - interval '1 second'
        WHERE quote_id = $1::uuid`,
      [quoteId]
    );
    const result = await confirmService.confirm({ quoteId, uid });
    expect(result).toEqual({
      outcome: 'REJECTED', reasonCode: 'QUOTE_NOT_CONSUMABLE'
    });
    const counts = await cleanupPool.query<{ o: number; q: number }>(
      `SELECT
         (SELECT count(*)::int FROM exchange_orders) AS o,
         (SELECT count(*)::int FROM quotes WHERE status = 'CONSUMED') AS q`
    );
    expect(counts.rows[0]).toEqual({ o: 0, q: 0 });
    const quote = await unitOfWork.execute((c) =>
      quotes.findById(c, quoteId)
    );
    expect(quote?.status).toBe('ACTIVE');
  });

  it('S7XF04: concurrent confirmations converge to exactly one order', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await createQuoteFor('2000000');
    const results = await Promise.all([
      confirmService.confirm({ quoteId, uid }),
      confirmService.confirm({ quoteId, uid })
    ]);
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes.filter((o) => o === 'CONFIRMED')).toHaveLength(1);
    expect(outcomes).toContain('ALREADY_CONFIRMED');
    const rows = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM exchange_orders`
    );
    expect(rows.rows[0]?.n).toBe(1);
    const freezes = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key = $1`,
      [`EXCHANGE:XCHG:${quoteId}:FREEZE:0`]
    );
    expect(freezes.rows[0]?.n).toBe(1);
  });

  it('S7XF05: insufficient balance leaves the quote consumable', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '100000');
    const quoteId = await createQuoteFor('2000000');
    const result = await confirmService.confirm({ quoteId, uid });
    expect(result).toEqual({
      outcome: 'REJECTED', reasonCode: 'EXCHANGE_INSUFFICIENT_FUNDS'
    });
    const quote = await unitOfWork.execute((c) =>
      quotes.findById(c, quoteId)
    );
    expect(quote?.status).toBe('ACTIVE');
    const ordersCount = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM exchange_orders`
    );
    expect(ordersCount.rows[0]?.n).toBe(0);
  });

  it('S7XF06: unknown quotes and pre-consumed quotes fail closed', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const unknown = await confirmService.confirm({
      quoteId: randomUUID(), uid
    });
    expect(unknown).toEqual({
      outcome: 'REJECTED', reasonCode: 'QUOTE_NOT_FOUND'
    });
    const quoteId = await createQuoteFor('2000000');
    await cleanupPool.query(
      `UPDATE quotes SET status = 'CONSUMED' WHERE quote_id = $1::uuid`,
      [quoteId]
    );
    const consumed = await confirmService.confirm({ quoteId, uid });
    expect(consumed).toEqual({
      outcome: 'REJECTED', reasonCode: 'QUOTE_NOT_CONSUMABLE'
    });
  });

  it('S7XF07: the order snapshots the quote amounts exactly', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await createQuoteFor('1234567');
    const result = await confirmService.confirm({ quoteId, uid });
    expect(result.outcome).toBe('CONFIRMED');
    const quote = await unitOfWork.execute((c) =>
      quotes.findById(c, quoteId)
    );
    const order = (result as { order: { sellAmount: string; buyAmount: string } })
      .order;
    expect(order.sellAmount).toBe(quote?.sellAmount);
    expect(order.buyAmount).toBe(quote?.buyAmount);
  });
});
