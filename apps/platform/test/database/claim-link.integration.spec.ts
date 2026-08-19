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
  PostgresClaimLinkRepository
} from '../../src/modules/transfers/infrastructure/postgres-transfer.repository.js';
import { ClaimLinkService } from '../../src/modules/transfers/application/claim-link.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const links = new PostgresClaimLinkRepository();
let claimService: ClaimLinkService;

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function seedCustodyAndFund(
  uid: Uid,
  amount: string
): Promise<void> {
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
    [tx, custody.rows[0]!.account_id, '10000000',
     clearing.rows[0]!.account_id]
  );
  const poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  const userAcct = await unitOfWork.execute((context) =>
    ledgerAccounts.openUserAccount(context, {
      ownerUid: uid,
      assetCode: 'USDT-TRC20',
      purpose: 'USER_AVAILABLE',
      idempotencyKey: `open-${randomUUID()}`
    })
  );
  await poster.post({
    idempotencyKey: `fund-${randomUUID()}`,
    transactionType: 'DEPOSIT',
    occurredAt: new Date().toISOString(),
    lines: [
      { accountId: custody.rows[0]!.account_id, direction: 'DEBIT', amount },
      { accountId: userAcct.accountId, direction: 'CREDIT', amount }
    ]
  });
}

async function userBalance(uid: string): Promise<string> {
  const rows = await cleanupPool.query<{ bal: string }>(
    `SELECT COALESCE(SUM(CASE e.direction WHEN 'DEBIT' THEN e.amount ELSE -e.amount END), 0)::text AS bal
       FROM ledger_entries e
       JOIN ledger_accounts a ON a.account_id = e.account_id
      WHERE a.owner_uid = $1::uuid AND a.purpose = 'USER_AVAILABLE'`,
    [uid]
  );
  return rows.rows[0]?.bal ?? '0';
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
    max: 1, application_name: 'xht-s53-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s53-platform'
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
    'outbox_messages', 'claim_links',
    'account_balances', 'ledger_entries', 'ledger_transactions',
    'account_openings', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  const poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  claimService = new ClaimLinkService(
    unitOfWork, links, ledgerAccounts, poster,
    new PostgresOutboxRepository()
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S5-3 claim link service', () => {
  it('S5CL01: creating a link freezes the amount from creator', async () => {
    const creator = await seedUser();
    await seedCustodyAndFund(creator, '1000000');
    const link = await claimService.createLink({
      creatorUid: creator,
      assetCode: 'USDT-TRC20',
      amount: '300000'
    });
    expect(link.status).toBe('ACTIVE');
    expect(link.claimCode).toMatch(/^clm-/);
    expect(await userBalance(creator)).toBe('-700000');
  });

  it('S5CL02: claiming releases the frozen amount to the claimer', async () => {
    const creator = await seedUser();
    const claimer = await seedUser();
    await seedCustodyAndFund(creator, '500000');
    const link = await claimService.createLink({
      creatorUid: creator,
      assetCode: 'USDT-TRC20',
      amount: '200000'
    });
    const result = await claimService.claim(link.claimCode, claimer);
    expect(result.kind).toBe('claimed');
    expect(await userBalance(claimer)).toBe('-200000');
    expect(await userBalance(creator)).toBe('-300000');
  });

  it('S5CL03: double claim is rejected', async () => {
    const creator = await seedUser();
    const claimer = await seedUser();
    await seedCustodyAndFund(creator, '100000');
    const link = await claimService.createLink({
      creatorUid: creator,
      assetCode: 'USDT-TRC20',
      amount: '50000'
    });
    await claimService.claim(link.claimCode, claimer);
    const second = await claimService.claim(link.claimCode, claimer);
    expect(second.kind).toBe('already_claimed');
    expect(await userBalance(claimer)).toBe('-50000');
  });

  it('S5CL04: expired link is refunded to creator', async () => {
    const creator = await seedUser();
    const claimer = await seedUser();
    await seedCustodyAndFund(creator, '100000');
    const link = await claimService.createLink({
      creatorUid: creator,
      assetCode: 'USDT-TRC20',
      amount: '50000'
    });
    // Manually expire
    await cleanupPool.query(
      `UPDATE claim_links SET expires_at = clock_timestamp() - interval '1 second'
        WHERE link_id = $1::uuid`,
      [link.linkId]
    );
    const result = await claimService.claim(link.claimCode, claimer);
    expect(result.kind).toBe('expired');
    expect(await userBalance(creator)).toBe('-100000');
    expect(await userBalance(claimer)).toBe('0');
  });

  it('S5CL05: non-existent code returns not_found', async () => {
    const claimer = await seedUser();
    const result = await claimService.claim('nonexistent', claimer);
    expect(result.kind).toBe('not_found');
  });
});
