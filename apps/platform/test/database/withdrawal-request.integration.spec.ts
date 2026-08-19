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
import {
  PostgresSignerPolicyRepository,
  PostgresWithdrawalOrderRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';
import { WithdrawalRequestService } from '../../src/modules/withdrawals/application/withdrawal-request.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const orders = new PostgresWithdrawalOrderRepository();
const policies = new PostgresSignerPolicyRepository();
const outbox = new PostgresOutboxRepository();
let service: WithdrawalRequestService;

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
}

async function seedPolicy(
  overrides: Partial<{
    policyVersion: number;
    minAutoAmount: string;
    maxAmount: string;
    feeAmount: string;
  }> = {}
): Promise<void> {
  await unitOfWork.execute((c) =>
    policies.insert(c, {
      policyVersion: overrides.policyVersion ?? 1,
      network: 'TRON',
      hotWalletAddress: 'THotWalletTest',
      feeAmount: overrides.feeAmount ?? '1000',
      minAutoAmount: overrides.minAutoAmount ?? '1000000',
      maxAmount: overrides.maxAmount ?? '50000000'
    })
  );
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

function makeCommand(overrides: Partial<WithdrawalCommand> = {}): WithdrawalCommand {
  return {
    orderRef: `WD-${randomUUID().slice(0, 8)}`,
    uid: '00000000-0000-0000-0000-000000000000' as Uid,
    assetCode: 'USDT-TRC20',
    amount: '500000',
    destinationAddress: 'TDestinationTestAddress',
    ...overrides
  };
}

function makeProof(
  command: WithdrawalCommand,
  overrides: Partial<AuthorizePaymentProofV1> = {}
): AuthorizePaymentProofV1 {
  return Object.freeze({
    type: 'security.payment-authorized.v1',
    uid: command.uid,
    operationType: 'withdrawal',
    orderRef: command.orderRef,
    amountSummary: command.amount,
    assetSummary: command.assetCode,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sessionId: randomUUID(),
    ...overrides
  });
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
    max: 1, application_name: 'xht-s62-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s62-platform'
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
    'signer_policies', 'admin_principals', 'risk_decisions',
    'operation_limits', 'account_balances', 'ledger_entries',
    'account_openings', 'ledger_transactions', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY')`
  );
  await seedPolicy();
  service = new WithdrawalRequestService(
    unitOfWork, orders, policies, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S6-2 withdrawal request and freeze service', () => {
  it('S6WA01: proof binding rejects every mismatch dimension', async () => {
    const uid = await seedUser();
    const command = makeCommand({ uid });
    const cases: Partial<AuthorizePaymentProofV1>[] = [
      { type: 'security.payment-authorized.v2' as never },
      { uid: randomUUID() as Uid },
      { operationType: 'security-change' as never },
      { orderRef: `WD-other-${randomUUID().slice(0, 6)}` },
      { amountSummary: '999999' },
      { assetSummary: 'BTC' },
      { expiresAt: new Date(Date.now() - 1000).toISOString() }
    ];
    for (const override of cases) {
      const result = await service.request(
        command, makeProof(command, override)
      );
      expect(result).toEqual({
        outcome: 'REJECTED',
        reasonCode: 'WITHDRAWAL_COMMAND_INVALID'
      });
    }
    const orderCount = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM withdrawal_orders`
    );
    expect(orderCount.rows[0]?.n).toBe(0);
  });

  it('S6WA02: same orderRef replay returns ALREADY_REQUESTED with one freeze', async () => {
    const uid = await seedUser();
    await fundUser(uid, '10000000');
    const command = makeCommand({ uid, amount: '500000' });
    const first = await service.request(command, makeProof(command));
    expect(first.outcome).toBe('ACCEPTED');
    const second = await service.request(command, makeProof(command));
    expect(second.outcome).toBe('ALREADY_REQUESTED');
    if (second.outcome === 'ALREADY_REQUESTED') {
      expect(second.order.withdrawalId).toBe(
        (first as { order: { withdrawalId: string } }).order.withdrawalId
      );
    }
    const freezes = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key = $1`,
      [`WITHDRAWAL:${command.orderRef}:FREEZE:0`]
    );
    expect(freezes.rows[0]?.n).toBe(1);
  });

  it('S6WA03: missing policy and over-max amount fail closed with zero writes', async () => {
    const uid = await seedUser();
    await fundUser(uid, '100000000');
    const noPolicy = makeCommand({ uid, amount: '500000' });
    await cleanupPool.query(`DELETE FROM signer_policies`);
    const denied = await service.request(noPolicy, makeProof(noPolicy));
    expect(denied).toEqual({
      outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_POLICY_NOT_FOUND'
    });
    await seedPolicy();
    const tooBig = makeCommand({ uid, amount: '60000000' });
    const overMax = await service.request(tooBig, makeProof(tooBig));
    expect(overMax).toEqual({
      outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_AMOUNT_ABOVE_MAX'
    });
    const txCount = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key LIKE 'WITHDRAWAL:%'`
    );
    expect(txCount.rows[0]?.n).toBe(0);
  });

  it('S6WA04: freeze moves available to frozen with balanced entries', async () => {
    const uid = await seedUser();
    await fundUser(uid, '10000000');
    const command = makeCommand({ uid, amount: '500000' });
    const result = await service.request(command, makeProof(command));
    expect(result.outcome).toBe('ACCEPTED');
    const balances = await cleanupPool.query<{
      purpose: string;
      balance: string;
    }>(
      `SELECT a.purpose, (-b.signed_balance)::text AS balance
         FROM account_balances b
         JOIN ledger_accounts a ON a.account_id = b.account_id
        WHERE a.owner_uid = $1::uuid
        ORDER BY a.purpose`,
      [uid]
    );
    // credit-normal purposes hold funds as negative signed balances;
    // the query negates for human-readable expectations
    const byPurpose = new Map(
      balances.rows.map((row) => [row.purpose, row.balance])
    );
    expect(byPurpose.get('USER_AVAILABLE')).toBe('9500000');
    expect(byPurpose.get('USER_FROZEN')).toBe('500000');
    const freeze = await cleanupPool.query<{
      debits: string;
      credits: string;
    }>(
      `SELECT COALESCE(SUM(CASE WHEN e.direction = 'DEBIT'
                THEN e.amount ELSE 0 END), 0)::text AS debits,
              COALESCE(SUM(CASE WHEN e.direction = 'CREDIT'
                THEN e.amount ELSE 0 END), 0)::text AS credits
         FROM ledger_entries e
         JOIN ledger_transactions t ON t.transaction_id = e.transaction_id
        WHERE t.idempotency_key = $1`,
      [`WITHDRAWAL:${command.orderRef}:FREEZE:0`]
    );
    expect(freeze.rows[0]).toEqual({ debits: '500000', credits: '500000' });
  });

  it('S6WA05: dual-track routing follows minAutoAmount threshold', async () => {
    const uid = await seedUser();
    await fundUser(uid, '100000000');
    const low = makeCommand({ uid, amount: '999999' });
    const lowResult = await service.request(low, makeProof(low));
    expect(lowResult.outcome).toBe('ACCEPTED');
    expect(
      (lowResult as { order: { status: string } }).order.status
    ).toBe('APPROVED');
    const high = makeCommand({ uid, amount: '1000000' });
    const highResult = await service.request(high, makeProof(high));
    expect(highResult.outcome).toBe('ACCEPTED');
    expect(
      (highResult as { order: { status: string } }).order.status
    ).toBe('PENDING_APPROVAL');
  });

  it('S6WA06: insufficient balance is rejected with no order (precheck guards; kernel stays authority)', async () => {
    const uid = await seedUser();
    await fundUser(uid, '100000');
    const command = makeCommand({ uid, amount: '500000' });
    const result = await service.request(command, makeProof(command));
    expect(result).toEqual({
      outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_INSUFFICIENT_FUNDS'
    });
    const orderCount = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM withdrawal_orders`
    );
    expect(orderCount.rows[0]?.n).toBe(0);
  });

  it('S6WA07: risk gate denial leaves zero ledger and order writes', async () => {
    const uid = await seedUser();
    await fundUser(uid, '100000000');
    await cleanupPool.query(
      `INSERT INTO operation_limits
         (uid, operation_type, window_seconds, max_count, max_amount)
       VALUES ($1::uuid, 'WITHDRAWAL', 86400, 10, 100000)`,
      [uid]
    );
    const command = makeCommand({ uid, amount: '500000' });
    const result = await service.request(command, makeProof(command));
    expect(result).toEqual({
      outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_RISK_DENIED'
    });
    const counts = await cleanupPool.query<{ tx: number; ord: number }>(
      `SELECT
         (SELECT count(*)::int FROM ledger_transactions
           WHERE idempotency_key LIKE 'WITHDRAWAL:%') AS tx,
         (SELECT count(*)::int FROM withdrawal_orders) AS ord`
    );
    expect(counts.rows[0]).toEqual({ tx: 0, ord: 0 });
  });

  it('S6WA08: outbox carries receipt and pending-approval events', async () => {
    const uid = await seedUser();
    await fundUser(uid, '100000000');
    const low = makeCommand({ uid, amount: '500000' });
    await service.request(low, makeProof(low));
    const high = makeCommand({ uid, amount: '5000000' });
    await service.request(high, makeProof(high));
    const events = await cleanupPool.query<{ topic: string }>(
      `SELECT topic FROM outbox_messages ORDER BY topic`
    );
    const topics = events.rows.map((row) => row.topic);
    expect(topics).toContain('telegram.withdrawal-requested.v1');
    expect(topics).toContain('admin.withdrawal-pending-approval.v1');
    const userEvents = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.withdrawal-requested.v1'`
    );
    expect(userEvents.rows[0]?.n).toBe(2);
    const adminEvents = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'admin.withdrawal-pending-approval.v1'`
    );
    expect(adminEvents.rows[0]?.n).toBe(1);
  });
});
