import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import {
  migrateAndValidate,
  startPostgresFixture
} from '@xht/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../../..');

describe('stage one schema boundary', () => {
  let fixturePool: Pool;
  let platformPool: Pool;

  beforeAll(async () => {
    const fixture = await startPostgresFixture({
      projectRoot,
      startupTimeoutMillis: 120_000,
      stopTimeoutMillis: 10_000
    });
    const evidence = await migrateAndValidate(fixture, {
      projectRoot,
      configFile: 'database/flyway.toml',
      migrationsDirectory: 'database/migrations',
      callbacksDirectory: 'database/flyway-callbacks'
    });
    expect(evidence.firstMigrate.exitCode).toBe(0);
    fixturePool = new Pool({
      connectionString: fixture.bootstrapLogin.connectionString,
      max: 1,
      application_name: 'xht-t13-schema'
    });
    platformPool = new Pool({
      connectionString: fixture.platformLogin.connectionString,
      max: 1,
      application_name: 'xht-t13-schema-platform'
    });
  }, 180_000);

  afterAll(async () => {
    await platformPool.end();
    await fixturePool.end();
  });

  it(
    '18: keeps an identity-only database free of ledger rows and raw Update columns',
    { timeout: 30_000 },
    async () => {
      const ledgerRows = await fixturePool.query<{ n: number }>(
        `SELECT
           (SELECT count(*) FROM ledger_accounts) +
           (SELECT count(*) FROM ledger_transactions) +
           (SELECT count(*) FROM ledger_entries) +
           (SELECT count(*) FROM account_openings) AS n`
      );
      expect(Number(ledgerRows.rows[0]?.n ?? 0)).toBe(0);
      const columns = await fixturePool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='inbox_messages'`
      );
      const columnNames = new Set(columns.rows.map((row) => row.column_name));
      expect(columnNames.has('payload_digest')).toBe(true);
      expect(columnNames.has('digest_key_version')).toBe(true);
      for (const forbidden of [
        'payload', 'payload_hash', 'body', 'raw_update', 'update_json',
        'message_text', 'callback_data', 'start_parameter', 'payment_password'
      ]) {
        expect(columnNames.has(forbidden)).toBe(false);
      }
    }
  );

  it(
    '19: applies migrations through the role chain from an empty database',
    { timeout: 30_000 },
    async () => {
      const history = await fixturePool.query<{ version: string; owner: string }>(
        `SELECT version FROM flyway_schema_history WHERE success = true`
      );
      expect(history.rows.map((row) => row.version)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
      const owners = await fixturePool.query<{ owner: string }>(
        `SELECT DISTINCT tableowner AS owner FROM pg_tables
          WHERE schemaname='public' AND tablename != 'flyway_schema_history'`
      );
      expect(owners.rows.map((row) => row.owner)).toEqual(['xht_flyway']);
      const platformClient = await platformPool.connect();
      try {
        await platformClient.query('SET ROLE xht_platform');
        await expect(
          platformClient.query(
            `CREATE TABLE breach (id int primary key)`
          )
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        platformClient.release();
      }
    }
  );

  it(
    '20: validates repeated migrations without drift',
    { timeout: 60_000 },
    async () => {
      const before = await fixturePool.query<{ version: string }>(
        `SELECT version FROM flyway_schema_history WHERE success = true`
      );
      expect(before.rows.map((row) => row.version)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    }
  );

  it(
    '22: keeps full suite orchestration outside Vitest',
    async () => {
      const specFiles = [
        'apps/platform/test/integration/stage-one-webhook.integration.spec.ts',
        'apps/platform/test/integration/registration-concurrency.integration.spec.ts',
        'apps/worker/test/integration/outbox-recovery.integration.spec.ts'
      ];
      for (const file of specFiles) {
        const content = await readFile(resolve(projectRoot, file), 'utf8');
        expect(content.match(/test:all|execFile.*pnpm.*test/u) ?? []).toEqual([]);
      }
    }
  );
});
