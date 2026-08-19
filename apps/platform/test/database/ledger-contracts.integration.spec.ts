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
import { parsePostMoneyCommand } from '../../src/modules/ledger/domain/ledger.types.js';
import { LedgerError } from '../../src/modules/ledger/domain/ledger.errors.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let workerPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const accounts = new PostgresLedgerAccountRepository();
const transactions = new PostgresLedgerTransactionRepository();

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function seedPlatformAccount(
  assetCode: string,
  purpose: string
): Promise<string> {
  const rows = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, $1, $2) RETURNING account_id`,
    [assetCode, purpose]
  );
  return rows.rows[0]!.account_id;
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
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
  expect(evidence.firstMigrate.appliedVersions).toEqual(['1', '2', '3']);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-s31-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s31-platform'
  });
  workerPool = new Pool({
    connectionString: fixture.workerLogin.connectionString,
    max: 2,
    application_name: 'xht-s31-worker'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never,
        fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'account_balances',
    'ledger_entries',
    'ledger_transactions',
    'account_openings',
    'ledger_accounts',
    'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await platformPool.end();
  await workerPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S3-1 ledger contracts and V3 schema', () => {
  it('S3LC01: catalog seeds and new tables exist', async () => {
    const catalog = await cleanupPool.query<{ asset_code: string }>(
      `SELECT asset_code FROM asset_catalog ORDER BY asset_code`
    );
    expect(catalog.rows.map((row) => row.asset_code)).toEqual([
      'BTC', 'ETH', 'USD-FIAT', 'USDT-ERC20', 'USDT-TRC20'
    ]);
    const columns = await cleanupPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='ledger_entries'`
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain('amount');
    expect(names).not.toContain('amount_numeric_float');
  });

  it('S3LC02: ownership shape CHECK separates user and platform accounts', async () => {
    const uid = await seedUser();
    await expect(
      cleanupPool.query(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES (NULL, 'BTC', 'USER_AVAILABLE')`
      )
    ).rejects.toMatchObject({ constraint: 'ck_ledger_accounts_ownership' });
    await expect(
      cleanupPool.query(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES ($1::uuid, 'BTC', 'FEE_INCOME')`,
        [uid]
      )
    ).rejects.toMatchObject({ constraint: 'ck_ledger_accounts_ownership' });
    await expect(
      cleanupPool.query(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES ($1::uuid, 'BTC', 'USER_LIABILITY')`,
        [uid]
      )
    ).rejects.toMatchObject({ constraint: 'ck_ledger_accounts_ownership' });
  });

  it('S3LC03: explicit idempotent account opening', async () => {
    const uid = await seedUser();
    const first = await unitOfWork.execute((context) =>
      accounts.openUserAccount(context, {
        ownerUid: uid,
        assetCode: 'USDT-TRC20',
        purpose: 'USER_AVAILABLE',
        idempotencyKey: 'open-usdt-1'
      })
    );
    expect(first.status).toBe('ACTIVE');
    const second = await unitOfWork.execute((context) =>
      accounts.openUserAccount(context, {
        ownerUid: uid,
        assetCode: 'USDT-TRC20',
        purpose: 'USER_AVAILABLE',
        idempotencyKey: 'open-usdt-2'
      })
    );
    expect(second.accountId).toBe(first.accountId);
    const openings = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM account_openings`
    );
    expect(openings.rows[0]?.n).toBe(1);
  });

  it('S3LC04: command parsing rejects unbalanced and malformed money', () => {
    const uidA = randomUUID();
    const uidB = randomUUID();
    expect(() =>
      parsePostMoneyCommand({
        idempotencyKey: 'key-12345678',
        transactionType: 'INTERNAL_TRANSFER',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: uidA, direction: 'DEBIT', amount: '100' },
          { accountId: uidB, direction: 'CREDIT', amount: '100' }
        ]
      })
    ).not.toThrow();
    expect(() =>
      parsePostMoneyCommand({
        idempotencyKey: 'key-12345678',
        transactionType: 'INTERNAL_TRANSFER',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: uidA, direction: 'DEBIT', amount: '100' },
          { accountId: uidB, direction: 'CREDIT', amount: '99' }
        ]
      })
    ).toThrowError(LedgerError);
    expect(() =>
      parsePostMoneyCommand({
        idempotencyKey: 'key-12345678',
        transactionType: 'INTERNAL_TRANSFER',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: uidA, direction: 'DEBIT', amount: '1.5' },
          { accountId: uidB, direction: 'CREDIT', amount: '1.5' }
        ]
      })
    ).toThrowError('LEDGER_COMMAND_INVALID');
  });

  it('S3LC05: balanced transactions post; unbalanced fail at the trigger', async () => {
    const uid = await seedUser();
    const userAccount = await unitOfWork.execute((context) =>
      accounts.openUserAccount(context, {
        ownerUid: uid,
        assetCode: 'USDT-TRC20',
        purpose: 'USER_AVAILABLE',
        idempotencyKey: 'open-bal-1'
      })
    );
    const custody = await seedPlatformAccount('USDT-TRC20', 'PLATFORM_CUSTODY');
    const liability = await seedPlatformAccount('USDT-TRC20', 'USER_LIABILITY');

    const balanced = parsePostMoneyCommand({
      idempotencyKey: `deposit-${randomUUID()}`,
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: userAccount.accountId, direction: 'CREDIT', amount: '2500000' },
        { accountId: liability, direction: 'DEBIT', amount: '2500000' }
      ]
    });
    const transactionId = await unitOfWork.execute((context) =>
      transactions.insertPostedTransaction(context, balanced)
    );
    const stored = await cleanupPool.query<{ direction: string; amount: string }>(
      `SELECT direction, amount::text AS amount FROM ledger_entries
        WHERE transaction_id=$1::uuid ORDER BY entry_index`,
      [transactionId]
    );
    expect(stored.rows.map((row) => `${row.direction}:${row.amount}`)).toEqual([
      'CREDIT:2500000',
      'DEBIT:2500000'
    ]);

    await expect(
      unitOfWork.execute(async (context) => {
        const tx = randomUUID();
        await context.executeSql(
          `INSERT INTO ledger_transactions
             (transaction_id, idempotency_key, transaction_type)
           VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
          [tx, `bad-${randomUUID()}`]
        );
        await context.executeSql(
          `INSERT INTO ledger_entries
             (transaction_id, account_id, direction, amount, entry_index)
           VALUES ($1::uuid, $2::uuid, 'DEBIT', 100, 0)`,
          [tx, userAccount.accountId]
        );
      })
    ).rejects.toSatisfy(
      (error: { code?: string }) =>
        error.code === 'TRANSACTION_CALLBACK_FAILED' ||
        error.code === 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
    );
  });

  it('S3LC06: idempotency keys are unique; entries are immutable', async () => {
    const uid = await seedUser();
    const userAccount = await unitOfWork.execute((context) =>
      accounts.openUserAccount(context, {
        ownerUid: uid,
        assetCode: 'ETH',
        purpose: 'USER_AVAILABLE',
        idempotencyKey: 'open-imm-1'
      })
    );
    const liability = await seedPlatformAccount('ETH', 'USER_LIABILITY');
    const command = parsePostMoneyCommand({
      idempotencyKey: 'idem-fixed-key-1',
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: userAccount.accountId, direction: 'CREDIT', amount: '10' },
        { accountId: liability, direction: 'DEBIT', amount: '10' }
      ]
    });
    await unitOfWork.execute((context) =>
      transactions.insertPostedTransaction(context, command)
    );
    const found = await unitOfWork.execute((context) =>
      transactions.findTransactionIdByIdempotencyKey(
        context,
        'idem-fixed-key-1'
      )
    );
    expect(found).not.toBeNull();

    const platformClient = await platformPool.connect();
    try {
      await platformClient.query('SET ROLE xht_platform');
      await expect(
        platformClient.query(`UPDATE ledger_entries SET amount = 999`)
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        platformClient.query(`DELETE FROM ledger_entries`)
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      platformClient.release();
    }
    const bootstrapDelete = await cleanupPool
      .query(`DELETE FROM ledger_entries`)
      .then(
        () => 'deleted',
        () => 'blocked'
      );
    expect(bootstrapDelete).toBe('deleted');
  });

  it('S3LC07: worker role is read-only on the ledger', async () => {
    const workerClient = await workerPool.connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      const readable = await workerClient.query(
        `SELECT count(*)::int AS n FROM asset_catalog`
      );
      expect(readable.rows[0]?.n).toBe(5);
      await expect(
        workerClient.query(
          `INSERT INTO ledger_entries
             (transaction_id, account_id, direction, amount, entry_index)
           VALUES ($1::uuid, $1::uuid, 'DEBIT', 1, 0)`,
          [randomUUID()]
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
  });
});
