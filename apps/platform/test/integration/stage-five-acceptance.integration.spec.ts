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
import {
  PostgresTransferOrderRepository,
  PostgresClaimLinkRepository,
  PostgresRedPacketRepository
} from '../../src/modules/transfers/infrastructure/postgres-transfer.repository.js';
import { TransferExecutionService } from '../../src/modules/transfers/application/transfer-execution.service.js';
import { ClaimLinkService } from '../../src/modules/transfers/application/claim-link.service.js';
import { RedPacketService } from '../../src/modules/transfers/application/red-packet.service.js';
import { classifyTransferUpdate } from '../../src/modules/telegram/application/transfer-commands.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
let unitOfWorkB: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const orders = new PostgresTransferOrderRepository();
const links = new PostgresClaimLinkRepository();
const packets = new PostgresRedPacketRepository();
let transferService: TransferExecutionService;
let transferServiceB: TransferExecutionService;
let claimService: ClaimLinkService;
let redPacketService: RedPacketService;

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const c = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`, []
    );
    return c.rows[0]!.uid as Uid;
  });
}

async function seedAndFund(uid: Uid, amount: string): Promise<void> {
  const custody = await cleanupPool.query<{ a: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY') RETURNING account_id AS a`
  );
  const clearing = await cleanupPool.query<{ a: string }>(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'CLEARING_DIFF') RETURNING account_id AS a`
  );
  const tx = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`, [tx, `b-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     VALUES ($1, $2, 'DEBIT', 10000000, 0), ($1, $3, 'CREDIT', 10000000, 1)`,
    [tx, custody.rows[0]!.a, clearing.rows[0]!.a]
  );
  const poster = new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions);
  const acct = await unitOfWork.execute((c) =>
    ledgerAccounts.openUserAccount(c, {
      ownerUid: uid, assetCode: 'USDT-TRC20', purpose: 'USER_AVAILABLE',
      idempotencyKey: `o-${randomUUID()}`
    })
  );
  await poster.post({
    idempotencyKey: `f-${randomUUID()}`, transactionType: 'DEPOSIT',
    occurredAt: new Date().toISOString(),
    lines: [
      { accountId: custody.rows[0]!.a, direction: 'DEBIT', amount },
      { accountId: acct.accountId, direction: 'CREDIT', amount }
    ]
  });
}

async function bal(uid: string): Promise<string> {
  const r = await cleanupPool.query<{ b: string }>(
    `SELECT COALESCE(SUM(CASE e.direction WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)::text AS b
       FROM ledger_entries e JOIN ledger_accounts a ON a.account_id=e.account_id
      WHERE a.owner_uid=$1::uuid AND a.purpose='USER_AVAILABLE'`, [uid]
  );
  return r.rows[0]?.b ?? '0';
}

