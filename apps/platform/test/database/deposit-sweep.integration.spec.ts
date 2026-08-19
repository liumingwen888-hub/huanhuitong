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
import { PostgresDepositAddressRepository } from '../../src/modules/deposits/infrastructure/postgres-deposit.repository.js';
import { DepositAddressService } from '../../src/modules/deposits/application/deposit-address.service.js';
import { DepositPostingService } from '../../src/modules/deposits/application/deposit-posting.service.js';
import { DepositSweepService } from '../../src/modules/deposits/application/deposit-sweep.service.js';
import { FakeDerivationSource } from '../../src/modules/deposits/domain/fake-derivation.source.js';
import { FakeBroadcaster } from '../../src/modules/deposits/domain/fake-broadcaster.js';
import { PostgresOutboxRepository } from '../../src/modules/reliability/outbox/outbox.repository.js';

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
let postingService: DepositPostingService;
let broadcaster: FakeBroadcaster;
let sweepService: DepositSweepService;
const MAIN_WALLET = 'TXtMainWalletAddress0000000000000000001';

async function seedUserWithDeposit(
  amount: string
): Promise<Uid> {
  const uid = await unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
  // Create custody + clearing for bootstrap
  const custody = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY') RETURNING account_id`,
    []
  );
  const clearing = await cleanupPool.query<{ account_id: string }>(
    `SELECT account_id FROM ledger_accounts
      WHERE owner_uid IS NULL AND asset_code = 'USDT-TRC20' AND purpose = 'CLEARING_DIFF'`
  );
  if (clearing.rows.length === 0) {
    await cleanupPool.query(
      `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
       VALUES (NULL, 'USDT-TRC20', 'CLEARING_DIFF')`
    );
  }
  const clearingId = (await cleanupPool.query<{ account_id: string }>(
    `SELECT account_id FROM ledger_accounts
      WHERE owner_uid IS NULL AND asset_code = 'USDT-TRC20' AND purpose = 'CLEARING_DIFF'`
  )).rows[0]!.account_id;
  const boot = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
    [boot, `boot-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     VALUES ($1::uuid, $2::uuid, 'DEBIT', 10000000, 0),
            ($1::uuid, $3::uuid, 'CREDIT', 10000000, 1)`,
    [boot, custody.rows[0]!.account_id, clearingId]
  );
  // Create address + confirmed detection + post it
  const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
  const txid = `tx-${randomUUID()}`;
  await unitOfWork.execute(async (context) => {
    await context.executeSql(
      `INSERT INTO deposit_detections
         (address_id, network, network_txid, network_timestamp,
          amount, confirmations, status)
       VALUES ($1::uuid, 'TRON', $2, clock_timestamp(), $3, 19, 'CONFIRMED')`,
      [addr.addressId, txid, amount]
    );
  });
  await postingService.postConfirmedDeposits('TRON');
  return uid;
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
    max: 1, application_name: 'xht-s46-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s46-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never, fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
  const poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  addressService = new DepositAddressService(
    unitOfWork, depositAddresses, derivation
  );
  postingService = new DepositPostingService(
    unitOfWork, ledgerAccounts, poster, new PostgresOutboxRepository()
  );
  broadcaster = new FakeBroadcaster();
  sweepService = new DepositSweepService(
    unitOfWork, ledgerAccounts, poster, broadcaster
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
  broadcaster = new FakeBroadcaster();
  sweepService = new DepositSweepService(
    unitOfWork, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    broadcaster
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S4-6 deposit sweep service', () => {
  it('S4SW01: finds addresses above the sweep threshold', async () => {
    await seedUserWithDeposit('500000');
    const candidates = await sweepService.findSweepCandidates(
      'TRON', '100000'
    );
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.totalAmount).toBe('500000');
  });

  it('S4SW02: below-threshold addresses are not candidates', async () => {
    await seedUserWithDeposit('50000');
    const candidates = await sweepService.findSweepCandidates(
      'TRON', '100000'
    );
    expect(candidates).toEqual([]);
  });

  it('S4SW03: sweep posts ledger entries and broadcasts', async () => {
    await seedUserWithDeposit('500000');
    const result = await sweepService.sweepAll('TRON', '100000', MAIN_WALLET);
    expect(result.swept).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.totalAmount).toBe('500000');
    expect(broadcaster.broadcasts).toHaveLength(1);
    expect(broadcaster.broadcasts[0]?.toAddress).toBe(MAIN_WALLET);
  });

  it('S4SW04: broadcast failure is reported without posting', async () => {
    await seedUserWithDeposit('500000');
    broadcaster.setShouldFail(true);
    const result = await sweepService.sweepAll('TRON', '100000', MAIN_WALLET);
    expect(result.swept).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.outcomes[0]?.broadcast).toBeNull();
    expect(result.outcomes[0]?.error).toBe('BROADCAST_FAILED');
  });

  it('S4SW05: multiple addresses are swept in batch', async () => {
    await seedUserWithDeposit('200000');
    await seedUserWithDeposit('300000');
    const result = await sweepService.sweepAll('TRON', '100000', MAIN_WALLET);
    expect(result.swept).toBe(2);
    expect(result.totalAmount).toBe('500000');
    expect(broadcaster.broadcasts).toHaveLength(2);
  });
});
