import { readFile } from 'node:fs/promises';
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
import { ReconciliationService } from '../../src/modules/ledger/application/reconciliation.service.js';
import {
  FeeCalculator,
  RiskGate,
  AdminAuthorizer
} from '../../src/modules/crosscutting/application/crosscutting.services.js';
import {
  depositConfirmed,
  withdrawalRequested
} from '../../src/modules/ledger/templates/posting-templates.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
let unitOfWorkB: UnitOfWork;
const accounts = new PostgresLedgerAccountRepository();
const transactions = new PostgresLedgerTransactionRepository();
let poster: PostMoneyService;
let posterB: PostMoneyService;
let reverser: ReverseTransactionService;
let balances: BalanceQueryService;
let reconciliation: ReconciliationService;
let fees: FeeCalculator;
let risk: RiskGate;
let adminAuth: AdminAuthorizer;

async function seedUser(): Promise<{
  uid: Uid; available: string; frozen: string;
}> {
  const uid = await unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
  const available = await unitOfWork.execute((c) =>
    accounts.openUserAccount(c, {
      ownerUid: uid, assetCode: 'USDT-TRC20', purpose: 'USER_AVAILABLE',
      idempotencyKey: `open-${randomUUID()}`
    })
  );
  const frozen = await unitOfWork.execute((c) =>
    accounts.openUserAccount(c, {
      ownerUid: uid, assetCode: 'USDT-TRC20', purpose: 'USER_FROZEN',
      idempotencyKey: `open-${randomUUID()}`
    })
  );
  return { uid, available: available.accountId, frozen: frozen.accountId };
}

