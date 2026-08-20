import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
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
import { FakeHmacVerifier } from '../../src/modules/fiatpayout/domain/fake-hmac.verifier.js';
import {
  PostgresPayoutOrderRepository,
  PostgresProviderConfigRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-payout.repository.js';
import {
  PostgresCallbackInboxRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-callback-inbox.repository.js';
import {
  PayoutRequestService
} from '../../src/modules/fiatpayout/application/payout-request.service.js';
import {
  PayoutSubmissionService
} from '../../src/modules/fiatpayout/application/payout-submission.service.js';
import {
  PayoutCallbackService
} from '../../src/modules/fiatpayout/application/payout-callback.service.js';
import {
  PayoutQueryService
} from '../../src/modules/fiatpayout/application/payout-query.service.js';
import {
  PayoutSettlementService
} from '../../src/modules/fiatpayout/application/payout-settlement.service.js';
import {
  PayoutReconciliationService
} from '../../src/modules/fiatpayout/application/payout-reconciliation.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const SECRET_REF = 'vault:fake-bank-callback-v1';
const TEST_SECRET = 'synthetic-callback-secret';

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const orders = new PostgresPayoutOrderRepository();
const configs = new PostgresProviderConfigRepository();
const inbox = new PostgresCallbackInboxRepository();
const outbox = new PostgresOutboxRepository();
let provider: FakeBankProvider;
let verifier: FakeHmacVerifier;
let requestService: PayoutRequestService;
let submissionService: PayoutSubmissionService;
let callbackService: PayoutCallbackService;
let queryService: PayoutQueryService;
let settlementService: PayoutSettlementService;
let reconciliation: PayoutReconciliationService;

function sign(payload: string, secret = TEST_SECRET): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

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

async function seedUpstreamFloat(): Promise<void> {
  const tx = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
    [tx, `upstream-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     SELECT $1::uuid, a.account_id,
            CASE a.purpose WHEN 'UPSTREAM_COST' THEN 'DEBIT' ELSE 'CREDIT' END,
            1000000000::bigint,
            CASE a.purpose WHEN 'UPSTREAM_COST' THEN 0 ELSE 1 END
       FROM ledger_accounts a
      WHERE a.owner_uid IS NULL AND a.asset_code = 'USDT-TRC20'
        AND a.purpose IN ('UPSTREAM_COST', 'CLEARING_DIFF')`,
    [tx]
  );
  await cleanupPool.query(
    `INSERT INTO account_balances (account_id, signed_balance)
     SELECT a.account_id,
            CASE a.purpose WHEN 'UPSTREAM_COST' THEN 1000000000 ELSE -1000000000 END
       FROM ledger_accounts a
      WHERE a.owner_uid IS NULL AND a.asset_code = 'USDT-TRC20'
        AND a.purpose IN ('UPSTREAM_COST', 'CLEARING_DIFF')
     ON CONFLICT (account_id) DO UPDATE
        SET signed_balance = EXCLUDED.signed_balance`
  );
}

async function createPayout(
  fund = '10000000',
  amount = '5000000'
): Promise<PayoutOrderSnapshot> {
  const uid = await seedUser();
  await fundUser(uid, fund);
  const command: PayoutCommand = {
    orderRef: `PO-${randomUUID().slice(0, 8)}`,
    uid,
    route: 'US:USD',
    amount,
    beneficiaryRef: 'BEN-TEST-0001'
  };
  const result = await requestService.request(
    command,
    Object.freeze({
      type: 'security.payment-authorized.v1',
      uid,
      operationType: 'fiat-payout',
      orderRef: command.orderRef,
      amountSummary: command.amount,
      assetSummary: command.route,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      sessionId: randomUUID()
    })
  );
  expect(result.outcome).toBe('ACCEPTED');
  return (result as { order: PayoutOrderSnapshot }).order;
}

async function submitAccepted(
  order: PayoutOrderSnapshot
): Promise<PayoutOrderSnapshot> {
  const result = await submissionService.submit(order.payoutOrderId);
  expect(result.outcome).toBe('ACCEPTED');
  return order;
}

async function signedCallback(
  order: PayoutOrderSnapshot,
  reportedStatus: string,
  eventId = `EVT-${randomUUID().slice(0, 8)}`
): Promise<ReturnType<PayoutCallbackService['ingest']>> {
  const raw = JSON.stringify({
    providerEventId: eventId,
    providerIdempotencyKey: order.providerIdempotencyKey,
    reportedStatus
  });
  return callbackService.ingest({
    providerId: 'fake-bank-v1',
    rawPayload: raw,
    signature: sign(raw)
  });
}

async function signedBalance(
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
    max: 1, application_name: 'xht-s8a-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s8a-platform'
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
  await cleanupPool.query(
    `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
     VALUES (NULL, 'USDT-TRC20', 'CLEARING_DIFF')`
  );
  await seedUpstreamFloat();
  provider = new FakeBankProvider();
  verifier = new FakeHmacVerifier();
  verifier.setSecret(SECRET_REF, TEST_SECRET);
  requestService = new PayoutRequestService(
    unitOfWork, orders, configs, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  submissionService = new PayoutSubmissionService(
    unitOfWork, orders, provider, outbox
  );
  callbackService = new PayoutCallbackService(
    unitOfWork, configs, orders, inbox, verifier, outbox
  );
  queryService = new PayoutQueryService(unitOfWork, orders, provider, outbox);
  settlementService = new PayoutSettlementService(
    unitOfWork, orders, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox
  );
  reconciliation = new PayoutReconciliationService(unitOfWork);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S8-8 stage eight acceptance', () => {
  it('S8A01: the callback success chain settles end to end', async () => {
    const order = await submitAccepted(await createPayout());
    const callback = await signedCallback(order, 'SUCCEEDED');
    expect(callback.outcome).toBe('RECORDED');
    const settlement = await settlementService.settle(order.payoutOrderId);
    expect(settlement.outcome).toBe('SETTLED');
    const settled = await unitOfWork.execute((c) =>
      orders.findById(c, order.payoutOrderId)
    );
    expect(settled?.status).toBe('SUCCEEDED');
    expect(settled?.settlementLedgerTransactionId).not.toBeNull();
    expect(await signedBalance(order.uid, 'USER_FROZEN')).toBe('0');
    expect(await signedBalance(order.uid, 'USER_AVAILABLE'))
      .toBe('-4998000');
    expect(await signedBalance(null, 'FEE_INCOME')).toBe('-2000');
  });

  it('S8A02: a missing callback is resolved by query-first', async () => {
    const order = await submitAccepted(await createPayout());
    provider.setQueryState(order.providerIdempotencyKey, {
      status: 'SUCCEEDED'
    });
    const queried = await queryService.queryFirst(order.payoutOrderId);
    expect(queried.outcome).toBe('SUCCEEDED_REPORTED');
    const settlement = await settlementService.settle(order.payoutOrderId);
    expect(settlement.outcome).toBe('SETTLED');
  });

  it('S8A03: a provider rejection releases the frozen funds', async () => {
    const order = await createPayout();
    provider.setDefaultResult({ status: 'REJECTED', reasonCode: 'X' });
    const submitted = await submissionService.submit(order.payoutOrderId);
    expect(submitted.outcome).toBe('FAILED');
    const released = await settlementService.release(order.payoutOrderId);
    expect(released.outcome).toBe('REFUNDED');
    expect(await signedBalance(order.uid, 'USER_AVAILABLE'))
      .toBe('-10000000');
  });

  it('S8A04: a late FAILED callback releases after acceptance', async () => {
    const order = await submitAccepted(await createPayout());
    const callback = await signedCallback(order, 'FAILED');
    expect(callback.outcome).toBe('RECORDED');
    const released = await settlementService.release(order.payoutOrderId);
    expect(released.outcome).toBe('REFUNDED');
    expect(await signedBalance(order.uid, 'USER_FROZEN')).toBe('0');
  });

  it('S8A05: a REVERSED callback compensates the settlement', async () => {
    const order = await submitAccepted(await createPayout());
    await settlementService.settle(order.payoutOrderId);
    const callback = await signedCallback(order, 'REVERSED');
    expect(callback.outcome).toBe('RECORDED');
    const reversed = await settlementService.reverse(order.payoutOrderId);
    expect(reversed.outcome).toBe('REVERSED');
    expect(await signedBalance(order.uid, 'USER_AVAILABLE'))
      .toBe('-10000000');
    expect(await signedBalance(null, 'FEE_INCOME')).toBe('0');
  });

  it('S8A06: a crash-window resubmit never double-pays', async () => {
    const order = await submitAccepted(await createPayout());
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
  });

  it('S8A07: a forged callback writes nothing anywhere', async () => {
    const order = await submitAccepted(await createPayout());
    const raw = JSON.stringify({
      providerEventId: `EVT-${randomUUID().slice(0, 8)}`,
      providerIdempotencyKey: order.providerIdempotencyKey,
      reportedStatus: 'SUCCEEDED'
    });
    const forged = await callbackService.ingest({
      providerId: 'fake-bank-v1',
      rawPayload: raw,
      signature: sign(raw, 'attacker-secret')
    });
    expect(forged).toEqual({
      outcome: 'REJECTED',
      reasonCode: 'PAYOUT_CALLBACK_VERIFICATION_FAILED'
    });
    const counts = await cleanupPool.query<{
      i: number; e: number; s: string;
    }>(
      `SELECT
         (SELECT count(*)::int FROM callback_inbox) AS i,
         (SELECT count(*)::int FROM outbox_messages
           WHERE topic LIKE 'payout.%') AS e,
         (SELECT status FROM payout_orders
           WHERE payout_order_id = $1::uuid) AS s`,
      [order.payoutOrderId]
    );
    expect(counts.rows[0]).toMatchObject({ i: 0, e: 0, s: 'ACCEPTED' });
  });

  it('S8A08: a replayed callback deduplicates with zero effects', async () => {
    const order = await submitAccepted(await createPayout());
    const first = await signedCallback(order, 'SUCCEEDED', 'EVT-FIXED-01');
    expect(first.outcome).toBe('RECORDED');
    const replay = await signedCallback(order, 'SUCCEEDED', 'EVT-FIXED-01');
    expect(replay).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_CALLBACK_REPLAY'
    });
    const events = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'payout.settlement-pending.v1'`
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it('S8A09: an UNKNOWN provider answer writes nothing and recovers', async () => {
    const order = await submitAccepted(await createPayout());
    const unknown = await queryService.queryFirst(order.payoutOrderId);
    expect(unknown).toEqual({
      outcome: 'UNKNOWN', reasonCode: 'PAYOUT_UNKNOWN_PENDING_QUERY'
    });
    // user-facing notifications may exist; internal queue events must
    // not — an UNKNOWN answer writes nothing
    const zero = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic LIKE 'payout.%' AND payload->>'orderRef' = $1`,
      [order.orderRef]
    );
    expect(zero.rows[0]?.n).toBe(0);
    provider.setQueryState(order.providerIdempotencyKey, {
      status: 'SUCCEEDED'
    });
    const recovered = await queryService.queryFirst(order.payoutOrderId);
    expect(recovered.outcome).toBe('SUCCEEDED_REPORTED');
  });

  it('S8A10: mixed paths reconcile with zero discrepancies', async () => {
    const settledOrder = await submitAccepted(await createPayout());
    await signedCallback(settledOrder, 'SUCCEEDED');
    await settlementService.settle(settledOrder.payoutOrderId);
    const failedOrder = await createPayout();
    provider.setDefaultResult({ status: 'REJECTED', reasonCode: 'X' });
    await submissionService.submit(failedOrder.payoutOrderId);
    provider.setDefaultResult({ status: 'ACCEPTED' });
    await settlementService.release(failedOrder.payoutOrderId);
    const reversedOrder = await submitAccepted(await createPayout());
    await settlementService.settle(reversedOrder.payoutOrderId);
    await settlementService.reverse(reversedOrder.payoutOrderId);
    const report = await reconciliation.runAll();
    expect(report.discrepancies).toEqual([]);
  });

  it('S8A11: payout payloads carry no secrets or beneficiary data', async () => {
    const order = await submitAccepted(await createPayout());
    await signedCallback(order, 'SUCCEEDED');
    await settlementService.settle(order.payoutOrderId);
    const leaks = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE payload::text ~* '"(password|secret|privatekey|private_key|mnemonic|seed|digest|beneficiary|key)"'`
    );
    expect(leaks.rows[0]?.n).toBe(0);
    const beneficiaryColumns = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE payload::text LIKE '%BEN-%'`
    );
    expect(beneficiaryColumns.rows[0]?.n).toBe(0);
  });

  it('S8A12: the ledger stays balanced with zero projection drift', async () => {
    const settledOrder = await submitAccepted(await createPayout());
    await signedCallback(settledOrder, 'SUCCEEDED');
    await settlementService.settle(settledOrder.payoutOrderId);
    const totals = await cleanupPool.query<{ d: string; c: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0)::text AS d,
              COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0)::text AS c
         FROM ledger_entries`
    );
    expect(BigInt(totals.rows[0]!.d)).toBe(BigInt(totals.rows[0]!.c));
    const drift = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM account_balances b
        WHERE b.signed_balance <> (
          SELECT COALESCE(SUM(
            CASE e.direction WHEN 'DEBIT' THEN e.amount ELSE -e.amount END
          ), 0) FROM ledger_entries e WHERE e.account_id = b.account_id)`
    );
    expect(drift.rows[0]?.n).toBe(0);
  });
});
