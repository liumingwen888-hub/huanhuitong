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
import { ReverseTransactionService } from '../../src/modules/ledger/application/reverse-transaction.service.js';
import { BalanceQueryService } from '../../src/modules/ledger/application/balance-query.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const accounts = new PostgresLedgerAccountRepository();
const transactions = new PostgresLedgerTransactionRepository();
let poster: PostMoneyService;
let reverser: ReverseTransactionService;
let balances: BalanceQueryService;

async function seed(): Promise<{ uid: Uid; available: string; custody: string }> {
  const uid = await unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    return created.rows[0]!.uid as Uid;
  });
  const available = await unitOfWork.execute((context) =>
    accounts.openUserAccount(context, {
      ownerUid: uid,
      assetCode: 'USDT-TRC20',
      purpose: 'USER_AVAILABLE',
      idempotencyKey: `open-${randomUUID()}`
    })
  );
  const custodyRows = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY') RETURNING account_id`,
    []
  );
  const clearingRows = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'CLEARING_DIFF') RETURNING account_id`,
    []
  );
  const bootstrap = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
    [bootstrap, `boot-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     VALUES ($1::uuid, $2::uuid, 'DEBIT', 10000, 0),
            ($1::uuid, $3::uuid, 'CREDIT', 10000, 1)`,
    [bootstrap, custodyRows.rows[0]!.account_id, clearingRows.rows[0]!.account_id]
  );
  await balances.recomputeAll();
  return {
    uid,
    available: available.accountId,
    custody: custodyRows.rows[0]!.account_id
  };
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
  expect(evidence.firstMigrate.appliedVersions).toEqual(
    expect.arrayContaining(['1', '2', '3', '4'])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-s33-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s33-platform'
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
  poster = new PostMoneyService(unitOfWork, accounts, transactions);
  reverser = new ReverseTransactionService(unitOfWork, accounts, transactions);
  balances = new BalanceQueryService(unitOfWork, accounts);
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
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S3-3 balance projection', () => {
  it('S3BP01: posting maintains the projection in the same transaction', async () => {
    const seeded = await seed();
    await poster.post({
      idempotencyKey: 'bp-post-00000001',
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: seeded.custody, direction: 'DEBIT', amount: '300' },
        { accountId: seeded.available, direction: 'CREDIT', amount: '300' }
      ]
    });
    expect(await balances.accountBalanceOf(seeded.available as never)).toBe(
      '-300'
    );
    expect(await balances.accountBalanceOf(seeded.custody as never)).toBe(
      '10300'
    );
    expect(await balances.verifyProjection()).toEqual([]);
  });

  it('S3BP02: reversal rolls the projection back exactly', async () => {
    const seeded = await seed();
    const posted = await poster.post({
      idempotencyKey: 'bp-rev-000000001',
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: seeded.custody, direction: 'DEBIT', amount: '250' },
        { accountId: seeded.available, direction: 'CREDIT', amount: '250' }
      ]
    });
    await reverser.reverse({
      originalTransactionId: posted.transactionId,
      idempotencyKey: 'bp-rev-reverse-1'
    });
    expect(await balances.accountBalanceOf(seeded.available as never)).toBe(
      '0'
    );
    expect(await balances.accountBalanceOf(seeded.custody as never)).toBe(
      '10000'
    );
  });

  it('S3BP03: idempotent replays leave the projection untouched', async () => {
    const seeded = await seed();
    const command = {
      idempotencyKey: 'bp-idem-00000001',
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: seeded.custody, direction: 'DEBIT', amount: '100' },
        { accountId: seeded.available, direction: 'CREDIT', amount: '100' }
      ] as const
    };
    await poster.post(command);
    await poster.post(command);
    expect(await balances.accountBalanceOf(seeded.available as never)).toBe(
      '-100'
    );
  });

  it('S3BP04: tampering is caught and recomputation restores truth', async () => {
    const seeded = await seed();
    await poster.post({
      idempotencyKey: 'bp-tamper-000001',
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: seeded.custody, direction: 'DEBIT', amount: '500' },
        { accountId: seeded.available, direction: 'CREDIT', amount: '500' }
      ]
    });
    await cleanupPool.query(
      `UPDATE account_balances SET signed_balance = 999999
        WHERE account_id = $1::uuid`,
      [seeded.available]
    );
    const discrepancies = await balances.verifyProjection();
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0]?.accountId).toBe(seeded.available);
    expect(discrepancies[0]?.authoritative).toBe('-500');
    await balances.recomputeAll();
    expect(await balances.verifyProjection()).toEqual([]);
    expect(await balances.accountBalanceOf(seeded.available as never)).toBe(
      '-500'
    );
  });

  it('S3BP05: projections are not deletable by the platform role', async () => {
    const client = await platformPool.connect();
    try {
      await client.query('SET ROLE xht_platform');
      await expect(
        client.query('DELETE FROM account_balances')
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release();
    }
  });
});
