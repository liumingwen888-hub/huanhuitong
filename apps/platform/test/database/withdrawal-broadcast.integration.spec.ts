import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  AuthorizePaymentProofV1,
  StageOneDatabase,
  Uid,
  WithdrawalCommand
} from '@xht/contracts';
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
import { RiskGate } from '../../src/modules/crosscutting/application/crosscutting.services.js';
import { FakeSigner } from '../../src/modules/signer/domain/fake-signer.js';
import {
  DeterministicBroadcasterFake
} from '../../src/modules/withdrawals/infrastructure/deterministic-broadcaster.fake.js';
import {
  PostgresSignerPolicyRepository,
  PostgresWithdrawalApprovalRepository,
  PostgresWithdrawalOrderRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';
import { WithdrawalRequestService } from '../../src/modules/withdrawals/application/withdrawal-request.service.js';
import { WithdrawalApprovalService } from '../../src/modules/withdrawals/application/withdrawal-approval.service.js';
import { WithdrawalSigningService } from '../../src/modules/withdrawals/application/withdrawal-signing.service.js';
import {
  WithdrawalBroadcastService
} from '../../src/modules/withdrawals/application/withdrawal-broadcast.service.js';
import {
  AdminAuthorizer,
  ConfigStore
} from '../../src/modules/crosscutting/application/crosscutting.services.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const orders = new PostgresWithdrawalOrderRepository();
const approvals = new PostgresWithdrawalApprovalRepository();
const policies = new PostgresSignerPolicyRepository();
const outbox = new PostgresOutboxRepository();
let fakeSigner: FakeSigner;
let broadcaster: DeterministicBroadcasterFake;
let broadcastService: WithdrawalBroadcastService;
let requestService: WithdrawalRequestService;
let approvalService: WithdrawalApprovalService;

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
}

async function fundUser(uid: Uid, amount: string): Promise<void> {
  const poster = new PostMoneyService(
    unitOfWork, ledgerAccounts, ledgerTransactions
  );
  const account = await unitOfWork.execute((context) =>
    ledgerAccounts.openUserAccount(context, {
      ownerUid: uid,
      assetCode: 'USDT-TRC20',
      purpose: 'USER_AVAILABLE',
      idempotencyKey: `open:${uid}:USDT-TRC20:USER_AVAILABLE`
    })
  );
  const custody = await unitOfWork.execute(async (context) => {
    const rows = await context.executeSql<{ account_id: string }>(
      `SELECT account_id FROM ledger_accounts
        WHERE owner_uid IS NULL AND asset_code = 'USDT-TRC20'
          AND purpose = 'PLATFORM_CUSTODY' LIMIT 1`
    );
    return rows.rows[0]!.account_id;
  });
  await poster.post({
    idempotencyKey: `fund-${randomUUID()}`,
    transactionType: 'DEPOSIT',
    occurredAt: new Date().toISOString(),
    lines: [
      { accountId: custody, direction: 'DEBIT', amount },
      { accountId: account.accountId, direction: 'CREDIT', amount }
    ]
  });
}