async function notifCount(): Promise<number> {
  const r = await cleanupPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outbox_messages WHERE topic LIKE 'telegram.%'`
  );
  return r.rows[0]?.n ?? 0;
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
    max: 1, application_name: 'xht-s5a-cl'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 6, application_name: 'xht-s5a-pf'
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
  for (const t of [
    'outbox_messages', 'red_packet_claims', 'red_packets', 'claim_links',
    'transfer_orders', 'account_balances', 'ledger_entries',
    'ledger_transactions', 'account_openings', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${t}`);
  }
  const p = new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions);
  transferService = new TransferExecutionService(
    unitOfWork, orders, ledgerAccounts, p, new PostgresOutboxRepository()
  );
  const pB = new PostMoneyService(unitOfWorkB, ledgerAccounts, ledgerTransactions);
  transferServiceB = new TransferExecutionService(
    unitOfWorkB, orders, ledgerAccounts, pB, new PostgresOutboxRepository()
  );
  claimService = new ClaimLinkService(
    unitOfWork, links, ledgerAccounts, p, new PostgresOutboxRepository()
  );
  redPacketService = new RedPacketService(
    unitOfWork, packets, ledgerAccounts, p, new PostgresOutboxRepository()
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('stage five acceptance (S5A01–S5A12)', () => {
  it('S5A01: normal transfer executes with balance change and notifications', async () => {
    const s = await seedUser(); const r = await seedUser();
    await seedAndFund(s, '1000000');
    const res = await transferService.execute({
      orderRef: 'S5A-01', senderUid: s, recipientUid: r,
      assetCode: 'USDT-TRC20', amount: '300000'
    });
    expect(res.kind).toBe('executed');
    expect(await bal(s)).toBe('-700000');
    expect(await bal(r)).toBe('-300000');
    expect(await notifCount()).toBeGreaterThanOrEqual(2);
  });

  it('S5A02: idempotent replay returns existing without new rows', async () => {
    const s = await seedUser(); const r = await seedUser();
    await seedAndFund(s, '500000');
    const cmd = { orderRef: 'S5A-02', senderUid: s, recipientUid: r,
      assetCode: 'USDT-TRC20', amount: '100000' };
    await transferService.execute(cmd);
    const second = await transferService.execute(cmd);
    expect(second.kind).toBe('already_executed');
    expect(await bal(s)).toBe('-400000');
  });

  it('S5A03: insufficient balance fails without change', async () => {
    const s = await seedUser(); const r = await seedUser();
    await seedAndFund(s, '100000');
    const res = await transferService.execute({
      orderRef: 'S5A-03', senderUid: s, recipientUid: r,
      assetCode: 'USDT-TRC20', amount: '200000'
    });
    expect(res.kind).toBe('failed');
    expect(await bal(s)).toBe('-100000');
  });

  it('S5A04: concurrent double-spend allows exactly one winner', async () => {
    const s = await seedUser(); const r = await seedUser();
    await seedAndFund(s, '500000');
    const results = await Promise.allSettled([
      transferService.execute({ orderRef: 'S5A-04A', senderUid: s, recipientUid: r,
        assetCode: 'USDT-TRC20', amount: '400000' }),
      transferServiceB.execute({ orderRef: 'S5A-04B', senderUid: s, recipientUid: r,
        assetCode: 'USDT-TRC20', amount: '400000' })
    ]);
    const executed = results.filter(x => x.status === 'fulfilled' && x.value.kind === 'executed').length;
    expect(executed).toBe(1);
    expect(await bal(s)).toBe('-100000');
  });

  it('S5A05: claim link create freezes and claim releases', async () => {
    const c = await seedUser(); const cl = await seedUser();
    await seedAndFund(c, '500000');
    const link = await claimService.createLink({
      creatorUid: c, assetCode: 'USDT-TRC20', amount: '200000'
    });
    expect(await bal(c)).toBe('-300000');
    const res = await claimService.claim(link.claimCode, cl);
    expect(res.kind).toBe('claimed');
    expect(await bal(cl)).toBe('-200000');
  });

  it('S5A06: double claim is rejected', async () => {
    const c = await seedUser(); const cl = await seedUser();
    await seedAndFund(c, '100000');
    const link = await claimService.createLink({
      creatorUid: c, assetCode: 'USDT-TRC20', amount: '50000'
    });
    await claimService.claim(link.claimCode, cl);
    const second = await claimService.claim(link.claimCode, cl);
    expect(second.kind).toBe('already_claimed');
  });

  it('S5A07: expired link refunds to creator', async () => {
    const c = await seedUser(); const cl = await seedUser();
    await seedAndFund(c, '100000');
    const link = await claimService.createLink({
      creatorUid: c, assetCode: 'USDT-TRC20', amount: '50000'
    });
    await cleanupPool.query(
      `UPDATE claim_links SET expires_at = clock_timestamp() - interval '1 sec'
        WHERE link_id=$1::uuid`, [link.linkId]
    );
    const res = await claimService.claim(link.claimCode, cl);
    expect(res.kind).toBe('expired');
    expect(await bal(c)).toBe('-100000');
  });

  it('S5A08: red packet multi-user claim works', async () => {
    const c = await seedUser();
    const u1 = await seedUser(); const u2 = await seedUser();
    await seedAndFund(c, '1000000');
    const pkt = await redPacketService.createPacket({
      creatorUid: c, assetCode: 'USDT-TRC20', totalAmount: '600000', packetCount: 3
    });
    await redPacketService.claimPacket(pkt.packetId, u1);
    await redPacketService.claimPacket(pkt.packetId, u2);
    expect(await bal(u1)).toBe('-200000');
    expect(await bal(u2)).toBe('-200000');
  });

  it('S5A09: same user double packet claim is rejected', async () => {
    const c = await seedUser(); const u = await seedUser();
    await seedAndFund(c, '300000');
    const pkt = await redPacketService.createPacket({
      creatorUid: c, assetCode: 'USDT-TRC20', totalAmount: '300000', packetCount: 3
    });
    await redPacketService.claimPacket(pkt.packetId, u);
    const second = await redPacketService.claimPacket(pkt.packetId, u);
    expect(second.kind).toBe('already_claimed');
  });

  it('S5A10: expired packet refunds remaining only', async () => {
    const c = await seedUser(); const u = await seedUser();
    await seedAndFund(c, '1000000');
    const pkt = await redPacketService.createPacket({
      creatorUid: c, assetCode: 'USDT-TRC20', totalAmount: '300000', packetCount: 3
    });
    await redPacketService.claimPacket(pkt.packetId, u);
    await cleanupPool.query(
      `UPDATE red_packets SET expires_at = clock_timestamp() - interval '1 sec'
        WHERE packet_id=$1::uuid`, [pkt.packetId]
    );
    const other = await seedUser();
    const res = await redPacketService.claimPacket(pkt.packetId, other);
    expect(res.kind).toBe('expired');
  });

  it('S5A11: transfer commands classify correctly with zero interpolation', async () => {
    const msg = (t: string) => ({
      update_id: 1,
      message: {
        from: { id: 8501, is_bot: false, first_name: 'T' },
        chat: { id: 8501, type: 'private' }, date: 1, text: t
      }
    });
    expect(classifyTransferUpdate(msg('/balance'))?.command).toEqual({ kind: 'balance' });
    expect(classifyTransferUpdate(msg('/transfer 8502 100'))?.command).toMatchObject({ kind: 'transfer' });
    expect(classifyTransferUpdate(msg('/claim clm-abc123'))?.command).toMatchObject({ kind: 'claim' });
    expect(classifyTransferUpdate(msg('/redpacket 600 3'))?.command).toMatchObject({ kind: 'red-packet' });
    expect(classifyTransferUpdate(msg('random'))).toBeNull();
    const repliesSrc = await readFile(
      resolve(projectRoot, 'apps/platform/src/modules/telegram/application/transfer-replies.ts'),
      'utf8'
    );
    expect(repliesSrc.includes('${')).toBe(false);
    expect(repliesSrc.includes('`')).toBe(false);
  });

  it('S5A12: transfers modules stay channel-agnostic', async () => {
    const files = [
      'apps/platform/src/modules/transfers/domain/transfer.errors.ts',
      'apps/platform/src/modules/transfers/application/transfer-execution.service.ts',
      'apps/platform/src/modules/transfers/application/claim-link.service.ts',
      'apps/platform/src/modules/transfers/application/red-packet.service.ts'
    ];
    for (const file of files) {
      const src = await readFile(resolve(projectRoot, file), 'utf8');
      expect(src.match(/grammy|telegram\\.api/u) ?? []).toEqual([]);
    }
  });
});
