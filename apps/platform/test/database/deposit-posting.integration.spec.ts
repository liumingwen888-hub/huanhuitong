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
import { PostgresOutboxRepository } from '../../src/modules/reliability/outbox/outbox.repository.js';
import { PostgresDepositAddressRepository } from '../../src/modules/deposits/infrastructure/postgres-deposit.repository.js';
import { DepositAddressService } from '../../src/modules/deposits/application/deposit-address.service.js';
import { DepositPostingService } from '../../src/modules/deposits/application/deposit-posting.service.js';
import { FakeDerivationSource } from '../../src/modules/deposits/domain/fake-derivation.source.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const depositAddresses = new PostgresDepositAddressRepository();
const derivation = new FakeDerivationSource();
let addressService: DepositAddressService;
let poster: PostMoneyService;
let balances: BalanceQueryService;
let postingService: DepositPostingService;

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function createConfirmedDetection(
  uid: Uid,
  txid: string,
  amount: string
): Promise<string> {
  const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
  return unitOfWork.execute(async (context) => {
    const result = await context.executeSql<{ detection_id: string }>(
      `INSERT INTO deposit_detections
         (address_id, network, network_txid, network_timestamp,
          amount, confirmations, status)
       VALUES ($1::uuid, 'TRON', $2, clock_timestamp(), $3, 19, 'CONFIRMED')
       RETURNING detection_id`,
      [addr.addressId, txid, amount]
    );
    return result.rows[0]!.detection_id;
  });
}

async function seedCustodyWithFunds(
  assetCode: string,
  amount: string
): Promise<string> {
  const custody = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, $1, 'PLATFORM_CUSTODY') RETURNING account_id`,
    [assetCode]
  );
  const clearing = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, $1, 'CLEARING_DIFF') RETURNING account_id`,
    [assetCode]
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
    [tx, custody.rows[0]!.account_id, amount, clearing.rows[0]!.account_id]
  );
  return custody.rows[0]!.account_id;
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
    max: 1, application_name: 'xht-s45-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s45-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never, fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
  addressService = new DepositAddressService(
    unitOfWork, depositAddresses, derivation
  );
  poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  balances = new BalanceQueryService(unitOfWork, ledgerAccounts);
  postingService = new DepositPostingService(
    unitOfWork, ledgerAccounts, poster, new PostgresOutboxRepository()
  );
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'outbox_messages', 'deposit_detections', 'address_assignments',
    'deposit_addresses', 'chain_scan_checkpoints',
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

describe.sequential('S4-5 deposit posting orchestration', () => {
  it('S4PO00: direct poster.post works in this test context', async () => {
    const uid = await seedUser();
    const custodyId = await seedCustodyWithFunds('USDT-TRC20', '1000000');
    // Create user available account directly
    const userAcct = await unitOfWork.execute((context) =>
      ledgerAccounts.openUserAccount(context, {
        ownerUid: uid,
        assetCode: 'USDT-TRC20',
        purpose: 'USER_AVAILABLE',
        idempotencyKey: `open-direct-${Date.now()}`
      })
    );
    // Post directly
    const result = await poster.post({
      idempotencyKey: `DEPOSIT:TRON:direct-test:CONFIRM:0`,
      transactionType: 'DEPOSIT',
      occurredAt: new Date().toISOString(),
      lines: [
        { accountId: custodyId, direction: 'DEBIT', amount: '100000' },
        { accountId: userAcct.accountId, direction: 'CREDIT', amount: '100000' }
      ]
    });
    expect(result.posted).toBe(true);
  });

  it('S4PO01: a confirmed detection posts to the ledger and creates a notification', async () => {
    const uid = await seedUser();
    const custody = await seedCustodyWithFunds('USDT-TRC20', '1000000');
    const detection = await createConfirmedDetection(uid, 'tx-post-001', '500000');
    const result = await postingService.postConfirmedDeposits('TRON');
    expect(result.posted).toBe(1);
    expect(result.failed).toBe(0);
    const status = await cleanupPool.query<{ status: string; ledger_tx: string | null }>(
      `SELECT status, ledger_transaction_id::text AS ledger_tx
         FROM deposit_detections WHERE detection_id=$1::uuid`,
      [detection]
    );
    expect(status.rows[0]?.status).toBe('POSTED');
    expect(status.rows[0]?.ledger_tx).not.toBeNull();
    const userBal = await cleanupPool.query<{ bal: string }>(
      `SELECT COALESCE(SUM(CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END), 0)::text AS bal
         FROM ledger_entries e
         JOIN ledger_accounts a ON a.account_id = e.account_id
        WHERE a.owner_uid = $1::uuid AND a.purpose = 'USER_AVAILABLE'`,
      [uid]
    );
    expect(userBal.rows[0]?.bal).toBe('-500000');
    const notifications = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.deposit-confirmed.v1'`
    );
    expect(notifications.rows[0]?.n).toBe(1);
    void custody;
  });

  it('S4PO02: re-posting the same detection is a no-op (idempotent)', async () => {
    const uid = await seedUser();
    await seedCustodyWithFunds('USDT-TRC20', '1000000');
    await createConfirmedDetection(uid, 'tx-post-002', '100000');
    const first = await postingService.postConfirmedDeposits('TRON');
    expect(first.posted).toBe(1);
    const second = await postingService.postConfirmedDeposits('TRON');
    expect(second.posted).toBe(0);
    expect(second.skipped).toBe(0);
    expect(second.failed).toBe(0);
    const txCount = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key LIKE 'DEPOSIT:TRON:tx-post-002%'`
    );
    expect(txCount.rows[0]?.n).toBe(1);
  });

  it('S4PO03: multiple confirmed detections all post in order', async () => {
    const uid = await seedUser();
    await seedCustodyWithFunds('USDT-TRC20', '3000000');
    await createConfirmedDetection(uid, 'tx-multi-01', '100000');
    await createConfirmedDetection(uid, 'tx-multi-02', '200000');
    await createConfirmedDetection(uid, 'tx-multi-03', '300000');
    const result = await postingService.postConfirmedDeposits('TRON');
    expect(result.posted).toBe(3);
    const userBal = await cleanupPool.query<{ bal: string }>(
      `SELECT COALESCE(SUM(CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END), 0)::text AS bal
         FROM ledger_entries e
         JOIN ledger_accounts a ON a.account_id = e.account_id
        WHERE a.owner_uid = $1::uuid AND a.purpose = 'USER_AVAILABLE'`,
      [uid]
    );
    expect(userBal.rows[0]?.bal).toBe('-600000');
  });

  it('S4PO04: user account is auto-created on first deposit', async () => {
    const uid = await seedUser();
    await seedCustodyWithFunds('USDT-TRC20', '100000');
    const before = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_accounts
        WHERE owner_uid = $1::uuid AND purpose = 'USER_AVAILABLE'`,
      [uid]
    );
    expect(before.rows[0]?.n).toBe(0);
    await createConfirmedDetection(uid, 'tx-auto-01', '50000');
    await postingService.postConfirmedDeposits('TRON');
    const after = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_accounts
        WHERE owner_uid = $1::uuid AND purpose = 'USER_AVAILABLE'`,
      [uid]
    );
    expect(after.rows[0]?.n).toBe(1);
  });
});
