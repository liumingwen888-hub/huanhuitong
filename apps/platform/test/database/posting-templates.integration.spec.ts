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
import { BalanceQueryService } from '../../src/modules/ledger/application/balance-query.service.js';
import {
  depositConfirmed,
  internalTransfer,
  claimExecuted,
  redPacketCreated,
  withdrawalRequested,
  withdrawalSucceeded,
  withdrawalFailed,
  exchangeFrozen,
  exchangeSettled,
  fiatPayoutRequested,
  fiatPayoutFailed
} from '../../src/modules/ledger/templates/posting-templates.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const accounts = new PostgresLedgerAccountRepository();
const transactions = new PostgresLedgerTransactionRepository();
let poster: PostMoneyService;
let balances: BalanceQueryService;

interface SeededUser {
  readonly uid: Uid;
  readonly available: string;
  readonly frozen: string;
}

async function seedUser(asset = 'USDT-TRC20'): Promise<SeededUser> {
  const uid = await unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    return created.rows[0]!.uid as Uid;
  });
  const available = await unitOfWork.execute((context) =>
    accounts.openUserAccount(context, {
      ownerUid: uid,
      assetCode: asset,
      purpose: 'USER_AVAILABLE',
      idempotencyKey: `open-${randomUUID()}`
    })
  );
  const frozen = await unitOfWork.execute((context) =>
    accounts.openUserAccount(context, {
      ownerUid: uid,
      assetCode: asset,
      purpose: 'USER_FROZEN',
      idempotencyKey: `open-${randomUUID()}`
    })
  );
  return { uid, available: available.accountId, frozen: frozen.accountId };
}

async function seedPlatformAccounts(
  asset = 'USDT-TRC20'
): Promise<{
  custody: string;
  feeIncome: string;
  claimLiability: string;
  clearingDiff: string;
  upstreamCost: string;
}> {
  const purposes = [
    'PLATFORM_CUSTODY',
    'FEE_INCOME',
    'CLAIM_LIABILITY',
    'CLEARING_DIFF',
    'UPSTREAM_COST'
  ];
  const result: Record<string, string> = {};
  for (const purpose of purposes) {
    const rows = await cleanupPool.query<{ account_id: string }>(
      `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
       VALUES (NULL, $1, $2) RETURNING account_id`,
      [asset, purpose]
    );
    result[purpose] = rows.rows[0]!.account_id;
  }
  return {
    custody: result['PLATFORM_CUSTODY']!,
    feeIncome: result['FEE_INCOME']!,
    claimLiability: result['CLAIM_LIABILITY']!,
    clearingDiff: result['CLEARING_DIFF']!,
    upstreamCost: result['UPSTREAM_COST']!
  };
}

