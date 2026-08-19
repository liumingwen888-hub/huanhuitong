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
import { PostgresOutboxRepository } from '../../src/modules/reliability/outbox/outbox.repository.js';
import { PostgresDepositAddressRepository } from '../../src/modules/deposits/infrastructure/postgres-deposit.repository.js';
import { DepositAddressService } from '../../src/modules/deposits/application/deposit-address.service.js';
import { DepositDetectionWorker } from '../../src/modules/deposits/application/deposit-detection.worker.js';
import { DepositConfirmationService } from '../../src/modules/deposits/application/deposit-confirmation.service.js';
import { DepositPostingService } from '../../src/modules/deposits/application/deposit-posting.service.js';
import { DepositSweepService } from '../../src/modules/deposits/application/deposit-sweep.service.js';
import { ChainReconciliationService } from '../../src/modules/deposits/application/chain-reconciliation.service.js';
import { FakeDerivationSource } from '../../src/modules/deposits/domain/fake-derivation.source.js';
import { FakeChainScanner } from '../../src/modules/deposits/domain/fake-chain-scanner.js';
import { FakeBroadcaster } from '../../src/modules/deposits/domain/fake-broadcaster.js';
import { PostgresDepositDetectionRepository } from '../../src/modules/deposits/infrastructure/postgres-deposit.repository.js';

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
let detectionWorker: DepositDetectionWorker;
let confirmationService: DepositConfirmationService;
let postingService: DepositPostingService;
let sweepService: DepositSweepService;
let reconciliationService: ChainReconciliationService;
let scanner: FakeChainScanner;
let broadcaster: FakeBroadcaster;
async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return created.rows[0]!.uid as Uid;
  });
}

