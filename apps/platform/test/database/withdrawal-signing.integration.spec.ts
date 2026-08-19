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
import { SignerError } from '../../src/modules/signer/domain/signer.errors.js';
import {
  PostgresSignerPolicyRepository,
  PostgresWithdrawalApprovalRepository,
  PostgresWithdrawalOrderRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';
import { WithdrawalRequestService } from '../../src/modules/withdrawals/application/withdrawal-request.service.js';
import { WithdrawalApprovalService } from '../../src/modules/withdrawals/application/withdrawal-approval.service.js';
import {
  WithdrawalSigningService
} from '../../src/modules/withdrawals/application/withdrawal-signing.service.js';
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
let signingService: WithdrawalSigningService;
let requestService: WithdrawalRequestService;
let approvalService: WithdrawalApprovalService;

async function seedUser(): Promise<Uid> {
  return cleanupPool
    .query<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid::text AS uid`
    )
    .then((r) => r.rows[0]!.uid as Uid);
}

async function seedPolicy(): Promise<void> {
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

function makeCommand(uid: Uid, amount: string): WithdrawalCommand {
  return {
    orderRef: `WD-${randomUUID().slice(0, 8)}`,
    uid,
    assetCode: 'USDT-TRC20',
    amount,
    destinationAddress: 'TDestinationTestAddress'
  };
}

function makeProof(command: WithdrawalCommand): AuthorizePaymentProofV1 {
  return Object.freeze({
    type: 'security.payment-authorized.v1',
    uid: command.uid,
    operationType: 'withdrawal',
    orderRef: command.orderRef,
    amountSummary: command.amount,
    assetSummary: command.assetCode,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sessionId: randomUUID()
  });
}

async function createPendingOrder(amount: string): Promise<string> {
  const uid = await seedUser();
  await fundUser(uid, '100000000');
  const command = makeCommand(uid, amount);
  const result = await requestService.request(command, makeProof(command));
  expect(result.outcome).toBe('ACCEPTED');
  return (result as { order: { withdrawalId: string } }).order.withdrawalId;
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
    max: 1, application_name: 'xht-s64-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s64-platform'
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
  await seedPolicy();
  await cleanupPool.query(
    `INSERT INTO config_versions (config_key, version, payload)
     VALUES ('withdrawal.approval', 1, $1::jsonb)`,
    [JSON.stringify({ dualApprovalThreshold: '3000000' })]
  );
  fakeSigner = new FakeSigner();
  requestService = new WithdrawalRequestService(
    unitOfWork, orders, policies, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  approvalService = new WithdrawalApprovalService(
    unitOfWork, orders, approvals,
    new AdminAuthorizer(unitOfWork), new ConfigStore(unitOfWork), outbox
  );
  signingService = new WithdrawalSigningService(
    unitOfWork, orders, policies, fakeSigner
  );
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S6-4 signer isolation and signing orchestration', () => {
  it('S6WS01: APPROVED order signs into SIGNING deterministically', async () => {
    const withdrawalId = await createPendingOrder('2000000');
    await unitOfWork.execute((c) => orders.markApproved(c, withdrawalId));
    const first = await signingService.signForBroadcast(withdrawalId);
    expect(first.outcome).toBe('SIGNED');
    const signed = first as {
      order: { status: string };
      signing: { signatureRef: string; request: { network: string; fromAddress: string } };
    };
    expect(signed.order.status).toBe('SIGNING');
    expect(signed.signing.request.network).toBe('TRON');
    expect(signed.signing.request.fromAddress).toBe('THotWalletTest');
    const second = await signingService.signForBroadcast(withdrawalId);
    expect(second.outcome).toBe('SIGNED');
    expect((second as typeof signed).signing.signatureRef)
      .toBe(signed.signing.signatureRef);
  });

  it('S6WS02: re-invoking a SIGNING order is idempotent', async () => {
    const withdrawalId = await createPendingOrder('2000000');
    await unitOfWork.execute((c) => orders.markApproved(c, withdrawalId));
    await signingService.signForBroadcast(withdrawalId);
    const again = await signingService.signForBroadcast(withdrawalId);
    expect(again.outcome).toBe('SIGNED');
    expect((again as { order: { status: string } }).order.status)
      .toBe('SIGNING');
    expect(fakeSigner.requests).toHaveLength(2);
    expect(fakeSigner.requests[0]?.canonicalDigest)
      .toBe(fakeSigner.requests[1]?.canonicalDigest);
  });

  it('S6WS03: non-approvable states are denied with zero signer calls', async () => {
    const pendingId = await createPendingOrder('2000000');
    const pending = await signingService.signForBroadcast(pendingId);
    expect(pending).toEqual({
      outcome: 'DENIED', reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
    });
    const rejectedId = await createPendingOrder('2000000');
    const admin = await cleanupPool
      .query<{ id: string }>(
        `INSERT INTO admin_principals (status) VALUES ('ACTIVE')
         RETURNING admin_id::text AS id`
      )
      .then((r) => r.rows[0]!.id);
    await cleanupPool.query(
      `INSERT INTO admin_role_grants (admin_id, role) VALUES ($1::uuid, 'FINANCE_OFFICER')`,
      [admin]
    );
    await approvalService.decide({
      withdrawalId: rejectedId, adminId: admin, decision: 'REJECT',
      reason: 'test rejection'
    });
    const rejected = await signingService.signForBroadcast(rejectedId);
    expect(rejected).toEqual({
      outcome: 'DENIED', reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
    });
    expect(fakeSigner.requests).toHaveLength(0);
  });

  it('S6WS04: signer failure leaves the order retryable in SIGNING', async () => {
    const withdrawalId = await createPendingOrder('2000000');
    await unitOfWork.execute((c) => orders.markApproved(c, withdrawalId));
    fakeSigner.setShouldFail(true);
    await expect(
      signingService.signForBroadcast(withdrawalId)
    ).rejects.toBeInstanceOf(SignerError);
    const stuck = await unitOfWork.execute((c) =>
      orders.findById(c, withdrawalId)
    );
    expect(stuck?.status).toBe('SIGNING');
    fakeSigner.setShouldFail(false);
    const retried = await signingService.signForBroadcast(withdrawalId);
    expect(retried.outcome).toBe('SIGNED');
    expect((retried as { order: { status: string } }).order.status)
      .toBe('SIGNING');
  });
});
