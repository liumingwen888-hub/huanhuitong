import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  AuthorizePaymentProofV1,
  PayoutCommand,
  PayoutOrderSnapshot,
  StageOneDatabase,
  Uid
} from '@xht/contracts';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import { Kysely, PostgresDialect } from 'kysely';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';
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
import { FakeBankProvider } from '../../src/modules/fiatpayout/domain/fake-bank.provider.js';
import {
  PostgresPayoutOrderRepository,
  PostgresProviderConfigRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-payout.repository.js';
import {
  PayoutRequestService
} from '../../src/modules/fiatpayout/application/payout-request.service.js';
import {
  PayoutSubmissionService
} from '../../src/modules/fiatpayout/application/payout-submission.service.js';
import {
  PayoutSettlementService
} from '../../src/modules/fiatpayout/application/payout-settlement.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const orders = new PostgresPayoutOrderRepository();
const configs = new PostgresProviderConfigRepository();
const outbox = new PostgresOutboxRepository();
let provider: FakeBankProvider;
let requestService: PayoutRequestService;
let submissionService: PayoutSubmissionService;
let settlementService: PayoutSettlementService;

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

async function seedUpstreamFloat(amount: string): Promise<void> {
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'CLEARING_DIFF')
     ON CONFLICT DO NOTHING`
  );
  const tx = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
    [tx, `upstream-${randomUUID()}`]
  );
  // balanced seed: upstream float is debited from clearing
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     SELECT $1::uuid, a.account_id,
            CASE a.purpose WHEN 'UPSTREAM_COST' THEN 'DEBIT' ELSE 'CREDIT' END,
            $2::bigint,
            CASE a.purpose WHEN 'UPSTREAM_COST' THEN 0 ELSE 1 END
       FROM ledger_accounts a
      WHERE a.owner_uid IS NULL AND a.asset_code = 'USDT-TRC20'
        AND a.purpose IN ('UPSTREAM_COST', 'CLEARING_DIFF')`,
    [tx, amount]
  );
  // keep the projection consistent with the directly seeded entries
  await cleanupPool.query(
    `INSERT INTO account_balances (account_id, signed_balance)
     SELECT a.account_id,
            CASE a.purpose WHEN 'UPSTREAM_COST' THEN $1::bigint ELSE -$1::bigint END
       FROM ledger_accounts a
      WHERE a.owner_uid IS NULL AND a.asset_code = 'USDT-TRC20'
        AND a.purpose IN ('UPSTREAM_COST', 'CLEARING_DIFF')
     ON CONFLICT (account_id) DO UPDATE
        SET signed_balance = EXCLUDED.signed_balance`,
    [amount]
  );
}

async function acceptedOrder(
  fund: string,
  options: { readonly failAtProvider?: boolean } = {}
): Promise<PayoutOrderSnapshot> {
  const uid = await seedUser();
  await fundUser(uid, fund);
  const command: PayoutCommand = {
    orderRef: `PO-${randomUUID().slice(0, 8)}`,
    uid,
    route: 'US:USD',
    amount: '5000000',
    beneficiaryRef: 'BEN-TEST-0001'
  };
  const proof: AuthorizePaymentProofV1 = Object.freeze({
    type: 'security.payment-authorized.v1',
    uid: command.uid,
    operationType: 'fiat-payout',
    orderRef: command.orderRef,
    amountSummary: command.amount,
    assetSummary: command.route,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sessionId: randomUUID()
  });
  const result = await requestService.request(command, proof);
  const order = (result as { order: PayoutOrderSnapshot }).order;
  if (options.failAtProvider === true) {
    provider.setDefaultResult({
      status: 'REJECTED',
      reasonCode: 'COMPLIANCE_HOLD'
    });
    await submissionService.submit(order.payoutOrderId);
    provider.setDefaultResult({ status: 'ACCEPTED' });
    return order;
  }
  const submitted = await submissionService.submit(order.payoutOrderId);
  expect(submitted.outcome).toBe('ACCEPTED');
  return order;
}

