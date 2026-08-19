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
import { BalanceQueryService } from '../../src/modules/ledger/application/balance-query.service.js';
import {
  ReconciliationService
} from '../../src/modules/ledger/application/reconciliation.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const accounts = new PostgresLedgerAccountRepository();
const transactions = new PostgresLedgerTransactionRepository();
let poster: PostMoneyService;
let balances: BalanceQueryService;
let reconciliation: ReconciliationService;

async function seedFundedUser(): Promise<{
  uid: Uid;
  available: string;
  custody: string;
}> {
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
  const boot = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
    [boot, `boot-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     VALUES ($1::uuid, $2::uuid, 'DEBIT', 10000, 0),
            ($1::uuid, $3::uuid, 'CREDIT', 10000, 1)`,
    [boot, custodyRows.rows[0]!.account_id, clearingRows.rows[0]!.account_id]
  );
  await balances.recomputeAll();
  return { uid, available: available.accountId, custody: custodyRows.rows[0]!.account_id };
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
    application_name: 'xht-s35-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s35-platform'
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
  balances = new BalanceQueryService(unitOfWork, accounts);
  reconciliation = new ReconciliationService(unitOfWork, accounts);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'risk_decisions',
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

describe.sequential('S3-5 reconciliation', () => {
  it('S3R01: clean ledger reports zero discrepancies', async () => {
    const seeded = await seedFundedUser();
    await poster.post({
      idempotencyKey: 'recon-clean-00001',
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: seeded.custody, direction: 'DEBIT', amount: '100' },
        { accountId: seeded.available, direction: 'CREDIT', amount: '100' }
      ]
    });
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([]);
    expect(report.checkedAt).toBeTruthy();
  });

  it('S3R02: injected imbalance is caught by global balance check', async () => {
    const seeded = await seedFundedUser();
    void seeded;
    await cleanupPool.query(
      `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
       VALUES (NULL, 'BTC', 'PLATFORM_CUSTODY')`
    );
    const orphan = await cleanupPool.query<{ account_id: string }>(
      `SELECT account_id FROM ledger_accounts WHERE asset_code='BTC' LIMIT 1`
    );
    const tx = randomUUID();
    await cleanupPool.query(
      `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
       VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
      [tx, `orphan-${randomUUID()}`]
    );
    await cleanupPool.query(
      `ALTER TABLE ledger_entries DISABLE TRIGGER trg_ledger_entries_balanced`
    );
    await cleanupPool.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
       VALUES ($1::uuid, $2::uuid, 'DEBIT', 777, 0)`,
      [tx, orphan.rows[0]!.account_id]
    );
    await cleanupPool.query(
      `ALTER TABLE ledger_entries ENABLE TRIGGER trg_ledger_entries_balanced`
    );
    const report = await reconciliation.runAll();
    const global = report.discrepancies.filter((d) => d.kind === 'GLOBAL_BALANCE');
    expect(global.length).toBeGreaterThanOrEqual(1);
    expect((global[0] as { assetCode: string }).assetCode).toBe('BTC');
  });

  it('S3R03: projection tampering is caught and alerts are idempotent', async () => {
    const seeded = await seedFundedUser();
    await poster.post({
      idempotencyKey: 'recon-tamper-00001',
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: seeded.custody, direction: 'DEBIT', amount: '200' },
        { accountId: seeded.available, direction: 'CREDIT', amount: '200' }
      ]
    });
    await cleanupPool.query(
      `UPDATE account_balances SET signed_balance = 555555
        WHERE account_id = $1::uuid`,
      [seeded.available]
    );
    const firstReport = await reconciliation.runAll();
    expect(firstReport.discrepancies.length).toBeGreaterThanOrEqual(1);
    const firstAlerts = await reconciliation.recordDiscrepancyAlerts(
      firstReport,
      'window-1'
    );
    expect(firstAlerts).toBeGreaterThanOrEqual(1);
    const secondAlerts = await reconciliation.recordDiscrepancyAlerts(
      firstReport,
      'window-1'
    );
    expect(secondAlerts).toBe(0);
    const differentWindowAlerts = await reconciliation.recordDiscrepancyAlerts(
      firstReport,
      'window-2'
    );
    expect(differentWindowAlerts).toBe(firstAlerts);
  });

  it('S3R04: order lookup by idempotency key fragment', async () => {
    const seeded = await seedFundedUser();
    await poster.post({
      idempotencyKey: `fund-s3r4-${randomUUID()}`,
      transactionType: 'DEPOSIT',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: seeded.custody, direction: 'DEBIT', amount: '1000' },
        { accountId: seeded.available, direction: 'CREDIT', amount: '1000' }
      ]
    });
    const posted = await poster.post({
      idempotencyKey: 'WITHDRAWAL:order-42:EXECUTE:0',
      transactionType: 'WITHDRAWAL',
      occurredAt: '2026-08-17T12:00:00.000Z',
      lines: [
        { accountId: seeded.available, direction: 'DEBIT', amount: '50' },
        { accountId: seeded.custody, direction: 'CREDIT', amount: '50' }
      ]
    });
    const found = await reconciliation.findTransactionByOrderKey(
      'WITHDRAWAL',
      'order-42'
    );
    expect(found).toBe(posted.transactionId);
    const notFound = await reconciliation.findTransactionByOrderKey(
      'WITHDRAWAL',
      'order-99'
    );
    expect(notFound).toBeNull();
  });
});
