import { createHash, randomUUID } from 'node:crypto';
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
import {
  PostgresPayoutOrderRepository,
  PostgresProviderConfigRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-payout.repository.js';
import {
  PayoutRequestService
} from '../../src/modules/fiatpayout/application/payout-request.service.js';

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
let requestService: PayoutRequestService;

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

function makeCommand(
  uid: Uid,
  overrides: Partial<PayoutCommand> = {}
): PayoutCommand {
  return {
    orderRef: `PO-${randomUUID().slice(0, 8)}`,
    uid,
    route: 'US:USD',
    amount: '5000000',
    beneficiaryRef: 'BEN-TEST-0001',
    ...overrides
  };
}

function makeProof(
  command: PayoutCommand,
  overrides: Partial<AuthorizePaymentProofV1> = {}
): AuthorizePaymentProofV1 {
  return Object.freeze({
    type: 'security.payment-authorized.v1',
    uid: command.uid,
    operationType: 'fiat-payout',
    orderRef: command.orderRef,
    amountSummary: command.amount,
    assetSummary: command.route,
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
    expect.arrayContaining([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'
    ])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s83-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s83-platform'
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
  requestService = new PayoutRequestService(
    unitOfWork, orders, configs, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S8-3 payout request and freeze', () => {
  it('S8PR01: proof binding rejects every mismatch dimension', async () => {
    const uid = await seedUser();
    const command = makeCommand(uid);
    const cases: Partial<AuthorizePaymentProofV1>[] = [
      { type: 'security.payment-authorized.v2' as never },
      { uid: randomUUID() as Uid },
      { operationType: 'withdrawal' as never },
      { orderRef: `PO-other-${randomUUID().slice(0, 6)}` },
      { amountSummary: '999999' },
      { assetSummary: 'DE:EUR' },
      { expiresAt: new Date(Date.now() - 1000).toISOString() }
    ];
    for (const override of cases) {
      const result = await requestService.request(
        command, makeProof(command, override)
      );
      expect(result).toEqual({
        outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID'
      });
    }
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM payout_orders`
    );
    expect(count.rows[0]?.n).toBe(0);
  });

  it('S8PR02: the same orderRef replays to ALREADY_REQUESTED', async () => {
    const uid = await seedUser();
    await fundUser(uid, '10000000');
    const command = makeCommand(uid);
    const first = await requestService.request(command, makeProof(command));
    expect(first.outcome).toBe('ACCEPTED');
    const second = await requestService.request(command, makeProof(command));
    expect(second.outcome).toBe('ALREADY_REQUESTED');
    const freezes = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key = $1`,
      [`FIAT_PAYOUT:${command.orderRef}:FREEZE:0`]
    );
    expect(freezes.rows[0]?.n).toBe(1);
  });

  it('S8PR03: unknown routes and out-of-range amounts fail closed', async () => {
    const uid = await seedUser();
    await fundUser(uid, '100000000');
    const unknownRoute = makeCommand(uid, { route: 'XX:XXX' });
    expect(
      await requestService.request(unknownRoute, makeProof(unknownRoute))
    ).toEqual({
      outcome: 'REJECTED',
      reasonCode: 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND'
    });
    const tooSmall = makeCommand(uid, { amount: '99999' });
    expect(
      await requestService.request(tooSmall, makeProof(tooSmall))
    ).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_AMOUNT_OUT_OF_RANGE'
    });
    const tooLarge = makeCommand(uid, { amount: '100000001' });
    expect(
      await requestService.request(tooLarge, makeProof(tooLarge))
    ).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_AMOUNT_OUT_OF_RANGE'
    });
    const txCount = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE idempotency_key LIKE 'FIAT_PAYOUT:%'`
    );
    expect(txCount.rows[0]?.n).toBe(0);
  });

  it('S8PR04: freezing moves funds and the order snapshots config facts', async () => {
    const uid = await seedUser();
    await fundUser(uid, '10000000');
    const command = makeCommand(uid, { amount: '2000000' });
    const result = await requestService.request(command, makeProof(command));
    expect(result.outcome).toBe('ACCEPTED');
    const order = (result as { order: PayoutOrderSnapshot }).order;
    expect(order.status).toBe('FUNDS_RESERVED');
    expect(order.sourceAssetCode).toBe('USDT-TRC20');
    expect(order.feeAmount).toBe('2000');
    expect(order.providerId).toBe('fake-bank-v1');
    expect(order.providerConfigVersion).toBe(1);
    expect(order.providerIdempotencyKey)
      .toBe(`PPO:fake-bank-v1:${command.orderRef}`);
    expect(order.beneficiaryDigest).toBe(
      `sha256:${createHash('sha256')
        .update('BEN-TEST-0001')
        .digest('base64url')}`
    );
    const balances = await cleanupPool.query<{
      purpose: string;
      signed: string;
    }>(
      `SELECT a.purpose, b.signed_balance::text AS signed
         FROM account_balances b
         JOIN ledger_accounts a ON a.account_id = b.account_id
        WHERE a.owner_uid = $1::uuid AND a.asset_code = 'USDT-TRC20'`,
      [uid]
    );
    const byPurpose = new Map(
      balances.rows.map((r) => [r.purpose, r.signed])
    );
    expect(byPurpose.get('USER_AVAILABLE')).toBe('-8000000');
    expect(byPurpose.get('USER_FROZEN')).toBe('-2000000');
  });

  it('S8PR05: insufficient funds and risk denial write nothing', async () => {
    const poor = await seedUser();
    await fundUser(poor, '100000');
    const poorCommand = makeCommand(poor);
    expect(
      await requestService.request(poorCommand, makeProof(poorCommand))
    ).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_INSUFFICIENT_FUNDS'
    });
    const riskUid = await seedUser();
    await fundUser(riskUid, '10000000');
    await cleanupPool.query(
      `INSERT INTO operation_limits
         (uid, operation_type, window_seconds, max_count, max_amount)
       VALUES ($1::uuid, 'FIAT_PAYOUT', 86400, 10, 100000)`,
      [riskUid]
    );
    const riskCommand = makeCommand(riskUid);
    expect(
      await requestService.request(riskCommand, makeProof(riskCommand))
    ).toEqual({
      outcome: 'REJECTED', reasonCode: 'PAYOUT_RISK_DENIED'
    });
    const counts = await cleanupPool.query<{ o: number; t: number }>(
      `SELECT
         (SELECT count(*)::int FROM payout_orders) AS o,
         (SELECT count(*)::int FROM ledger_transactions
           WHERE idempotency_key LIKE 'FIAT_PAYOUT:%') AS t`
    );
    expect(counts.rows[0]).toEqual({ o: 0, t: 0 });
  });

  it('S8PR06: the source asset is derived from config, never the command', async () => {
    const uid = await seedUser();
    await fundUser(uid, '10000000');
    const command = makeCommand(uid);
    const result = await requestService.request(command, makeProof(command));
    const order = (result as { order: PayoutOrderSnapshot }).order;
    expect(order.sourceAssetCode).toBe('USDT-TRC20');
    const commandShape = Object.keys(command).sort();
    expect(commandShape).not.toContain('sourceAssetCode');
  });

  it('S8PR07: beneficiary token shape is enforced before any write', async () => {
    const uid = await seedUser();
    await fundUser(uid, '10000000');
    for (const bad of ['', 'x', 'has space', 'bad!token', 'DI'] as const) {
      const command = makeCommand(uid, { beneficiaryRef: bad });
      expect(
        await requestService.request(command, makeProof(command))
      ).toEqual({
        outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID'
      });
    }
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM payout_orders`
    );
    expect(count.rows[0]?.n).toBe(0);
  });
});
