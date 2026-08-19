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
  PostgresRedPacketRepository
} from '../../src/modules/transfers/infrastructure/postgres-transfer.repository.js';
import { RedPacketService } from '../../src/modules/transfers/application/red-packet.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const packets = new PostgresRedPacketRepository();
let redPacketService: RedPacketService;

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

async function packetStatus(packetId: string): Promise<string> {
  const rows = await cleanupPool.query<{ status: string }>(
    `SELECT status FROM red_packets WHERE packet_id=$1::uuid`,
    [packetId]
  );
  return rows.rows[0]?.status ?? 'MISSING';
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
    max: 1, application_name: 'xht-s54-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s54-platform'
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
    'outbox_messages', 'red_packet_claims', 'red_packets',
    'account_balances', 'ledger_entries', 'ledger_transactions',
    'account_openings', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  const poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  redPacketService = new RedPacketService(
    unitOfWork, packets, ledgerAccounts, poster,
    new PostgresOutboxRepository()
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S5-4 red packet service', () => {
  it('S5RP01: creating a packet freezes the total from creator', async () => {
    const creator = await seedUser();
    await seedCustodyAndFund(creator, '1000000');
    const packet = await redPacketService.createPacket({
      creatorUid: creator,
      assetCode: 'USDT-TRC20',
      totalAmount: '600000',
      packetCount: 3
    });
    expect(packet.status).toBe('ACTIVE');
    expect(await userBalance(creator)).toBe('-400000');
  });

  it('S5RP02: multiple users can claim and each gets the correct amount', async () => {
    const creator = await seedUser();
    const claimerA = await seedUser();
    const claimerB = await seedUser();
    await seedCustodyAndFund(creator, '1000000');
    const packet = await redPacketService.createPacket({
      creatorUid: creator,
      assetCode: 'USDT-TRC20',
      totalAmount: '600000',
      packetCount: 3
    });
    const r1 = await redPacketService.claimPacket(packet.packetId, claimerA);
    expect(r1.kind).toBe('claimed');
    const r2 = await redPacketService.claimPacket(packet.packetId, claimerB);
    expect(r2.kind).toBe('claimed');
    expect(await userBalance(claimerA)).toBe('-200000');
    expect(await userBalance(claimerB)).toBe('-200000');
  });

  it('S5RP03: same user double claim is rejected', async () => {
    const creator = await seedUser();
    const claimer = await seedUser();
    await seedCustodyAndFund(creator, '1000000');
    const packet = await redPacketService.createPacket({
      creatorUid: creator,
      assetCode: 'USDT-TRC20',
      totalAmount: '300000',
      packetCount: 3
    });
    await redPacketService.claimPacket(packet.packetId, claimer);
    const second = await redPacketService.claimPacket(packet.packetId, claimer);
    expect(second.kind).toBe('already_claimed');
    expect(await userBalance(claimer)).toBe('-100000');
  });

  it('S5RP04: packet depletes when all portions are claimed', async () => {
    const creator = await seedUser();
    const users = [await seedUser(), await seedUser(), await seedUser()];
    await seedCustodyAndFund(creator, '1000000');
    const packet = await redPacketService.createPacket({
      creatorUid: creator,
      assetCode: 'USDT-TRC20',
      totalAmount: '300000',
      packetCount: 3
    });
    for (const uid of users) {
      const r = await redPacketService.claimPacket(packet.packetId, uid);
      expect(r.kind).toBe('claimed');
    }
    expect(await packetStatus(packet.packetId)).toBe('DEPLETED');
    const extra = await seedUser();
    const afterDepleted = await redPacketService.claimPacket(
      packet.packetId, extra
    );
    expect(afterDepleted.kind).toBe('depleted');
  });

  it('S5RP05: expired packet refunds only the remaining amount', async () => {
    const creator = await seedUser();
    const claimer = await seedUser();
    await seedCustodyAndFund(creator, '1000000');
    const packet = await redPacketService.createPacket({
      creatorUid: creator,
      assetCode: 'USDT-TRC20',
      totalAmount: '300000',
      packetCount: 3
    });
    // One user claims 1/3
    await redPacketService.claimPacket(packet.packetId, claimer);
    expect(await userBalance(claimer)).toBe('-100000');
    expect(await userBalance(creator)).toBe('-700000');
    // Manually expire
    await cleanupPool.query(
      `UPDATE red_packets SET expires_at = clock_timestamp() - interval '1 second'
        WHERE packet_id = $1::uuid`,
      [packet.packetId]
    );
    // Try to claim - should trigger refund of remaining 2/3
    const anotherUser = await seedUser();
    const result = await redPacketService.claimPacket(
      packet.packetId, anotherUser
    );
    expect(result.kind).toBe('expired');
    // Creator gets back the remaining 200000 (2/3 of 300000)
    // Creator was at -700000 after freeze (has 700000 remaining)
    // After refund of 200000: has 900000 → signed = -900000
    // Creator effectively spent only 100000 (the claimed portion)
    expect(await userBalance(creator)).toBe('-900000');
    expect(await userBalance(anotherUser)).toBe('0');
    expect(await packetStatus(packet.packetId)).toBe('EXPIRED');
  });
});
