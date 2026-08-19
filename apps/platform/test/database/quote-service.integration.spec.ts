import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { StageOneDatabase } from '@xht/contracts';
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
import { FakeQuoteSource } from '../../src/modules/exchange/domain/fake-quote.source.js';
import {
  PostgresMarketRepository
} from '../../src/modules/exchange/infrastructure/postgres-market.repository.js';
import {
  PostgresQuoteRepository
} from '../../src/modules/exchange/infrastructure/postgres-quote.repository.js';
import { QuoteService } from '../../src/modules/exchange/application/quote.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const markets = new PostgresMarketRepository();
const quotes = new PostgresQuoteRepository();
let source: FakeQuoteSource;
let quoteService: QuoteService;

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot, startupTimeoutMillis: 120_000, stopTimeoutMillis: 10_000
  });
  const evidence = await migrateAndValidate(fixture, {
    projectRoot, configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  expect(evidence.firstMigrate.appliedVersions).toEqual([
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'
  ]);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s72-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s72-platform'
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
  await cleanupPool.query(`DELETE FROM quotes`);
  source = new FakeQuoteSource();
  source.setRate('USDT-TRC20:USDT-ERC20', '1', '1');
  source.setRate('BTC:USDT-TRC20', '95000', '95000');
  quoteService = new QuoteService(unitOfWork, markets, quotes, source);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S7-2 quote service', () => {
  it('S7QT01: same-asset cross-chain quote applies the spread exactly', async () => {
    const result = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20',
      sellAmount: '1000000'
    });
    expect(result.outcome).toBe('CREATED');
    const quote = (result as { quote: { buyAmount: string } }).quote;
    expect((result as { quote: Record<string, unknown> }).quote.buyAmount)
      .toBe('995000');
    expect(quote).toBeDefined();
    const rows = await cleanupPool.query<{
      reference_rate: string;
      source_id: string;
      status: string;
      config_version: number;
    }>(
      `SELECT reference_rate, source_id, status, config_version
         FROM quotes`
    );
    expect(rows.rows[0]).toEqual({
      reference_rate: '1',
      source_id: 'fake-configured-v1',
      status: 'ACTIVE',
      config_version: 1
    });
  });

  it('S7QT02: cross-decimal market computes the exact proceeds', async () => {
    const result = await quoteService.createQuote({
      marketKey: 'BTC:USDT-TRC20',
      sellAmount: '1000'
    });
    expect(result.outcome).toBe('CREATED');
    expect((result as { quote: { buyAmount: string } }).quote.buyAmount)
      .toBe('945250');
  });

  it('S7QT03: expiry is set from the market TTL and the row is ACTIVE', async () => {
    const before = Date.now();
    const result = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20',
      sellAmount: '1000000'
    });
    const after = Date.now();
    expect(result.outcome).toBe('CREATED');
    const quote = (result as { quote: { expiresAt: string; status: string } })
      .quote;
    const expiry = Date.parse(quote.expiresAt);
    expect(expiry).toBeGreaterThanOrEqual(before + 60_000);
    expect(expiry).toBeLessThanOrEqual(after + 60_000);
    expect(quote.status).toBe('ACTIVE');
    const stored = await unitOfWork.execute((c) =>
      quotes.findById(c, (result as { quote: { quoteId: string } }).quote.quoteId)
    );
    expect(stored?.configVersion).toBe(1);
    expect(stored?.marketKey).toBe('USDT-TRC20:USDT-ERC20');
  });

  it('S7QT04: a deviating rate is rejected with zero quote rows', async () => {
    source.setRate('USDT-TRC20:USDT-ERC20', '2', '1');
    const result = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20',
      sellAmount: '1000000'
    });
    expect(result).toEqual({
      outcome: 'REJECTED', reasonCode: 'QUOTE_DEVIATION_EXCEEDED'
    });
    const rows = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM quotes`
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('S7QT05: amounts outside the market limits are rejected', async () => {
    const tooSmall = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20',
      sellAmount: '99999'
    });
    expect(tooSmall).toEqual({
      outcome: 'REJECTED', reasonCode: 'QUOTE_AMOUNT_OUT_OF_RANGE'
    });
    const tooLarge = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20',
      sellAmount: '10000000001'
    });
    expect(tooLarge).toEqual({
      outcome: 'REJECTED', reasonCode: 'QUOTE_AMOUNT_OUT_OF_RANGE'
    });
    const rows = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM quotes`
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('S7QT06: unknown markets and unavailable sources fail closed', async () => {
    const unknown = await quoteService.createQuote({
      marketKey: 'NOPE:NOPE',
      sellAmount: '1000000'
    });
    expect(unknown).toEqual({
      outcome: 'REJECTED', reasonCode: 'MARKET_NOT_FOUND'
    });
    source.setRate('USDT-TRC20:USDT-ERC20', 'garbage!!', '1');
    const malformed = await quoteService.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20',
      sellAmount: '1000000'
    });
    expect(malformed).toEqual({
      outcome: 'REJECTED', reasonCode: 'QUOTE_SOURCE_UNAVAILABLE'
    });
    const unconfigured = new QuoteService(
      unitOfWork, markets, quotes, new FakeQuoteSource()
    );
    const unavailable = await unconfigured.createQuote({
      marketKey: 'USDT-TRC20:USDT-ERC20',
      sellAmount: '1000000'
    });
    expect(unavailable).toEqual({
      outcome: 'REJECTED', reasonCode: 'QUOTE_SOURCE_UNAVAILABLE'
    });
    const rows = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM quotes`
    );
    expect(rows.rows[0]?.n).toBe(0);
  });
});