async function seedPlatform(): Promise<{
  custody: string; feeIncome: string; clearingDiff: string;
}> {
  const result: Record<string, string> = {};
  for (const purpose of ['PLATFORM_CUSTODY', 'FEE_INCOME', 'CLEARING_DIFF']) {
    const rows = await cleanupPool.query<{ account_id: string }>(
      `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
       VALUES (NULL, 'USDT-TRC20', $1) RETURNING account_id`, [purpose]
    );
    result[purpose] = rows.rows[0]!.account_id;
  }
  const tx = randomUUID();
  const boot = 1_000_000;
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`, [tx, `boot-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     VALUES ($1::uuid, $2::uuid, 'DEBIT', $3::bigint, 0),
            ($1::uuid, $4::uuid, 'CREDIT', $3::bigint, 1)`,
    [tx, result['PLATFORM_CUSTODY']!, boot, result['CLEARING_DIFF']!]
  );
  await balances.recomputeAll();
  return {
    custody: result['PLATFORM_CUSTODY']!,
    feeIncome: result['FEE_INCOME']!,
    clearingDiff: result['CLEARING_DIFF']!
  };
}

async function fund(available: string, custody: string, amount: string): Promise<void> {
  await poster.post({
    idempotencyKey: `fund-${randomUUID()}`,
    transactionType: 'DEPOSIT',
    occurredAt: new Date().toISOString(),
    lines: [
      { accountId: custody, direction: 'DEBIT', amount },
      { accountId: available, direction: 'CREDIT', amount }
    ]
  });
}

async function bal(id: string): Promise<string> {
  return balances.accountBalanceOf(id as never);
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot, startupTimeoutMillis: 120_000, stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, {
    projectRoot, configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s3a-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 6, application_name: 'xht-s3a-platform'
  });
  const mkUoW = (): UnitOfWork => {
    const k = new Kysely<StageOneDatabase>({
      dialect: new PostgresDialect({
        pool: new RoleEnforcingPostgresPool(
          platformPool as never, fixture.platformLogin.username
        )
      })
    });
    return createUnitOfWork(k);
  };
  unitOfWork = mkUoW();
  unitOfWorkB = mkUoW();
  poster = new PostMoneyService(unitOfWork, accounts, transactions);
  posterB = new PostMoneyService(unitOfWorkB, accounts, transactions);
  reverser = new ReverseTransactionService(unitOfWork, accounts, transactions);
  balances = new BalanceQueryService(unitOfWork, accounts);
  reconciliation = new ReconciliationService(unitOfWork, accounts);
  fees = new FeeCalculator(unitOfWork);
  risk = new RiskGate(unitOfWork);
  adminAuth = new AdminAuthorizer(unitOfWork);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'risk_decisions', 'operation_limits', 'fee_schedules',
    'admin_role_grants', 'admin_principals',
    'account_balances', 'ledger_entries', 'ledger_transactions',
    'account_openings', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('stage three acceptance (S3A01–S3A12)', () => {
  it('S3A01: empty ledger has zero global balance per asset', async () => {
    const report = await reconciliation.runAll();
    expect(report.discrepancies.filter(d => d.kind === 'GLOBAL_BALANCE')).toEqual([]);
  });

  it('S3A02: idempotent replay produces zero new rows', async () => {
    const user = await seedUser();
    const platform = await seedPlatform();
    const cmd = {
      idempotencyKey: 's3a-idem-000001',
      transactionType: 'DEPOSIT' as const,
      occurredAt: new Date().toISOString(),
      lines: [
        { accountId: platform.custody, direction: 'DEBIT' as const, amount: '100' },
        { accountId: user.available, direction: 'CREDIT' as const, amount: '100' }
      ]
    };
    const first = await poster.post(cmd);
    const second = await poster.post(cmd);
    expect(second.posted).toBe(false);
    expect(second.transactionId).toBe(first.transactionId);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions WHERE idempotency_key='s3a-idem-000001'`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S3A03: overdrawing is rejected with zero writes', async () => {
    const user = await seedUser();
    const platform = await seedPlatform();
    await fund(user.available, platform.custody, '100');
    await expect(
      poster.post({
        idempotencyKey: 's3a-over-000001',
        transactionType: 'WITHDRAWAL',
        occurredAt: new Date().toISOString(),
        lines: [
          { accountId: user.available, direction: 'DEBIT', amount: '101' },
          { accountId: platform.custody, direction: 'CREDIT', amount: '101' }
        ]
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    expect(await bal(user.available)).toBe('-100');
  });

  it('S3A04: entries are immutable at the permission level', async () => {
    const client = await platformPool.connect();
    try {
      await client.query('SET ROLE xht_platform');
      await expect(client.query('UPDATE ledger_entries SET amount=999'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(client.query('DELETE FROM ledger_entries'))
        .rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release();
    }
  });

  it('S3A05: concurrent double-spend allows exactly one winner', async () => {
    const user = await seedUser();
    const platform = await seedPlatform();
    await fund(user.available, platform.custody, '100');
    const spend = (p: PostMoneyService, key: string) => p.post({
      idempotencyKey: key,
      transactionType: 'INTERNAL_TRANSFER',
      occurredAt: new Date().toISOString(),
      lines: [
        { accountId: user.available, direction: 'DEBIT', amount: '80' },
        { accountId: platform.custody, direction: 'CREDIT', amount: '80' }
      ]
    });
    const results = await Promise.allSettled([
      spend(poster, 's3a-spend-a-1'),
      spend(posterB, 's3a-spend-b-1')
    ]);
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
    expect(await bal(user.available)).toBe('-20');
  });

  it('S3A06-07: reversal writes opposite transaction and restores balance', async () => {
    const user = await seedUser();
    const platform = await seedPlatform();
    const posted = await poster.post({
      idempotencyKey: 's3a-rev-0000001',
      transactionType: 'DEPOSIT',
      occurredAt: new Date().toISOString(),
      lines: [
        { accountId: platform.custody, direction: 'DEBIT', amount: '250' },
        { accountId: user.available, direction: 'CREDIT', amount: '250' }
      ]
    });
    const { reversalTransactionId } = await reverser.reverse({
      originalTransactionId: posted.transactionId,
      idempotencyKey: 's3a-rev-rev-01'
    });
    expect(reversalTransactionId).toBeTruthy();
    expect(await bal(user.available)).toBe('0');
    await expect(
      reverser.reverse({
        originalTransactionId: posted.transactionId,
        idempotencyKey: 's3a-rev-rev-02'
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S3A08: projections stay consistent with entries after posting', async () => {
    const user = await seedUser();
    const platform = await seedPlatform();
    await fund(user.available, platform.custody, '500');
    await poster.post({
      idempotencyKey: 's3a-proj-000001',
      transactionType: 'WITHDRAWAL',
      occurredAt: new Date().toISOString(),
      lines: [
        { accountId: user.available, direction: 'DEBIT', amount: '200' },
        { accountId: platform.custody, direction: 'CREDIT', amount: '200' }
      ]
    });
    expect(await reconciliation.checkProjectionConsistency()).toEqual([]);
  });

  it('S3A09: tampering is caught and recomputation restores truth', async () => {
    const user = await seedUser();
    const platform = await seedPlatform();
    await fund(user.available, platform.custody, '100');
    await cleanupPool.query(
      `UPDATE account_balances SET signed_balance=999999 WHERE account_id=$1::uuid`,
      [user.available]
    );
    const discrepancies = await reconciliation.checkProjectionConsistency();
    expect(discrepancies.length).toBeGreaterThanOrEqual(1);
    await balances.recomputeAll();
    expect(await reconciliation.checkProjectionConsistency()).toEqual([]);
  });

  it('S3A10: posting templates produce correct projections', async () => {
    const user = await seedUser();
    const platform = await seedPlatform();
    const result = depositConfirmed({
      custodyAccountId: platform.custody as never,
      userAvailableAccountId: user.available as never,
      amount: '300',
      orderId: 's3a-dep-1'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const posted = await poster.post(result.command);
      expect(posted.posted).toBe(true);
      expect(result.command.idempotencyKey).toBe('DEPOSIT:s3a-dep-1:CONFIRM:0');
    }
    expect(await bal(user.available)).toBe('-300');
  });

  it('S3A11: crosscutting contracts work end-to-end', async () => {
    const user = await seedUser();
    await cleanupPool.query(
      `INSERT INTO fee_schedules (fee_version, asset_code, basis_points, fixed_amount)
       VALUES (1, 'USDT-TRC20', 100, 0)`
    );
    const fee = await fees.calculate({ assetCode: 'USDT-TRC20', amount: '1000000' });
    expect(fee.feeAmount).toBe('10000');
    await cleanupPool.query(
      `INSERT INTO operation_limits (uid, operation_type, window_seconds, max_count, max_amount)
       VALUES ($1::uuid, 'WITHDRAWAL', 3600, 5, 500000)`, [user.uid]
    );
    const denied = await risk.check({
      uid: user.uid, operationType: 'WITHDRAWAL',
      amount: '999999', idempotencyKey: 's3a-risk-1'
    });
    expect(denied.allowed).toBe(false);
    const adminId = randomUUID();
    await cleanupPool.query(
      `INSERT INTO admin_principals (admin_id) VALUES ($1::uuid)`, [adminId]
    );
    await cleanupPool.query(
      `INSERT INTO admin_role_grants (admin_id, role) VALUES ($1::uuid, 'RISK_OFFICER')`,
      [adminId]
    );
    expect(await adminAuth.isAuthorized(adminId, 'RISK_OFFICER')).toBe(true);
    expect(await adminAuth.isAuthorized(adminId, 'SUPER_ADMIN')).toBe(false);
  });

  it('S3A12: ledger modules stay channel-agnostic with zero violations', async () => {
    const files = [
      'apps/platform/src/modules/ledger/domain/ledger.types.ts',
      'apps/platform/src/modules/ledger/application/post-money.service.ts',
      'apps/platform/src/modules/ledger/application/reconciliation.service.ts',
      'apps/platform/src/modules/ledger/templates/posting-templates.ts'
    ];
    for (const file of files) {
      const source = await readFile(resolve(projectRoot, file), 'utf8');
      expect(source.match(/grammy|telegram/u) ?? []).toEqual([]);
    }
  });
});