async function bootstrapCustody(
  custodyAccountId: string,
  amount: string
): Promise<void> {
  const clearing = await cleanupPool.query<{ account_id: string }>(
    `SELECT account_id FROM ledger_accounts WHERE purpose='CLEARING_DIFF' LIMIT 1`
  );
  const tx = randomUUID();
  await cleanupPool.query(
    `INSERT INTO ledger_transactions (transaction_id, idempotency_key, transaction_type)
     VALUES ($1::uuid, $2, 'ADJUSTMENT')`,
    [tx, `boot-${randomUUID()}`]
  );
  await cleanupPool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, entry_index)
     VALUES ($1::uuid, $2::uuid, 'DEBIT', $3::bigint, 0),
            ($1::uuid, $4::uuid, 'CREDIT', $3::bigint, 1)`,
    [tx, custodyAccountId, amount, clearing.rows[0]!.account_id]
  );
  await balances.recomputeAll();
}

async function fundUser(
  custody: string,
  available: string,
  amount: string
): Promise<void> {
  await poster.post({
    idempotencyKey: `fund-${randomUUID()}`,
    transactionType: 'DEPOSIT',
    occurredAt: new Date().toISOString(),
    lines: [
      { accountId: custody, direction: 'DEBIT', amount },
      { accountId: available, direction: 'CREDIT', amount }
    ]
  });
}

async function bal(accountId: string): Promise<string> {
  return balances.accountBalanceOf(accountId as never);
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, {
    projectRoot,
    configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-s36-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s36-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never,
        fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
  poster = new PostMoneyService(unitOfWork, accounts, transactions);
  balances = new BalanceQueryService(unitOfWork, accounts);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'account_balances',
    'ledger_entries',
    'ledger_transactions',
    'account_openings',
    'ledger_accounts',
    'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S3-6 posting templates', () => {
  it('S3T01: deposit confirmed posts custody→user', async () => {
    const user = await seedUser();
    const platform = await seedPlatformAccounts();
    await bootstrapCustody(platform.custody, '10000');
    const result = depositConfirmed({
      custodyAccountId: platform.custody as never,
      userAvailableAccountId: user.available as never,
      amount: '500',
      orderId: 'dep-1'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const posted = await poster.post(result.command);
      expect(posted.posted).toBe(true);
      expect(result.command.idempotencyKey).toBe('DEPOSIT:dep-1:CONFIRM:0');
    }
    expect(await bal(user.available)).toBe('-500');
    expect(await bal(platform.custody)).toBe('10500');
  });

  it('S3T02: internal transfer with fee posts three legs', async () => {
    const sender = await seedUser();
    const recipient = await seedUser();
    const platform = await seedPlatformAccounts();
    await bootstrapCustody(platform.custody, '10000');
    await fundUser(platform.custody, sender.available, '1000');
    const result = internalTransfer({
      senderAvailableAccountId: sender.available as never,
      recipientAvailableAccountId: recipient.available as never,
      feeIncomeAccountId: platform.feeIncome as never,
      amount: '800',
      feeAmount: '5',
      orderId: 'xfer-1'
    });
    expect(result.ok).toBe(true);
    if (result.ok) await poster.post(result.command);
    expect(await bal(sender.available)).toBe('-195');
    expect(await bal(recipient.available)).toBe('-800');
    expect(await bal(platform.feeIncome)).toBe('-5');
  });

  it('S3T03-04: red packet create then claim', async () => {
    const sender = await seedUser();
    const claimer = await seedUser();
    const platform = await seedPlatformAccounts();
    await bootstrapCustody(platform.custody, '10000');
    await fundUser(platform.custody, sender.available, '1000');
    const create = redPacketCreated({
      senderAvailableAccountId: sender.available as never,
      claimLiabilityAccountId: platform.claimLiability as never,
      amount: '100',
      orderId: 'rp-1'
    });
    expect(create.ok).toBe(true);
    if (create.ok) await poster.post(create.command);
    expect(await bal(sender.available)).toBe('-900');
    expect(await bal(platform.claimLiability)).toBe('-100');
    const claim = claimExecuted({
      claimLiabilityAccountId: platform.claimLiability as never,
      recipientAvailableAccountId: claimer.available as never,
      amount: '100',
      orderId: 'rp-1'
    });
    expect(claim.ok).toBe(true);
    if (claim.ok) await poster.post(claim.command);
    expect(await bal(platform.claimLiability)).toBe('0');
    expect(await bal(claimer.available)).toBe('-100');
  });

  it('S3T05-07: withdrawal freeze→succeed and freeze→fail release', async () => {
    const user = await seedUser();
    const platform = await seedPlatformAccounts();
    await bootstrapCustody(platform.custody, '10000');
    await fundUser(platform.custody, user.available, '1000');
    const freeze = withdrawalRequested({
      userAvailableAccountId: user.available as never,
      userFrozenAccountId: user.frozen as never,
      amount: '300',
      orderId: 'wd-1'
    });
    expect(freeze.ok).toBe(true);
    if (freeze.ok) await poster.post(freeze.command);
    expect(await bal(user.available)).toBe('-700');
    expect(await bal(user.frozen)).toBe('-300');
    const succeed = withdrawalSucceeded({
      userAvailableAccountId: user.available as never,
      userFrozenAccountId: user.frozen as never,
      custodyAccountId: platform.custody as never,
      feeIncomeAccountId: platform.feeIncome as never,
      amount: '300',
      feeAmount: '10',
      orderId: 'wd-1'
    });
    expect(succeed.ok).toBe(true);
    if (succeed.ok) await poster.post(succeed.command);
    expect(await bal(user.frozen)).toBe('0');
    expect(await bal(platform.feeIncome)).toBe('-10');
    // Fail release scenario
    const user2 = await seedUser();
    await fundUser(platform.custody, user2.available, '500');
    const freeze2 = withdrawalRequested({
      userAvailableAccountId: user2.available as never,
      userFrozenAccountId: user2.frozen as never,
      amount: '200',
      orderId: 'wd-2'
    });
    if (freeze2.ok) await poster.post(freeze2.command);
    const release = withdrawalFailed({
      userAvailableAccountId: user2.available as never,
      userFrozenAccountId: user2.frozen as never,
      amount: '200',
      orderId: 'wd-2'
    });
    expect(release.ok).toBe(true);
    if (release.ok) await poster.post(release.command);
    expect(await bal(user2.frozen)).toBe('0');
    expect(await bal(user2.available)).toBe('-500');
  });

  it('S3T08-09: exchange freeze then settle', async () => {
    const user = await seedUser('USDT-TRC20');
    const recipient = await seedUser('USDT-TRC20');
    const platform = await seedPlatformAccounts('USDT-TRC20');
    await bootstrapCustody(platform.custody, '10000');
    await fundUser(platform.custody, user.available, '1000');
    await fundUser(platform.custody, recipient.available, '500');
    const freeze = exchangeFrozen({
      userAvailableAccountId: user.available as never,
      userFrozenAccountId: user.frozen as never,
      sellAmount: '500',
      orderId: 'ex-1'
    });
    expect(freeze.ok).toBe(true);
    if (freeze.ok) await poster.post(freeze.command);
    expect(await bal(user.frozen)).toBe('-500');
    expect(await bal(user.available)).toBe('-500');
    const settle = exchangeSettled({
      sellFrozenAccountId: user.frozen as never,
      sellClearingAccountId: platform.clearingDiff as never,
      buyClearingAccountId: platform.clearingDiff as never,
      buyAvailableAccountId: recipient.available as never,
      sellAmount: '500',
      buyAmount: '500',
      orderId: 'ex-1'
    });
    expect(settle.ok).toBe(true);
    if (settle.ok) await poster.post(settle.command);
    expect(await bal(user.frozen)).toBe('0');
    expect(await bal(recipient.available)).toBe('-1000');
  });

  it('S3T10-11: fiat payout freeze→succeed and freeze→fail', async () => {
    const user = await seedUser();
    const platform = await seedPlatformAccounts();
    await bootstrapCustody(platform.custody, '10000');
    await fundUser(platform.custody, user.available, '1000');
    const freeze = fiatPayoutRequested({
      userAvailableAccountId: user.available as never,
      userFrozenAccountId: user.frozen as never,
      amount: '400',
      orderId: 'fp-1'
    });
    expect(freeze.ok).toBe(true);
    if (freeze.ok) await poster.post(freeze.command);
    const release = fiatPayoutFailed({
      userAvailableAccountId: user.available as never,
      userFrozenAccountId: user.frozen as never,
      amount: '400',
      orderId: 'fp-1'
    });
    expect(release.ok).toBe(true);
    if (release.ok) await poster.post(release.command);
    expect(await bal(user.frozen)).toBe('0');
    expect(await bal(user.available)).toBe('-1000');
  });

  it('S3T12: insufficient balance is rejected by the kernel', async () => {
    const user = await seedUser();
    const platform = await seedPlatformAccounts();
    await bootstrapCustody(platform.custody, '10000');
    await fundUser(platform.custody, user.available, '100');
    const result = withdrawalRequested({
      userAvailableAccountId: user.available as never,
      userFrozenAccountId: user.frozen as never,
      amount: '200',
      orderId: 'wd-over'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      await expect(poster.post(result.command)).rejects.toMatchObject({
        code: 'TRANSACTION_CALLBACK_FAILED'
      });
    }
    expect(await bal(user.available)).toBe('-100');
    expect(await bal(user.frozen)).toBe('0');
  });
});
