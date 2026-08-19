import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { StageOneDatabase } from '@xht/contracts';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleEnforcingPostgresPool } from '../../src/infrastructure/database/database.js';
import {
  createUnitOfWork,
  type UnitOfWork
} from '../../src/infrastructure/database/unit-of-work.js';
import {
  PostgresMarketRepository
} from '../../src/modules/exchange/infrastructure/postgres-market.repository.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const markets = new PostgresMarketRepository();

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
    '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ]);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s71-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s71-platform'
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

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S7-1 market catalog and V9 schema', () => {
  it('S7MK01: four directional markets are seeded with role separation', async () => {
    const seeded = await cleanupPool.query<{
      market_key: string;
      version: number;
    }>(
      `SELECT market_key, config_version AS version FROM market_configs
        ORDER BY market_key`
    );
    expect(seeded.rows).toEqual([
      { market_key: 'BTC:USDT-TRC20', version: 1 },
      { market_key: 'USDT-ERC20:USDT-TRC20', version: 1 },
      { market_key: 'USDT-TRC20:BTC', version: 1 },
      { market_key: 'USDT-TRC20:USDT-ERC20', version: 1 }
    ]);
    const workerClient = await new Pool({
      connectionString: fixture.workerLogin.connectionString, max: 1
    }).connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      const readable = await workerClient.query(
        `SELECT count(*)::int AS n FROM market_configs`
      );
      expect(readable.rows[0]?.n).toBe(4);
      await expect(
        workerClient.query(
          `INSERT INTO market_configs
             (market_key, config_version, sell_asset_code, buy_asset_code,
              quote_scale, spread_bp, min_sell_amount, max_sell_amount,
              quote_ttl_seconds, deviation_tolerance_bp)
           VALUES ('HACK:HACK', 1, 'BTC', 'BTC', 8, 1, 1, 1, 1, 1)`
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        workerClient.query(`UPDATE market_configs SET spread_bp = 0`)
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
    // the platform role UPDATE surfaces through the UOW wrapper
    await expect(
      unitOfWork.execute(async (context) => {
        await context.executeSql(
          `UPDATE market_configs SET spread_bp = 0 WHERE market_key = $1`,
          ['BTC:USDT-TRC20']
        );
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S7MK02: findActive tracks the newest version without overwriting', async () => {
    const v1 = await unitOfWork.execute((c) =>
      markets.findActive(c, 'USDT-TRC20:USDT-ERC20')
    );
    expect(v1?.configVersion).toBe(1);
    expect(v1?.quoteTtlSeconds).toBe(60);
    expect(v1?.spreadBp).toBe(50);
    const v2 = await unitOfWork.execute((c) =>
      markets.insert(c, {
        marketKey: 'USDT-TRC20:USDT-ERC20',
        configVersion: 2,
        sellAssetCode: 'USDT-TRC20',
        buyAssetCode: 'USDT-ERC20',
        quoteScale: 8,
        spreadBp: 75,
        minSellAmount: '200000',
        maxSellAmount: '5000000000',
        quoteTtlSeconds: 30,
        deviationToleranceBp: 500
      })
    );
    expect(v2.configVersion).toBe(2);
    const active = await unitOfWork.execute((c) =>
      markets.findActive(c, 'USDT-TRC20:USDT-ERC20')
    );
    expect(active?.configVersion).toBe(2);
    expect(active?.quoteTtlSeconds).toBe(30);
    const rows = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM market_configs
        WHERE market_key = 'USDT-TRC20:USDT-ERC20'`
    );
    expect(rows.rows[0]?.n).toBe(2);
    await cleanupPool.query(
      `DELETE FROM market_configs WHERE config_version > 1`
    );
  });

  it('S7MK03: listActive returns all four directional markets', async () => {
    const list = await unitOfWork.execute((c) => markets.listActive(c));
    expect(list.map((m) => m.marketKey).sort()).toEqual([
      'BTC:USDT-TRC20',
      'USDT-ERC20:USDT-TRC20',
      'USDT-TRC20:BTC',
      'USDT-TRC20:USDT-ERC20'
    ]);
    for (const market of list) {
      expect(market.sellAssetCode).toBe(market.marketKey.split(':')[0]);
      expect(market.buyAssetCode).toBe(market.marketKey.split(':')[1]);
    }
  });

  it('S7MK04: CHECK and FK constraints reject invalid configurations', async () => {
    const invalid: [string, string, readonly unknown[]][] = [
      [
        'spread out of range',
        `INSERT INTO market_configs
           (market_key, config_version, sell_asset_code, buy_asset_code,
            quote_scale, spread_bp, min_sell_amount, max_sell_amount,
            quote_ttl_seconds, deviation_tolerance_bp)
         VALUES ('T1:T2', 1, 'BTC', 'ETH', 8, 10001, 1, 10, 60, 1000)`,
        []
      ],
      [
        'ttl out of range',
        `INSERT INTO market_configs
           (market_key, config_version, sell_asset_code, buy_asset_code,
            quote_scale, spread_bp, min_sell_amount, max_sell_amount,
            quote_ttl_seconds, deviation_tolerance_bp)
         VALUES ('T1:T2', 1, 'BTC', 'ETH', 8, 50, 1, 10, 0, 1000)`,
        []
      ],
      [
        'min above max',
        `INSERT INTO market_configs
           (market_key, config_version, sell_asset_code, buy_asset_code,
            quote_scale, spread_bp, min_sell_amount, max_sell_amount,
            quote_ttl_seconds, deviation_tolerance_bp)
         VALUES ('T1:T2', 1, 'BTC', 'ETH', 8, 50, 100, 10, 60, 1000)`,
        []
      ],
      [
        'unknown asset',
        `INSERT INTO market_configs
           (market_key, config_version, sell_asset_code, buy_asset_code,
            quote_scale, spread_bp, min_sell_amount, max_sell_amount,
            quote_ttl_seconds, deviation_tolerance_bp)
         VALUES ('T1:T2', 1, 'NOPE', 'ETH', 8, 50, 1, 10, 60, 1000)`,
        []
      ]
    ];
    for (const [label, sql, params] of invalid) {
      await expect(
        cleanupPool.query(sql, params),
        label
      ).rejects.toMatchObject({ code: expect.stringMatching(/^23\d{3}$/u) });
    }
  });
});