async function createApprovedOrder(amount: string): Promise<string> {
  const uid = await seedUser();
  await fundUser(uid, '100000000');
  const command: WithdrawalCommand = {
    orderRef: `WD-${randomUUID().slice(0, 8)}`,
    uid,
    assetCode: 'USDT-TRC20',
    amount,
    destinationAddress: 'TDestinationTestAddress'
  };
  const result = await requestService.request(
    command,
    Object.freeze({
      type: 'security.payment-authorized.v1',
      uid: command.uid,
      operationType: 'withdrawal',
      orderRef: command.orderRef,
      amountSummary: command.amount,
      assetSummary: command.assetCode,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      sessionId: randomUUID()
    }) as AuthorizePaymentProofV1
  );
  expect(result.outcome).toBe('ACCEPTED');
  const withdrawalId = (result as { order: { withdrawalId: string } }).order
    .withdrawalId;
  await unitOfWork.execute((c) => orders.markApproved(c, withdrawalId));
  return withdrawalId;
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
  expect(evidence.firstMigrate.appliedVersions).toEqual(
    expect.arrayContaining(['1', '2', '3', '4', '5', '6', '7', '8'])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s65-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s65-platform'
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
    'outbox_messages', 'withdrawal_approvals', 'withdrawal_orders',
    'signer_policies', 'admin_role_grants', 'admin_principals',
    'config_versions', 'risk_decisions', 'operation_limits',
    'account_balances', 'ledger_entries', 'account_openings',
    'ledger_transactions', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY')`
  );
  await unitOfWork.execute((c) =>
    policies.insert(c, {
      policyVersion: 1,
      network: 'TRON',
      hotWalletAddress: 'THotWalletTest',
      feeAmount: '1000',
      minAutoAmount: '1000000',
      maxAmount: '50000000'
    })
  );
  fakeSigner = new FakeSigner();
  broadcaster = new DeterministicBroadcasterFake();
  requestService = new WithdrawalRequestService(
    unitOfWork, orders, policies, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  approvalService = new WithdrawalApprovalService(
    unitOfWork, orders, approvals,
    new AdminAuthorizer(unitOfWork), new ConfigStore(unitOfWork), outbox
  );
  broadcastService = new WithdrawalBroadcastService(
    unitOfWork, orders, policies,
    new WithdrawalSigningService(unitOfWork, orders, policies, fakeSigner),
    broadcaster, outbox
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S6-5 withdrawal broadcast and confirmation', () => {
  it('S6WR01: APPROVED order broadcasts into BROADCAST with txid', async () => {
    const withdrawalId = await createApprovedOrder('2000000');
    const result = await broadcastService.broadcast(withdrawalId);
    expect(result.outcome).toBe('BROADCAST');
    const broadcast = result as {
      broadcastTxid: string;
      order: { status: string; broadcastTxid: string | null };
    };
    expect(broadcast.order.status).toBe('BROADCAST');
    expect(broadcast.order.broadcastTxid).toBe(broadcast.broadcastTxid);
    expect(broadcast.broadcastTxid).toMatch(/^wd-/u);
    const notified = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.withdrawal-broadcast.v1'`
    );
    expect(notified.rows[0]?.n).toBe(1);
  });

  it('S6WR02: crash-window replay is idempotent with the same txid', async () => {
    const withdrawalId = await createApprovedOrder('2000000');
    const signing = new WithdrawalSigningService(
      unitOfWork, orders, policies, fakeSigner
    );
    await signing.signForBroadcast(withdrawalId);
    // simulate the crash window: the chain accepted the transaction
    // but the markBroadcast write never happened — order stays SIGNING
    const beforeCrash = await broadcaster.broadcast({
      network: 'TRON',
      fromAddress: 'THotWalletTest',
      toAddress: 'TDestinationTestAddress',
      amount: '2000000',
      feeRate: '1000'
    });
    const order = await unitOfWork.execute((c) =>
      orders.findById(c, withdrawalId)
    );
    expect(order?.status).toBe('SIGNING');
    // retry replays the same deterministic transaction
    const replay = await broadcastService.broadcast(withdrawalId);
    expect(replay.outcome).toBe('BROADCAST');
    expect((replay as { broadcastTxid: string }).broadcastTxid)
      .toBe(beforeCrash.broadcastTxid);
    expect(broadcaster.broadcasts).toHaveLength(2);
    const after = await unitOfWork.execute((c) =>
      orders.findById(c, withdrawalId)
    );
    expect(after?.status).toBe('BROADCAST');
    expect(after?.broadcastTxid).toBe(beforeCrash.broadcastTxid);
    const notified = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.withdrawal-broadcast.v1'`
    );
    expect(notified.rows[0]?.n).toBe(1);
  });

  it('S6WR03: non-broadcastable states are denied with zero calls', async () => {
    const uid = await seedUser();
    await fundUser(uid, '100000000');
    const command: WithdrawalCommand = {
      orderRef: `WD-${randomUUID().slice(0, 8)}`,
      uid,
      assetCode: 'USDT-TRC20',
      amount: '2000000',
      destinationAddress: 'TDestinationTestAddress'
    };
    const pending = await requestService.request(
      command,
      Object.freeze({
        type: 'security.payment-authorized.v1',
        uid: command.uid,
        operationType: 'withdrawal',
        orderRef: command.orderRef,
        amountSummary: command.amount,
        assetSummary: command.assetCode,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        sessionId: randomUUID()
      }) as AuthorizePaymentProofV1
    );
    const pendingId = (pending as { order: { withdrawalId: string } }).order
      .withdrawalId;
    const denied = await broadcastService.broadcast(pendingId);
    expect(denied).toEqual({
      outcome: 'DENIED', reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
    });
    expect(broadcaster.broadcasts).toHaveLength(0);
    expect(fakeSigner.requests).toHaveLength(0);
  });

  it('S6WR04: unknown broadcast outcome writes no state and retries safely', async () => {
    const withdrawalId = await createApprovedOrder('2000000');
    broadcaster.setShouldThrow(true);
    const unknown = await broadcastService.broadcast(withdrawalId);
    expect(unknown).toEqual({ outcome: 'UNKNOWN' });
    const after = await unitOfWork.execute((c) =>
      orders.findById(c, withdrawalId)
    );
    expect(after?.status).toBe('SIGNING');
    expect(after?.broadcastTxid).toBeNull();
    const failureEvents = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic IN ('telegram.withdrawal-broadcast.v1',
                        'telegram.withdrawal-failed.v1')`
    );
    expect(failureEvents.rows[0]?.n).toBe(0);
    broadcaster.setShouldThrow(false);
    const retried = await broadcastService.broadcast(withdrawalId);
    expect(retried.outcome).toBe('BROADCAST');
    expect((retried as { order: { status: string } }).order.status)
      .toBe('BROADCAST');
  });

  it('S6WR05: confirmation monitoring reports readiness without moving state', async () => {
    const withdrawalId = await createApprovedOrder('2000000');
    const broadcast = (await broadcastService.broadcast(withdrawalId)) as {
      broadcastTxid: string;
    };
    const pending = await broadcastService.checkOnChainStatus(withdrawalId);
    expect(pending).toMatchObject({
      outcome: 'CHAIN_STATUS',
      chainStatus: 'PENDING',
      readyForSettlement: false
    });
    broadcaster.setStatus(broadcast.broadcastTxid, 'CONFIRMED');
    const confirmed = await broadcastService.checkOnChainStatus(withdrawalId);
    expect(confirmed).toMatchObject({
      outcome: 'CHAIN_STATUS',
      chainStatus: 'CONFIRMED',
      readyForSettlement: true
    });
    const order = await unitOfWork.execute((c) =>
      orders.findById(c, withdrawalId)
    );
    expect(order?.status).toBe('BROADCAST');
  });

  it('S6WR06: authoritative chain FAILED marks the order failed and locks it', async () => {
    const withdrawalId = await createApprovedOrder('2000000');
    const broadcast = (await broadcastService.broadcast(withdrawalId)) as {
      broadcastTxid: string;
    };
    broadcaster.setStatus(broadcast.broadcastTxid, 'FAILED');
    const checked = await broadcastService.checkOnChainStatus(withdrawalId);
    expect(checked.outcome).toBe('FAILED_MARKED');
    const order = await unitOfWork.execute((c) =>
      orders.findById(c, withdrawalId)
    );
    expect(order?.status).toBe('FAILED');
    expect(order?.failureReason).toBe('CHAIN_REPORTED_FAILED');
    const notified = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.withdrawal-failed.v1'`
    );
    expect(notified.rows[0]?.n).toBe(1);
    const rebroadcast = await broadcastService.broadcast(withdrawalId);
    expect(rebroadcast).toEqual({
      outcome: 'DENIED', reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
    });
    const recheck = await broadcastService.checkOnChainStatus(withdrawalId);
    expect(recheck).toEqual({
      outcome: 'DENIED', reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
    });
  });
});
