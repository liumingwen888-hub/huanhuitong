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
  PostgresTransferOrderRepository,
  PostgresClaimLinkRepository,
  PostgresRedPacketRepository
} from '../../src/modules/transfers/infrastructure/postgres-transfer.repository.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const orders = new PostgresTransferOrderRepository();
const links = new PostgresClaimLinkRepository();
const packets = new PostgresRedPacketRepository();

async function createLedgerTx(): Promise<string> {
  return cleanupPool.query<{ id: string }>(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT') RETURNING transaction_id::text AS id`,
    [randomUUID(), `test-${randomUUID()}`]
  ).then((r) => r.rows[0]!.id);
}

async function seedUsers(): Promise<{ sender: Uid; recipient: Uid }> {
  const pair = await unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ a: string; b: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE'), ('ACTIVE')
       RETURNING
         (SELECT uid FROM users ORDER BY created_at DESC LIMIT 2)`,
      []
    );
    const rows = await context.executeSql<{ uid: string }>(
      `SELECT uid FROM users ORDER BY created_at DESC LIMIT 2`,
      []
    );
    return {
      a: rows.rows[0]!.uid as Uid,
      b: rows.rows[1]!.uid as Uid
    };
  });
  return { sender: pair.a, recipient: pair.b };
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot, startupTimeoutMillis: 120_000, stopTimeoutMillis: 10_000
  });
  const evidence = await migrateAndValidate(fixture, {
    projectRoot, configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  expect(evidence.firstMigrate.appliedVersions).toEqual([
    '1', '2', '3', '4', '5', '6', '7'
  ]);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s51-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s51-platform'
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
    'red_packet_claims', 'red_packets', 'claim_links',
    'transfer_orders', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S5-1 transfer contracts and V7 schema', () => {
  it('S5TC01: transfer order is created with idempotent order_ref', async () => {
    const { sender, recipient } = await seedUsers();
    const input = {
      orderRef: 'XFER-001',
      senderUid: sender,
      recipientUid: recipient,
      assetCode: 'USDT-TRC20',
      amount: '500000',
      feeAmount: '0'
    };
    const first = await unitOfWork.execute((c) => orders.createOrder(c, input));
    expect(first.status).toBe('PENDING');
    const second = await unitOfWork.execute((c) => orders.createOrder(c, input));
    expect(second.transferId).toBe(first.transferId);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transfer_orders`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S5TC02: same sender and recipient is rejected', async () => {
    const { sender } = await seedUsers();
    await expect(
      unitOfWork.execute((c) =>
        orders.createOrder(c, {
          orderRef: 'XFER-SELF',
          senderUid: sender,
          recipientUid: sender,
          assetCode: 'USDT-TRC20',
          amount: '100',
          feeAmount: '0'
        })
      )
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S5TC03: claim link is one-time via code uniqueness', async () => {
    const { sender, recipient } = await seedUsers();
    const link = await unitOfWork.execute((c) =>
      links.createLink(c, {
        claimCode: 'claim-abc-123',
        creatorUid: sender,
        amount: '100000',
        assetCode: 'USDT-TRC20',
        expiresAt: new Date(Date.now() + 86400_000)
      })
    );
    expect(link.status).toBe('ACTIVE');
    const found = await unitOfWork.execute((c) =>
      links.findByCode(c, 'claim-abc-123')
    );
    expect(found?.linkId).toBe(link.linkId);
    const tx1 = await createLedgerTx();
    const claimed = await unitOfWork.execute((c) =>
      links.markClaimed(c, {
        linkId: link.linkId,
        claimerUid: recipient,
        ledgerTransactionId: tx1
      })
    );
    expect(claimed).toBe(true);
    const tx2 = await createLedgerTx();
    const reClaim = await unitOfWork.execute((c) =>
      links.markClaimed(c, {
        linkId: link.linkId,
        claimerUid: sender,
        ledgerTransactionId: tx2
      })
    );
    expect(reClaim).toBe(false);
  });

  it('S5TC04: claim link expiry is enforced', async () => {
    const { sender } = await seedUsers();
    const link = await unitOfWork.execute((c) =>
      links.createLink(c, {
        claimCode: 'claim-exp-1',
        creatorUid: sender,
        amount: '50000',
        assetCode: 'USDT-TRC20',
        expiresAt: new Date(Date.now() - 1000)
      })
    );
    const expired = await unitOfWork.execute((c) =>
      links.markClaimed(c, {
        linkId: link.linkId,
        claimerUid: sender,
        ledgerTransactionId: randomUUID()
      })
    );
    expect(expired).toBe(false);
    const marked = await unitOfWork.execute((c) =>
      links.markExpired(c, link.linkId)
    );
    expect(marked).toBe(true);
  });

  it('S5TC05-06: red packet claims enforce same-user uniqueness', async () => {
    const { sender, recipient } = await seedUsers();
    const packet = await unitOfWork.execute((c) =>
      packets.createPacket(c, {
        creatorUid: sender,
        totalAmount: '1000000',
        packetCount: 5,
        assetCode: 'USDT-TRC20',
        expiresAt: new Date(Date.now() + 86400_000)
      })
    );
    expect(packet.status).toBe('ACTIVE');
    const tx1 = await createLedgerTx();
    const claim1 = await unitOfWork.execute((c) =>
      packets.claimPacket(c, {
        packetId: packet.packetId,
        claimerUid: recipient,
        amount: '200000',
        ledgerTransactionId: tx1
      })
    );
    expect(claim1.claimed).toBe(true);
    const tx2 = await createLedgerTx();
    const claim2 = await unitOfWork.execute((c) =>
      packets.claimPacket(c, {
        packetId: packet.packetId,
        claimerUid: recipient,
        amount: '200000',
        ledgerTransactionId: tx2
      })
    );
    expect(claim2.claimed).toBe(false);
    const claims = await unitOfWork.execute((c) =>
      packets.findClaims(c, packet.packetId)
    );
    expect(claims).toHaveLength(1);
  });

  it('S5TC07: worker role has read-only access to V7 tables', async () => {
    const workerClient = await new Pool({
      connectionString: fixture.workerLogin.connectionString, max: 1
    }).connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      const readable = await workerClient.query(
        `SELECT count(*)::int AS n FROM transfer_orders`
      );
      expect(readable.rows[0]?.n).toBe(0);
      await expect(
        workerClient.query(
          `INSERT INTO transfer_orders (order_ref, sender_uid, recipient_uid, asset_code, amount)
           VALUES ('hack', $1::uuid, $1::uuid, 'BTC', 1)`,
          [randomUUID()]
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
  });
});
