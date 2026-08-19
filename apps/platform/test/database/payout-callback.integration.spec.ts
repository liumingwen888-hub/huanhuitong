import { createHmac, randomUUID } from 'node:crypto';
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

function sign(payload: string, secret = TEST_SECRET): string {
  return createHmac('sha256', secret).update(payload)
    .digest('base64url');
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

async function acceptedOrder(): Promise<PayoutOrderSnapshot> {
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
  const submitted = await submissionService.submit(order.payoutOrderId);
  expect(submitted.outcome).toBe('ACCEPTED');
  return order;
}

function callbackPayload(
  order: PayoutOrderSnapshot,
  reportedStatus: string,
  eventId = `EVT-${randomUUID().slice(0, 8)}`
): { raw: string; eventId: string } {
  return {
    raw: JSON.stringify({
      providerEventId: eventId,
      providerIdempotencyKey: order.providerIdempotencyKey,
      reportedStatus
    }),
    eventId
  };
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
    max: 1, application_name: 'xht-s85-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s85-platform'
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
  queryService = new PayoutQueryService(
    unitOfWork, orders, provider, outbox
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S8-5 callback ingestion and query', () => {
  it('S8CB01: a signed SUCCEEDED callback queues settlement', async () => {
    const order = await acceptedOrder();
    const payload = callbackPayload(order, 'SUCCEEDED');
    const result = await callbackService.ingest({
      providerId: 'fake-bank-v1',
      rawPayload: payload.raw,
      signature: sign(payload.raw)
    });
    expect(result).toEqual({
      outcome: 'RECORDED',
      reportedStatus: 'SUCCEEDED',
      orderRef: order.orderRef
    });
    const events = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'payout.settlement-pending.v1'`
    );
    expect(events.rows[0]?.n).toBe(1);
    const after = await unitOfWork.execute((c) =>
      orders.findById(c, order.payoutOrderId)
    );
    expect(after?.status).toBe('ACCEPTED');
  });

  it('S8CB02: a bad signature rejects permanently with zero writes', async () => {
    const order = await acceptedOrder();
    const payload = callbackPayload(order, 'SUCCEEDED');
    const result = await callbackService.ingest({
      providerId: 'fake-bank-v1',
      rawPayload: payload.raw,
      signature: sign(payload.raw, 'wrong-secret')
    });
    expect(result).toEqual({
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

  it('S8CB03: a replayed eventId is rejected without side effects', async () => {
    const order = await acceptedOrder();
    const payload = callbackPayload(order, 'SUCCEEDED');
    const first = await callbackService.ingest({
      providerId: 'fake-bank-v1',
      rawPayload: payload.raw,
      signature: sign(payload.raw)
    });
    expect(first.outcome).toBe('RECORDED');
    const replay = await callbackService.ingest({
      providerId: 'fake-bank-v1',
      rawPayload: payload.raw,
      signature: sign(payload.raw)
    });
    expect(replay).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_CALLBACK_REPLAY'
    });
    const events = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'payout.settlement-pending.v1'`
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it('S8CB04: a FAILED callback fails the order', async () => {
    const order = await acceptedOrder();
    const payload = callbackPayload(order, 'FAILED');
    const result = await callbackService.ingest({
      providerId: 'fake-bank-v1',
      rawPayload: payload.raw,
      signature: sign(payload.raw)
    });
    expect(result.outcome).toBe('RECORDED');
    const after = await unitOfWork.execute((c) =>
      orders.findById(c, order.payoutOrderId)
    );
    expect(after?.status).toBe('FAILED');
    expect(after?.failureReason).toBe('PROVIDER_CALLBACK:FAILED');
  });

  it('S8CB05: malformed payloads and unknown providers reject', async () => {
    const order = await acceptedOrder();
    const malformed = JSON.stringify({ garbage: true });
    const badPayload = await callbackService.ingest({
      providerId: 'fake-bank-v1',
      rawPayload: malformed,
      signature: sign(malformed)
    });
    expect(badPayload).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID'
    });
    const unknown = await callbackService.ingest({
      providerId: 'no-such-provider',
      rawPayload: '{}',
      signature: 'x'
    });
    expect(unknown).toEqual({
      outcome: 'REJECTED',
      reasonCode: 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND'
    });
    const counts = await cleanupPool.query<{ i: number }>(
      `SELECT count(*)::int AS i FROM callback_inbox`
    );
    expect(counts.rows[0]?.i).toBe(0);
  });

  it('S8CB06: query-first resolves and never infers', async () => {
    const order = await acceptedOrder();
    provider.setQueryState(order.providerIdempotencyKey, {
      status: 'SUCCEEDED'
    });
    const succeeded = await queryService.queryFirst(order.payoutOrderId);
    expect(succeeded).toEqual({
      outcome: 'SUCCEEDED_REPORTED', orderRef: order.orderRef
    });
    const events = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic = 'payout.settlement-pending.v1'`
    );
    expect(events.rows[0]?.n).toBe(1);
    const unknownOrder = await acceptedOrder();
    const unknown = await queryService.queryFirst(
      unknownOrder.payoutOrderId
    );
    expect(unknown).toEqual({
      outcome: 'UNKNOWN', reasonCode: 'PAYOUT_UNKNOWN_PENDING_QUERY'
    });
    const zeroEvents = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_messages
        WHERE topic LIKE 'payout.%'
          AND payload->>'orderRef' = $1`,
      [unknownOrder.orderRef]
    );
    expect(zeroEvents.rows[0]?.n).toBe(0);
    const denied = await queryService.queryFirst(randomUUID());
    expect(denied).toEqual({
      outcome: 'DENIED', reasonCode: 'PAYOUT_ORDER_NOT_FOUND'
    });
  });

  it('S8CB07: the HMAC verifier discriminates secrets', async () => {
    const payload = 'probe';
    expect(await verifier.verify({
      providerId: 'p', secretRef: SECRET_REF,
      payload, signature: sign(payload)
    })).toBe(true);
    expect(await verifier.verify({
      providerId: 'p', secretRef: SECRET_REF,
      payload, signature: sign(payload, 'other-secret')
    })).toBe(false);
    expect(await verifier.verify({
      providerId: 'p', secretRef: 'vault:unknown-ref',
      payload, signature: sign(payload)
    })).toBe(false);
  });
});