async function signed(
  owner: string | null,
  purpose: string
): Promise<string | null> {
  const rows = await cleanupPool.query<{ signed: string }>(
    `SELECT b.signed_balance::text AS signed
       FROM account_balances b
       JOIN ledger_accounts a ON a.account_id = b.account_id
      WHERE (a.owner_uid::text = $1 OR ($1::text IS NULL AND a.owner_uid IS NULL))
        AND a.asset_code = 'USDT-TRC20' AND a.purpose = $2`,
    [owner, purpose]
  );
  return rows.rows[0]?.signed ?? null;
}

async function actionCount(
  action: string,
  orderRef: string
): Promise<number> {
  const rows = await cleanupPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ledger_transactions
      WHERE idempotency_key LIKE $1`,
    [`FIAT_PAYOUT:${orderRef}:${action}:%`]
  );
  return rows.rows[0]?.n ?? 0;
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
    expect.arrayContaining([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'
    ])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s86-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s86-platform'
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
    'outbox_messages', 'callback_inbox', 'payout_orders',
    'operation_limits', 'risk_decisions', 'account_balances',
    'ledger_entries', 'account_openings', 'ledger_transactions',
    'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY')`
  );
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'UPSTREAM_COST')`
  );
  await seedUpstreamFloat('100000000');
  provider = new FakeBankProvider();
  requestService = new PayoutRequestService(
    unitOfWork, orders, configs, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  submissionService = new PayoutSubmissionService(
    unitOfWork, orders, provider, outbox
  );
  settlementService = new PayoutSettlementService(
    unitOfWork, orders, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S8-6 payout settlement, release and reversal', () => {
  it('S8ST01: settlement lands the five-account effect', async () => {
    const order = await acceptedOrder('10000000');
    const result = await settlementService.settle(order.payoutOrderId);
    expect(result.outcome).toBe('SETTLED');
    const settled = (result as { order: PayoutOrderSnapshot }).order;
    expect(settled.status).toBe('SUCCEEDED');
    expect(settled.settlementLedgerTransactionId).not.toBeNull();
    expect(await signed(order.uid, 'USER_FROZEN')).toBe('0');
    expect(await signed(order.uid, 'USER_AVAILABLE')).toBe('-4998000');
    expect(await signed(null, 'UPSTREAM_COST'))
      .toBe((100000000 - 5000000).toString());
    expect(await signed(null, 'FEE_INCOME')).toBe('-2000');
    const events = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'telegram.payout-succeeded.v1'`
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it('S8ST02: settling a SUCCEEDED order again is denied', async () => {
    const order = await acceptedOrder('10000000');
    await settlementService.settle(order.payoutOrderId);
    const again = await settlementService.settle(order.payoutOrderId);
    expect(again).toEqual({
      outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION'
    });
    expect(await actionCount('SETTLE', order.orderRef)).toBe(1);
  });

  it('S8ST03: release restores the full frozen amount', async () => {
    const order = await acceptedOrder('10000000', { failAtProvider: true });
    const result = await settlementService.release(order.payoutOrderId);
    expect(result.outcome).toBe('REFUNDED');
    expect((result as { order: PayoutOrderSnapshot }).order.status)
      .toBe('REFUNDED');
    expect(await signed(order.uid, 'USER_AVAILABLE')).toBe('-10000000');
    expect(await signed(order.uid, 'USER_FROZEN')).toBe('0');
    expect(await actionCount('RELEASE', order.orderRef)).toBe(1);
  });

  it('S8ST04: reversal mirrors the settlement compensation', async () => {
    const order = await acceptedOrder('10000000');
    await settlementService.settle(order.payoutOrderId);
    const result = await settlementService.reverse(order.payoutOrderId);
    expect(result.outcome).toBe('REVERSED');
    expect((result as { order: PayoutOrderSnapshot }).order.status)
      .toBe('REVERSED');
    expect(await signed(order.uid, 'USER_AVAILABLE')).toBe('-10000000');
    expect(await signed(null, 'UPSTREAM_COST')).toBe('100000000');
    expect(await signed(null, 'FEE_INCOME')).toBe('0');
    expect(await actionCount('REVERSE', order.orderRef)).toBe(1);
  });

  it('S8ST05: invalid prior states are denied across all paths', async () => {
    const reserved = await (async () => {
      const uid = await seedUser();
      await fundUser(uid, '10000000');
      const command: PayoutCommand = {
        orderRef: `PO-${randomUUID().slice(0, 8)}`,
        uid,
        route: 'US:USD',
        amount: '5000000',
        beneficiaryRef: 'BEN-TEST-0001'
      };
      const proof: AuthorizePaymentProofV1 = Object.freeze({
        type: 'security.payment-authorized.v1',
        uid,
        operationType: 'fiat-payout',
        orderRef: command.orderRef,
        amountSummary: command.amount,
        assetSummary: command.route,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        sessionId: randomUUID()
      });
      const result = await requestService.request(command, proof);
      return (result as { order: PayoutOrderSnapshot }).order;
    })();
    expect(
      await settlementService.settle(reserved.payoutOrderId)
    ).toEqual({ outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' });
    expect(
      await settlementService.release(reserved.payoutOrderId)
    ).toEqual({ outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' });
    const accepted = await acceptedOrder('10000000');
    expect(
      await settlementService.reverse(accepted.payoutOrderId)
    ).toEqual({ outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' });
    expect(
      await settlementService.settle(randomUUID())
    ).toEqual({
      outcome: 'DENIED', reasonCode: 'PAYOUT_ORDER_NOT_FOUND'
    });
  });

  it('S8ST06: a fee the user cannot cover fails closed', async () => {
    const uid = await seedUser();
    await fundUser(uid, '5000000');
    const command: PayoutCommand = {
      orderRef: `PO-${randomUUID().slice(0, 8)}`,
      uid,
      route: 'US:USD',
      amount: '5000000',
      beneficiaryRef: 'BEN-TEST-0001'
    };
    const proof: AuthorizePaymentProofV1 = Object.freeze({
      type: 'security.payment-authorized.v1',
      uid,
      operationType: 'fiat-payout',
      orderRef: command.orderRef,
      amountSummary: command.amount,
      assetSummary: command.route,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      sessionId: randomUUID()
    });
    const result = await requestService.request(command, proof);
    const order = (result as { order: PayoutOrderSnapshot }).order;
    await submissionService.submit(order.payoutOrderId);
    expect(await signed(uid, 'USER_AVAILABLE')).toBe('0');
    const rejected = await settlementService.settle(order.payoutOrderId);
    expect(rejected).toEqual({
      outcome: 'SETTLE_REJECTED',
      reasonCode: 'PAYOUT_INSUFFICIENT_FUNDS'
    });
    const after = await unitOfWork.execute((c) =>
      orders.findById(c, order.payoutOrderId)
    );
    expect(after?.status).toBe('ACCEPTED');
    expect(await actionCount('SETTLE', order.orderRef)).toBe(0);
  });

  it('S8ST07: each path notifies exactly once with one ledger action', async () => {
    const settledOrder = await acceptedOrder('10000000');
    await settlementService.settle(settledOrder.payoutOrderId);
    await settlementService.settle(settledOrder.payoutOrderId);
    const failedOrder = await acceptedOrder('10000000', {
      failAtProvider: true
    });
    await settlementService.release(failedOrder.payoutOrderId);
    await settlementService.release(failedOrder.payoutOrderId);
    const reversedOrder = await acceptedOrder('10000000');
    await settlementService.settle(reversedOrder.payoutOrderId);
    await settlementService.reverse(reversedOrder.payoutOrderId);
    await settlementService.reverse(reversedOrder.payoutOrderId);
    const events = await cleanupPool.query<{ topic: string; n: number }>(
      `SELECT topic, count(*)::int AS n FROM outbox_messages
        WHERE topic IN ('telegram.payout-succeeded.v1',
                        'telegram.payout-refunded.v1',
                        'telegram.payout-reversed.v1')
        GROUP BY topic`
    );
    const byTopic = new Map(events.rows.map((r) => [r.topic, r.n]));
    expect(byTopic.get('telegram.payout-succeeded.v1')).toBe(2);
    expect(byTopic.get('telegram.payout-refunded.v1')).toBe(1);
    expect(byTopic.get('telegram.payout-reversed.v1')).toBe(1);
    expect(await actionCount('SETTLE', settledOrder.orderRef)).toBe(1);
    expect(await actionCount('RELEASE', failedOrder.orderRef)).toBe(1);
    expect(await actionCount('REVERSE', reversedOrder.orderRef)).toBe(1);
  });
});
