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

async function reservedOrder(
  amount = '5000000'
): Promise<PayoutOrderSnapshot> {
  const uid = await seedUser();
  await fundUser(uid, '10000000');
  const command: PayoutCommand = {
    orderRef: `PO-${randomUUID().slice(0, 8)}`,
    uid,
    route: 'US:USD',
    amount,
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
  expect(result.outcome).toBe('ACCEPTED');
  return (result as { order: PayoutOrderSnapshot }).order;
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
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
    ])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s84-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s84-platform'
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
    'outbox_messages', 'payout_orders', 'operation_limits', 'risk_decisions',
    'account_balances', 'ledger_entries', 'account_openings',
    'ledger_transactions', 'ledger_accounts', 'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'PLATFORM_CUSTODY')`
  );
  provider = new FakeBankProvider();
  requestService = new PayoutRequestService(
    unitOfWork, orders, configs, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  submissionService = new PayoutSubmissionService(
    unitOfWork, orders, provider, outbox
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S8-4 provider submission', () => {
  it('S8PS01: submission is accepted with all order facts', async () => {
    const order = await reservedOrder();
    const result = await submissionService.submit(order.payoutOrderId);
    expect(result.outcome).toBe('ACCEPTED');
    expect((result as { order: { status: string } }).order.status)
      .toBe('ACCEPTED');
    expect(provider.submits).toHaveLength(1);
    expect(provider.submits[0]).toMatchObject({
      providerIdempotencyKey: order.providerIdempotencyKey,
      route: 'US:USD',
      sourceAssetCode: 'USDT-TRC20',
      amount: '5000000',
      estimatedFiat: '4998000',
      beneficiaryRef: 'BEN-TEST-0001'
    });
  });

  it('S8PS02: a crash-window replay dedupes at the provider', async () => {
    const order = await reservedOrder();
    const first = await submissionService.submit(order.payoutOrderId);
    expect(first.outcome).toBe('ACCEPTED');
    // simulate the crash window: the provider accepted but neither
    // the markAccepted write nor the notification ever happened
    await cleanupPool.query(
      `UPDATE payout_orders SET status = 'SUBMITTING'
        WHERE payout_order_id = $1::uuid`,
      [order.payoutOrderId]
    );
    await cleanupPool.query(
      `DELETE FROM outbox_messages
        WHERE topic = 'telegram.payout-submitted.v1'
          AND payload->>'orderRef' = $1`,
      [order.orderRef]
    );
    const replay = await submissionService.submit(order.payoutOrderId);
    expect(replay.outcome).toBe('ACCEPTED');
    expect(provider.submits).toHaveLength(2);
    expect(provider.distinctSubmissions).toBe(1);
    const rows = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM payout_orders
        WHERE status = 'ACCEPTED' AND payout_order_id = $1::uuid`,
      [order.payoutOrderId]
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('S8PS03: a provider rejection fails the order with the reason', async () => {
    const order = await reservedOrder();
    provider.setDefaultResult({
      status: 'REJECTED',
      reasonCode: 'BENEFICIARY_BLOCKED'
    });
    const result = await submissionService.submit(order.payoutOrderId);
    expect(result.outcome).toBe('FAILED');
    const failed = (result as { order: PayoutOrderSnapshot }).order;
    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toBe('PROVIDER_REJECTED:BENEFICIARY_BLOCKED');
  });

  it('S8PS04: an unavailable provider leaves the order retryable', async () => {
    const order = await reservedOrder();
    provider.setShouldThrow(true);
    const unknown = await submissionService.submit(order.payoutOrderId);
    expect(unknown).toEqual({ outcome: 'UNKNOWN' });
    const stuck = await unitOfWork.execute((c) =>
      orders.findById(c, order.payoutOrderId)
    );
    expect(stuck?.status).toBe('SUBMITTING');
    const events = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic IN ('telegram.payout-submitted.v1',
                        'telegram.payout-failed.v1')`
    );
    expect(events.rows[0]?.n).toBe(0);
    provider.setShouldThrow(false);
    const recovered = await submissionService.submit(order.payoutOrderId);
    expect(recovered.outcome).toBe('ACCEPTED');
    expect(provider.distinctSubmissions).toBe(1);
  });

  it('S8PS05: non-submittable states are denied', async () => {
    const order = await reservedOrder();
    await cleanupPool.query(
      `UPDATE payout_orders SET status = 'ACCEPTED'
        WHERE payout_order_id = $1::uuid`,
      [order.payoutOrderId]
    );
    const denied = await submissionService.submit(order.payoutOrderId);
    expect(denied).toEqual({
      outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION'
    });
    const unknown = await submissionService.submit(randomUUID());
    expect(unknown).toEqual({
      outcome: 'DENIED', reasonCode: 'PAYOUT_ORDER_NOT_FOUND'
    });
    expect(provider.submits).toHaveLength(0);
  });

  it('S8PS06: the key passed is exactly the order key', async () => {
    const order = await reservedOrder();
    await submissionService.submit(order.payoutOrderId);
    expect(provider.submits[0]?.providerIdempotencyKey)
      .toBe(order.providerIdempotencyKey);
    expect(order.providerIdempotencyKey)
      .toBe(`PPO:fake-bank-v1:${order.orderRef}`);
  });

  it('S8PS07: the query port returns configured states', async () => {
    const order = await reservedOrder();
    expect(await provider.query(order.providerIdempotencyKey))
      .toEqual({ status: 'UNKNOWN' });
    for (const status of [
      'ACCEPTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'
    ] as const) {
      provider.setQueryState(order.providerIdempotencyKey, { status });
      expect(await provider.query(order.providerIdempotencyKey))
        .toEqual({ status });
    }
  });
});