async function seedCustody(asset = 'USDT-TRC20', amount = '10000000'): Promise<void> {
  const custody = await cleanupPool.query<{ account_id: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, $1, 'PLATFORM_CUSTODY') RETURNING account_id`, [asset]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, $1, 'CLEARING_DIFF')`, [asset]
  );
  const clearing = await cleanupPool.query<{ account_id: string }>(
    `SELECT account_id FROM ledger_accounts
      WHERE owner_uid IS NULL AND asset_code = $1 AND purpose = 'CLEARING_DIFF'`, [asset]
  );
  const tx = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`, [tx, `boot-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     VALUES ($1::uuid, $2::uuid, 'DEBIT', $3::bigint, 0),
            ($1::uuid, $4::uuid, 'CREDIT', $3::bigint, 1)`,
    [tx, custody.rows[0]!.account_id, amount, clearing.rows[0]!.account_id]
  );
}

async function fullDepositPipeline(
  uid: Uid,
  txid: string,
  amount: string
): Promise<void> {
  const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
  scanner.setLatestBlock('TRON', '100');
  scanner.inject('TRON', {
    networkTxid: txid, toAddress: addr.addressText,
    amount, blockNumber: '50', blockTimestamp: new Date(),
    confirmations: 19
  });
  await detectionWorker.runOnce('TRON');
  await confirmationService.processConfirmations('TRON');
  await postingService.postConfirmedDeposits('TRON');
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
    max: 1, application_name: 'xht-s4a-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s4a-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never, fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
  addressService = new DepositAddressService(unitOfWork, depositAddresses, derivation);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'outbox_messages', 'risk_decisions', 'deposit_detections',
    'address_assignments', 'deposit_addresses', 'chain_scan_checkpoints',
    'account_balances', 'ledger_entries', 'ledger_transactions',
    'account_openings', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  scanner = new FakeChainScanner();
  broadcaster = new FakeBroadcaster();
  const detections = new PostgresDepositDetectionRepository();
  const p = new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions);
  detectionWorker = new DepositDetectionWorker(
    unitOfWork, depositAddresses, detections, scanner
  );
  confirmationService = new DepositConfirmationService(unitOfWork, detections);
  postingService = new DepositPostingService(
    unitOfWork, ledgerAccounts, p, new PostgresOutboxRepository()
  );
  sweepService = new DepositSweepService(unitOfWork, ledgerAccounts, p, broadcaster);
  reconciliationService = new ChainReconciliationService(unitOfWork, scanner);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('stage four acceptance (S4A01–S4A14)', () => {
  it('S4A01-03: address generation is deterministic, unique, and rotates on retire', async () => {
    const uidA = await seedUser();
    const uidB = await seedUser();
    const a1 = await addressService.getOrCreateAddress(uidA, 'USDT-TRC20');
    const a1Again = await addressService.getOrCreateAddress(uidA, 'USDT-TRC20');
    expect(a1Again.addressId).toBe(a1.addressId);
    const b1 = await addressService.getOrCreateAddress(uidB, 'USDT-TRC20');
    expect(b1.addressText).not.toBe(a1.addressText);
    expect(b1.derivationIndex).toBe(a1.derivationIndex + 1);
    await addressService.retireAddress(a1.addressId);
    const a2 = await addressService.getOrCreateAddress(uidA, 'USDT-TRC20');
    expect(a2.derivationIndex).toBeGreaterThan(a1.derivationIndex);
    await expect(
      addressService.getOrCreateAddress(uidA, 'USD-FIAT')
    ).rejects.toMatchObject({ code: 'DEPOSIT_NETWORK_UNSUPPORTED' });
  });

  it('S4A04-05: detection records are created and retired addresses are skipped', async () => {
    const uid = await seedUser();
    const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
    scanner.setLatestBlock('TRON', '100');
    scanner.inject('TRON', {
      networkTxid: 's4a-det-01', toAddress: addr.addressText,
      amount: '100000', blockNumber: '50', blockTimestamp: new Date(),
      confirmations: 5
    });
    const result = await detectionWorker.runOnce('TRON');
    expect(result.detectionsUpserted).toBe(1);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM deposit_detections`
    );
    expect(count.rows[0]?.n).toBe(1);
    await addressService.retireAddress(addr.addressId);
    scanner.setLatestBlock('TRON', '200');
    const skipped = await detectionWorker.runOnce('TRON');
    expect(skipped.addressesScanned).toBe(0);
  });

  it('S4A06-08: confirmation CAS, reorg blocking, and idempotent confirmations', async () => {
    const uid = await seedUser();
    const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
    await unitOfWork.execute(async (context) => {
      await context.executeSql(
        `INSERT INTO deposit_detections
           (address_id, network, network_txid, network_timestamp,
            amount, confirmations, status)
         VALUES ($1::uuid, 'TRON', $2, clock_timestamp(), 50000, 19, 'DETECTED')`,
        [addr.addressId, 's4a-conf-01']
      );
    });
    const confirmed = await confirmationService.processConfirmations('TRON');
    expect(confirmed.confirmed).toBe(1);
    const reConfirm = await confirmationService.processConfirmations('TRON');
    expect(reConfirm.confirmed).toBe(0);
    const reorg = await confirmationService.processReorg('TRON', ['s4a-conf-01']);
    expect(reorg.blocked).toBe(1);
    const status = await cleanupPool.query<{ status: string }>(
      `SELECT status FROM deposit_detections WHERE network_txid = 's4a-conf-01'`
    );
    expect(status.rows[0]?.status).toBe('REORG_DETECTED');
  });

  it('S4A09-11: full deposit pipeline posts to ledger with notification and auto-open', async () => {
    await seedCustody();
    const uid = await seedUser();
    await fullDepositPipeline(uid, 's4a-full-01', '500000');
    const detection = await cleanupPool.query<{
      status: string; ledger_tx: string | null;
    }>(
      `SELECT status, ledger_transaction_id::text AS ledger_tx
         FROM deposit_detections WHERE network_txid = 's4a-full-01'`
    );
    expect(detection.rows[0]?.status).toBe('POSTED');
    expect(detection.rows[0]?.ledger_tx).not.toBeNull();
    const userBal = await cleanupPool.query<{ bal: string }>(
      `SELECT COALESCE(SUM(CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END), 0)::text AS bal
         FROM ledger_entries e JOIN ledger_accounts a ON a.account_id = e.account_id
        WHERE a.owner_uid = $1::uuid AND a.purpose = 'USER_AVAILABLE'`,
      [uid]
    );
    expect(userBal.rows[0]?.bal).toBe('-500000');
    const notifications = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.deposit-confirmed.v1'`
    );
    expect(notifications.rows[0]?.n).toBe(1);
    const accounts = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_accounts
        WHERE owner_uid = $1::uuid AND purpose = 'USER_AVAILABLE'`,
      [uid]
    );
    expect(accounts.rows[0]?.n).toBe(1);
  });

  it('S4A12: sweep broadcasts and posts ledger entries', async () => {
    await seedCustody();
    const uid = await seedUser();
    await fullDepositPipeline(uid, 's4a-sweep-01', '500000');
    const result = await sweepService.sweepAll('TRON', '100000', 'TMainWallet');
    expect(result.swept).toBe(1);
    expect(broadcaster.broadcasts).toHaveLength(1);
  });

  it('S4A13: chain reconciliation detects discrepancies', async () => {
    const uid = await seedUser();
    const addr = await addressService.getOrCreateAddress(uid, 'USDT-TRC20');
    await unitOfWork.execute(async (context) => {
      await context.executeSql(
        `INSERT INTO deposit_detections
           (address_id, network, network_txid, network_timestamp,
            amount, confirmations, status)
         VALUES ($1::uuid, 'TRON', $2, clock_timestamp(), 100000, 19, 'POSTED')`,
        [addr.addressId, 's4a-recon-01']
      );
    });
    scanner.setAddressBalance('TRON', addr.addressText, '150000');
    const report = await reconciliationService.reconcileAll('TRON');
    expect(report.discrepancyCount).toBe(1);
    expect(report.discrepancies[0]?.difference).toBe('50000');
    const alerts = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM risk_decisions
        WHERE reason_code = 'CHAIN_RECONCILIATION_DISCREPANCY'`
    );
    expect(alerts.rows[0]?.n).toBe(1);
  });

  it('S4A14: deposits modules stay channel-agnostic', async () => {
    const files = [
      'apps/platform/src/modules/deposits/domain/fake-derivation.source.ts',
      'apps/platform/src/modules/deposits/application/deposit-posting.service.ts',
      'apps/platform/src/modules/deposits/application/chain-reconciliation.service.ts',
      'apps/platform/src/modules/deposits/application/deposit-sweep.service.ts'
    ];
    for (const file of files) {
      const source = await readFile(resolve(projectRoot, file), 'utf8');
      expect(source.match(/grammy|telegram\.api/u) ?? []).toEqual([]);
    }
  });
});
