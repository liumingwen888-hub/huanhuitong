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
import {
  ExchangeReconciliationService
} from '../../src/modules/exchange/application/exchange-reconciliation.service.js';

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

async function quoteIdFor(
  marketKey: string,
  sellAmount: string
): Promise<string> {
  const result = await quoteService.createQuote({ marketKey, sellAmount });
  expect(result.outcome).toBe('CREATED');
  return (result as { quote: { quoteId: string } }).quote.quoteId;
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

async function txCount(action: string, orderRef: string): Promise<number> {
  const rows = await cleanupPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger_transactions
      WHERE idempotency_key LIKE $1`,
    [`EXCHANGE:${orderRef}:${action}:%`]
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
    max: 1, application_name: 'xht-s7a-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s7a-platform'
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

describe.sequential('S7-8 stage seven acceptance', () => {
  it('S7A01: same-asset chain settles end to end', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
    const confirmed = await confirmService.confirm({ quoteId, uid });
    expect(confirmed.outcome).toBe('CONFIRMED');
    const settled = await settlementService.settle(
      (confirmed as { order: ExchangeOrderSnapshot }).order.exchangeOrderId
    );
    expect(settled.outcome).toBe('SETTLED');
    expect(await signedBalance(uid, 'USDT-TRC20', 'USER_AVAILABLE'))
      .toBe('-8000000');
    expect(await signedBalance(uid, 'USDT-TRC20', 'USER_FROZEN')).toBe('0');
    expect(await signedBalance(uid, 'USDT-ERC20', 'USER_AVAILABLE'))
      .toBe('-1990000');
  });

  it('S7A02: cross-asset chain settles with exact proceeds', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'BTC', '100000');
    const quoteId = await quoteIdFor('BTC:USDT-TRC20', '1000');
    const confirmed = await confirmService.confirm({ quoteId, uid });
    const order = (confirmed as { order: ExchangeOrderSnapshot }).order;
    expect(order.buyAmount).toBe('945250');
    const settled = await settlementService.settle(order.exchangeOrderId);
    expect(settled.outcome).toBe('SETTLED');
    expect(await signedBalance(uid, 'USDT-TRC20', 'USER_AVAILABLE'))
      .toBe('-945250');
    expect(await signedBalance(uid, 'BTC', 'USER_FROZEN')).toBe('0');
  });

  it('S7A03: failure then release restores funds', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
    const confirmed = await confirmService.confirm({ quoteId, uid });
    const order = (confirmed as { order: ExchangeOrderSnapshot }).order;
    await lifecycleService.fail({
      exchangeOrderId: order.exchangeOrderId, reason: 'acceptance'
    });
    const released = await lifecycleService.release(order.exchangeOrderId);
    expect(released.outcome).toBe('REFUNDED');
    expect(await signedBalance(uid, 'USDT-TRC20', 'USER_AVAILABLE'))
      .toBe('-10000000');
    expect(await signedBalance(uid, 'USDT-TRC20', 'USER_FROZEN')).toBe('0');
  });

  it('S7A04: expiry sweep releases stale orders only', async () => {
    await cleanupPool.query(
      `INSERT INTO config_versions (config_key, version, payload)
       VALUES ('exchange.execution', 1, $1::jsonb)`,
      [JSON.stringify({ settleTtlSeconds: 3600 })]
    );
    const staleUid = await seedUser();
    await fundUser(staleUid, 'USDT-TRC20', '10000000');
    const staleQuote = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
    const staleConfirmed = await confirmService.confirm({
      quoteId: staleQuote, uid: staleUid
    });
    const freshUid = await seedUser();
    await fundUser(freshUid, 'USDT-TRC20', '10000000');
    const freshQuote = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
    await confirmService.confirm({ quoteId: freshQuote, uid: freshUid });
    const staleOrder = (staleConfirmed as {
      order: ExchangeOrderSnapshot;
    }).order;
    await cleanupPool.query(
      `UPDATE exchange_orders
          SET created_at = clock_timestamp() - interval '2 hours'
        WHERE exchange_order_id = $1::uuid`,
      [staleOrder.exchangeOrderId]
    );
    const expired = await lifecycleService.expireStaleOrders(10);
    expect(expired).toEqual({
      outcome: 'EXPIRED', ids: [staleOrder.exchangeOrderId]
    });
    const released = await lifecycleService.release(staleOrder.exchangeOrderId);
    expect(released.outcome).toBe('REFUNDED');
    expect(await signedBalance(staleUid, 'USDT-TRC20', 'USER_AVAILABLE'))
      .toBe('-10000000');
  });

  it('S7A05: replaying every step leaves one ledger effect per action', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
    const first = await confirmService.confirm({ quoteId, uid });
    const order = (first as { order: ExchangeOrderSnapshot }).order;
    const replayConfirm = await confirmService.confirm({ quoteId, uid });
    expect(replayConfirm.outcome).toBe('ALREADY_CONFIRMED');
    await settlementService.settle(order.exchangeOrderId);
    const resettle = await settlementService.settle(order.exchangeOrderId);
    expect(resettle.outcome).toBe('SETTLED');
    expect(await txCount('FREEZE', order.orderRef)).toBe(1);
    expect(await txCount('SETTLE', order.orderRef)).toBe(1);
    const refail = await lifecycleService.fail({
      exchangeOrderId: order.exchangeOrderId, reason: 'late'
    });
    expect(refail.outcome).toBe('DENIED');
    expect(await txCount('RELEASE', order.orderRef)).toBe(0);
  });

  it('S7A06: concurrent confirmations converge to one order', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
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
  });

  it('S7A07: the ledger stays balanced with zero projection drift', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
    const confirmed = await confirmService.confirm({ quoteId, uid });
    await settlementService.settle(
      (confirmed as { order: ExchangeOrderSnapshot }).order.exchangeOrderId
    );
    const totals = await cleanupPool.query<{ d: string; c: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0)::text AS d,
              COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0)::text AS c
         FROM ledger_entries`
    );
    expect(BigInt(totals.rows[0]!.d)).toBe(BigInt(totals.rows[0]!.c));
    const drift = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM account_balances b
        WHERE b.signed_balance <> (
          SELECT COALESCE(SUM(
            CASE e.direction WHEN 'DEBIT' THEN e.amount ELSE -e.amount END
          ), 0) FROM ledger_entries e WHERE e.account_id = b.account_id)`
    );
    expect(drift.rows[0]?.n).toBe(0);
  });

  it('S7A08: deviating rates fail closed with zero writes', async () => {
    source.setRate('USDT-TRC20:USDT-ERC20', '5', '1');
    const rejected = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20', sellAmount: '2000000'
    });
    expect(rejected).toEqual({
      outcome: 'REJECTED', reasonCode: 'QUOTE_DEVIATION_EXCEEDED'
    });
    const rows = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM quotes`
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('S7A09: the success chain emits exactly the expected topics', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
    const confirmed = await confirmService.confirm({ quoteId, uid });
    await settlementService.settle(
      (confirmed as { order: ExchangeOrderSnapshot }).order.exchangeOrderId
    );
    const topics = await cleanupPool.query<{ topic: string; n: number }>(
      `SELECT topic, count(*)::int AS n FROM outbox_messages
        WHERE topic LIKE 'telegram.exchange-%'
        GROUP BY topic ORDER BY topic`
    );
    expect(topics.rows).toEqual([
      { topic: 'telegram.exchange-reserved.v1', n: 1 },
      { topic: 'telegram.exchange-settled.v1', n: 1 }
    ]);
  });

  it('S7A10: exchange outbox payloads carry no sensitive fields', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
    const confirmed = await confirmService.confirm({ quoteId, uid });
    await settlementService.settle(
      (confirmed as { order: ExchangeOrderSnapshot }).order.exchangeOrderId
    );
    const leaks = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic LIKE '%exchange%'
          AND (payload::text ~* '"(password|secret|privatekey|private_key|mnemonic|seed|digest|key)"')`
    );
    expect(leaks.rows[0]?.n).toBe(0);
  });

  it('S7A11: terminal orders carry both ledger links', async () => {
    const settledUid = await seedUser();
    await fundUser(settledUid, 'USDT-TRC20', '10000000');
    const settledQuote = await quoteIdFor(
      'USDT-TRC20:USDT-ERC20', '2000000'
    );
    const settledConfirmed = await confirmService.confirm({
      quoteId: settledQuote, uid: settledUid
    });
    await settlementService.settle(
      (settledConfirmed as { order: ExchangeOrderSnapshot }).order
        .exchangeOrderId
    );
    const refundedUid = await seedUser();
    await fundUser(refundedUid, 'USDT-TRC20', '10000000');
    const refundedQuote = await quoteIdFor(
      'USDT-TRC20:USDT-ERC20', '2000000'
    );
    const refundedConfirmed = await confirmService.confirm({
      quoteId: refundedQuote, uid: refundedUid
    });
    const refundedOrder = (refundedConfirmed as {
      order: ExchangeOrderSnapshot;
    }).order;
    await lifecycleService.fail({
      exchangeOrderId: refundedOrder.exchangeOrderId, reason: 'x'
    });
    await lifecycleService.release(refundedOrder.exchangeOrderId);
    const rows = await cleanupPool.query<{
      status: string;
      freeze: string | null;
      settlement: string | null;
    }>(
      `SELECT status, ledger_transaction_id::text AS freeze,
              settlement_ledger_transaction_id::text AS settlement
         FROM exchange_orders`
    );
    const byStatus = new Map(rows.rows.map((r) => [r.status, r]));
    expect(byStatus.get('SETTLED')?.freeze).not.toBeNull();
    expect(byStatus.get('SETTLED')?.settlement).not.toBeNull();
    expect(byStatus.get('REFUNDED')?.freeze).not.toBeNull();
    expect(byStatus.get('REFUNDED')?.settlement).not.toBeNull();
  });

  it('S7A12: reconciliation reports zero discrepancies with valuation', async () => {
    const uid = await seedUser();
    await fundUser(uid, 'USDT-TRC20', '10000000');
    const quoteId = await quoteIdFor('USDT-TRC20:USDT-ERC20', '2000000');
    const confirmed = await confirmService.confirm({ quoteId, uid });
    await settlementService.settle(
      (confirmed as { order: ExchangeOrderSnapshot }).order.exchangeOrderId
    );
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([]);
    expect(report.marketValueSummary).toEqual([
      { marketKey: 'USDT-TRC20:USDT-ERC20', legValueDifference: '10000' }
    ]);
    expect(report.clearingBalances.length).toBeGreaterThan(0);
  });
});
