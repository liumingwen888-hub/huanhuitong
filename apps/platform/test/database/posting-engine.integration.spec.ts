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

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
let unitOfWorkB: UnitOfWork;
const accounts = new PostgresLedgerAccountRepository();
const transactions = new PostgresLedgerTransactionRepository();
let poster: PostMoneyService;
let reverser: ReverseTransactionService;

async function seedUserWithAccounts(
  assetCode = 'USDT-TRC20'
): Promise<{ uid: Uid; available: string; liability: string; custody: string }> {
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
      assetCode,
      purpose: 'USER_AVAILABLE',
      idempotencyKey: `open-${randomUUID()}`
    })
  );
  const liabilityRows = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, $1, 'USER_LIABILITY') RETURNING account_id`,
    [assetCode]
  );
  const custodyRows = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, $1, 'PLATFORM_CUSTODY') RETURNING account_id`,
    [assetCode]
  );
  return {
    uid,
    available: available.accountId,
    liability: liabilityRows.rows[0]!.account_id,
    custody: custodyRows.rows[0]!.account_id
  };
}

async function seedCustody(
  custodyAccountId: string,
  amount: string
): Promise<void> {
  // Bootstrap equity injection via the migration owner only: the clearing
  // difference account absorbs the opening position so every later engine
  // posting starts from funded, non-negative platform accounts.
  const clearingRows = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'CLEARING_DIFF') RETURNING account_id`,
    []
  );
  const clearing = clearingRows.rows[0]!.account_id;
  const transactionId = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions
       (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
    [transactionId, `bootstrap-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries
       (transaction_id, account_id, direction, amount, entry_index)
     VALUES ($1::uuid, $2::uuid, 'DEBIT', $3::bigint, 0),
            ($1::uuid, $4::uuid, 'CREDIT', $3::bigint, 1)`,
    [transactionId, custodyAccountId, amount, clearing]
  );
}

async function fundUser(
  availableAccountId: string,
  custodyAccountId: string,
  amount: string,
  key = `fund-${randomUUID()}`
): Promise<string> {
  const result = await poster.post({
    idempotencyKey: key,
    transactionType: 'DEPOSIT',
    occurredAt: '2026-08-17T12:00:00.000Z',
    lines: [
      { accountId: custodyAccountId, direction: 'DEBIT', amount },
      { accountId: availableAccountId, direction: 'CREDIT', amount }
    ]
  });
  return result.transactionId;
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, {
    projectRoot,
    configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-s32-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 6,
    application_name: 'xht-s32-platform'
  });
  const makeUnitOfWork = (): UnitOfWork => {
    const kysely = new Kysely<StageOneDatabase>({
      dialect: new PostgresDialect({
        pool: new RoleEnforcingPostgresPool(
          platformPool as never,
          fixture.platformLogin.username
        )
      })
    });
    return createUnitOfWork(kysely);
  };
  unitOfWork = makeUnitOfWork();
  unitOfWorkB = makeUnitOfWork();
  poster = new PostMoneyService(unitOfWork, accounts, transactions);
  reverser = new ReverseTransactionService(unitOfWork, accounts, transactions);
}, 180_000);

beforeEach(async () => {
  for (const table of [
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

describe.sequential('S3-2 posting engine', () => {
  it('S3PE01: a balanced deposit posting lands with version bumps', async () => {
    const seeded = await seedUserWithAccounts();
    await seedCustody(seeded.custody, '1000');
    const result = await poster.post({
        idempotencyKey: 'post-basic-000001',
        transactionType: 'DEPOSIT',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: seeded.available, direction: 'CREDIT', amount: '500' },
          { accountId: seeded.custody, direction: 'DEBIT', amount: '500' }
        ]
      });
    expect(result.posted).toBe(true);
    const balance = await unitOfWork.execute((context) =>
      accounts.accountBalance(context, seeded.available as never)
    );
    expect(balance).toBe('-500');
    const version = await cleanupPool.query<{ version: number }>(
      `SELECT version FROM ledger_accounts WHERE account_id=$1::uuid`,
      [seeded.available]
    );
    expect(version.rows[0]?.version).toBe(1);
  });

  it('S3PE02: replaying the same idempotency key returns the original', async () => {
    const seeded = await seedUserWithAccounts();
    await seedCustody(seeded.custody, '1000');
    const command = {
      idempotencyKey: 'post-idem-000001',
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: seeded.available, direction: 'CREDIT', amount: '100' },
        { accountId: seeded.custody, direction: 'DEBIT', amount: '100' }
      ]
    };
    const first = await poster.post(command);
    const second = await poster.post(command);
    expect(second.posted).toBe(false);
    expect(second.transactionId).toBe(first.transactionId);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key = 'post-idem-000001'`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S3PE03: posting to a missing or frozen account fails closed', async () => {
    const seeded = await seedUserWithAccounts();
    await seedCustody(seeded.custody, '10');
    await expect(
      poster.post({
        idempotencyKey: 'post-missing-00001',
        transactionType: 'ADJUSTMENT',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: randomUUID(), direction: 'DEBIT', amount: '1' },
          { accountId: seeded.custody, direction: 'CREDIT', amount: '1' }
        ]
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    await cleanupPool.query(
      `UPDATE ledger_accounts SET status='FROZEN' WHERE account_id=$1::uuid`,
      [seeded.available]
    );
    await expect(
      poster.post({
        idempotencyKey: 'post-frozen-000001',
        transactionType: 'ADJUSTMENT',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: seeded.available, direction: 'CREDIT', amount: '1' },
          { accountId: seeded.custody, direction: 'DEBIT', amount: '1' }
        ]
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S3PE04: REVERSAL must go through the reversal service', async () => {
    const seeded = await seedUserWithAccounts();
    await expect(
      poster.post({
        idempotencyKey: 'post-reversal-0001',
        transactionType: 'REVERSAL',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: seeded.available, direction: 'CREDIT', amount: '1' },
          { accountId: seeded.custody, direction: 'DEBIT', amount: '1' }
        ]
      })
    ).rejects.toMatchObject({ code: 'LEDGER_COMMAND_INVALID' });
  });

  it('S3PE05: overdrawing an account is rejected with zero writes', async () => {
    const seeded = await seedUserWithAccounts();
    await seedCustody(seeded.custody, '100');
    await fundUser(seeded.available, seeded.custody, '100');
    await expect(
      poster.post({
        idempotencyKey: 'post-over-00000001',
        transactionType: 'INTERNAL_TRANSFER',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: seeded.available, direction: 'DEBIT', amount: '101' },
          { accountId: seeded.custody, direction: 'CREDIT', amount: '101' }
        ]
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    const balance = await unitOfWork.execute((context) =>
      accounts.accountBalance(context, seeded.available as never)
    );
    expect(balance).toBe('-100');
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key='post-over-00000001'`
    );
    expect(count.rows[0]?.n).toBe(0);
  });

  it('S3PE06: concurrent double-spend allows exactly one winner', async () => {
    const seeded = await seedUserWithAccounts();
    await seedCustody(seeded.custody, '100');
    await fundUser(seeded.available, seeded.custody, '100');
    const posterB = new PostMoneyService(
      unitOfWorkB,
      accounts,
      transactions
    );
    const spend = (key: string) =>
      poster.post({
        idempotencyKey: key,
        transactionType: 'INTERNAL_TRANSFER',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: seeded.available, direction: 'DEBIT', amount: '80' },
          { accountId: seeded.custody, direction: 'CREDIT', amount: '80' }
        ]
      });
    const spendB = (key: string) =>
      posterB.post({
        idempotencyKey: key,
        transactionType: 'INTERNAL_TRANSFER',
        occurredAt: '2026-08-17T12:00:00.000Z',
        lines: [
          { accountId: seeded.available, direction: 'DEBIT', amount: '80' },
          { accountId: seeded.custody, direction: 'CREDIT', amount: '80' }
        ]
      });
    const results = await Promise.allSettled([
      spend('spend-a-0000000001'),
      spendB('spend-b-0000000001')
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    expect(fulfilled).toBe(1);
    const balance = await unitOfWork.execute((context) =>
      accounts.accountBalance(context, seeded.available as never)
    );
    expect(balance).toBe('-20');
  });

  it('S3PE07: reversal writes the opposite transaction and marks the original', async () => {
    const seeded = await seedUserWithAccounts();
    await seedCustody(seeded.custody, '1000');
    const originalId = await fundUser(
      seeded.available,
      seeded.custody,
      '250'
    );
    const { reversalTransactionId } = await reverser.reverse({
      originalTransactionId: originalId,
      idempotencyKey: 'reverse-0000000001'
    });
    const rows = await cleanupPool.query<{
      transaction_id: string;
      status: string;
      type: string;
      reversed_by: string | null;
    }>(
      `SELECT transaction_id, status, transaction_type AS type,
              reversed_by_transaction_id AS reversed_by
         FROM ledger_transactions
        WHERE transaction_id = ANY($1::uuid[])`,
      [[originalId, reversalTransactionId]]
    );
    const original = rows.rows.find((r) => r.transaction_id === originalId);
    const reversal = rows.rows.find((r) => r.transaction_id === reversalTransactionId);
    expect(original?.status).toBe('REVERSED');
    expect(original?.reversed_by).toBe(reversalTransactionId);
    expect(reversal?.type).toBe('REVERSAL');
    expect(reversal?.status).toBe('POSTED');
    const balance = await unitOfWork.execute((context) =>
      accounts.accountBalance(context, seeded.available as never)
    );
    expect(balance).toBe('0');
    await expect(
      reverser.reverse({
        originalTransactionId: originalId,
        idempotencyKey: 'reverse-0000000002'
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S3PE08: platform aggregate accounts accumulate multiple postings', async () => {
    const seeded = await seedUserWithAccounts();
    await seedCustody(seeded.custody, '1000');
    await fundUser(seeded.available, seeded.custody, '10');
    await fundUser(seeded.available, seeded.custody, '15');
    const custodyBalance = await unitOfWork.execute((context) =>
      accounts.accountBalance(context, seeded.custody as never)
    );
    expect(custodyBalance).toBe('1025');
    const availableBalance = await unitOfWork.execute((context) =>
      accounts.accountBalance(context, seeded.available as never)
    );
    expect(availableBalance).toBe('-25');
  });
});
