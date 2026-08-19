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
import {
  PostgresTransferOrderRepository
} from '../../src/modules/transfers/infrastructure/postgres-transfer.repository.js';
import { TransferExecutionService } from '../../src/modules/transfers/application/transfer-execution.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
let unitOfWorkB: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const orders = new PostgresTransferOrderRepository();
let transferService: TransferExecutionService;
let transferServiceB: TransferExecutionService;

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function fundUser(
  uid: Uid,
  amount: string
): Promise<void> {
  const poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  const userAcct = await unitOfWork.execute((context) =>
    ledgerAccounts.openUserAccount(context, {
      ownerUid: uid,
      assetCode: 'USDT-TRC20',
      purpose: 'USER_AVAILABLE',
      idempotencyKey: `open-fund-${randomUUID()}`
    })
  );
  const custody = await unitOfWork.execute(async (context) => {
    const rows = await context.executeSql<{ account_id: string }>(
      `SELECT account_id FROM ledger_accounts
        WHERE owner_uid IS NULL AND asset_code = 'USDT-TRC20'
          AND purpose = 'PLATFORM_CUSTODY' LIMIT 1`
    );
    return rows.rows[0]?.account_id;
  });
  await poster.post({
    idempotencyKey: `fund-${randomUUID()}`,
    transactionType: 'DEPOSIT',
    occurredAt: new Date().toISOString(),
    lines: [
      { accountId: custody!, direction: 'DEBIT', amount },
      { accountId: userAcct.accountId, direction: 'CREDIT', amount }
    ]
  });
}

async function seedCustody(amount = '10000000'): Promise<void> {
  const custody = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY') RETURNING account_id`
  );
  const clearing = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'CLEARING_DIFF') RETURNING account_id`
  );
  const tx = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
    [tx, `boot-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     VALUES ($1::uuid, $2::uuid, 'DEBIT', $3::bigint, 0),
            ($1::uuid, $4::uuid, 'CREDIT', $3::bigint, 1)`,
    [tx, custody.rows[0]!.account_id, amount,
     clearing.rows[0]!.account_id]
  );
}

async function userBalance(uid: string): Promise<string> {
  const rows = await cleanupPool.query<{ bal: string }>(
    `SELECT COALESCE(SUM(CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END), 0)::text AS bal
       FROM ledger_entries e
       JOIN ledger_accounts a ON a.account_id = e.account_id
      WHERE a.owner_uid = $1::uuid AND a.purpose = 'USER_AVAILABLE'`,
    [uid]
  );
  return rows.rows[0]?.bal ?? '0';
}

async function notificationCount(): Promise<number> {
  const rows = await cleanupPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outbox_messages
      WHERE topic LIKE 'telegram.transfer-%'`
  );
  return rows.rows[0]?.n ?? 0;
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
    max: 1, application_name: 'xht-s52-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 6, application_name: 'xht-s52-platform'
  });
  const mk = (): UnitOfWork => {
    const k = new Kysely<StageOneDatabase>({
      dialect: new PostgresDialect({
        pool: new RoleEnforcingPostgresPool(
          platformPool as never, fixture.platformLogin.username
        )
      })
    });
    return createUnitOfWork(k);
  };
  unitOfWork = mk();
  unitOfWorkB = mk();
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'outbox_messages', 'transfer_orders',
    'account_balances', 'ledger_entries', 'ledger_transactions',
    'account_openings', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  await seedCustody();
  const poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  transferService = new TransferExecutionService(
    unitOfWork, orders, ledgerAccounts, poster,
    new PostgresOutboxRepository()
  );
  const posterB = new PostMoneyService(
    unitOfWorkB, ledgerAccounts, ledgerTransactions
  );
  transferServiceB = new TransferExecutionService(
    unitOfWorkB, orders, ledgerAccounts, posterB,
    new PostgresOutboxRepository()
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S5-2 transfer execution service', () => {
  it('S5TE01: normal transfer executes with balance change and notifications', async () => {
    const sender = await seedUser();
    const recipient = await seedUser();
    await fundUser(sender, '1000000');
    const result = await transferService.execute({
      orderRef: 'XFER-001',
      senderUid: sender,
      recipientUid: recipient,
      assetCode: 'USDT-TRC20',
      amount: '300000'
    });
    expect(result.kind).toBe('executed');
    expect(await userBalance(sender)).toBe('-700000');
    expect(await userBalance(recipient)).toBe('-300000');
    expect(await notificationCount()).toBe(2);
  });

  it('S5TE02: replaying the same orderRef returns existing without new rows', async () => {
    const sender = await seedUser();
    const recipient = await seedUser();
    await fundUser(sender, '500000');
    const cmd = {
      orderRef: 'XFER-IDEM',
      senderUid: sender,
      recipientUid: recipient,
      assetCode: 'USDT-TRC20',
      amount: '100000'
    };
    const first = await transferService.execute(cmd);
    expect(first.kind).toBe('executed');
    const second = await transferService.execute(cmd);
    expect(second.kind).toBe('already_executed');
    expect(await userBalance(sender)).toBe('-400000');
    expect(await notificationCount()).toBe(2);
  });

  it('S5TE03: insufficient balance fails without balance change', async () => {
    const sender = await seedUser();
    const recipient = await seedUser();
    await fundUser(sender, '100000');
    const result = await transferService.execute({
      orderRef: 'XFER-OVER',
      senderUid: sender,
      recipientUid: recipient,
      assetCode: 'USDT-TRC20',
      amount: '200000'
    });
    expect(result.kind).toBe('failed');
    expect(await userBalance(sender)).toBe('-100000');
    expect(await notificationCount()).toBe(0);
  });

  it('S5TE04: concurrent transfers from the same sender allow exactly one', async () => {
    const sender = await seedUser();
    const recipient = await seedUser();
    await fundUser(sender, '500000');
    const results = await Promise.allSettled([
      transferService.execute({
        orderRef: 'XFER-RACE-A',
        senderUid: sender,
        recipientUid: recipient,
        assetCode: 'USDT-TRC20',
        amount: '400000'
      }),
      transferServiceB.execute({
        orderRef: 'XFER-RACE-B',
        senderUid: sender,
        recipientUid: recipient,
        assetCode: 'USDT-TRC20',
        amount: '400000'
      })
    ]);
    const executed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.kind === 'executed'
    ).length;
    expect(executed).toBe(1);
    expect(await userBalance(sender)).toBe('-100000');
  });
});
