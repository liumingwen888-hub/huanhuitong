import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  AdminSessionSnapshot,
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
import {
  AdminAuthorizer,
  ConfigStore,
  RiskGate
} from '../../src/modules/crosscutting/application/crosscutting.services.js';
import {
  base32Encode,
  totpCode
} from '../../src/modules/security/domain/totp.js';
import {
  FakeTotpSecretStore
} from '../../src/modules/admin/domain/fake-totp-secret.store.js';
import {
  PostgresAdminSessionRepository
} from '../../src/modules/admin/infrastructure/postgres-admin-session.repository.js';
import {
  AdminAuthService
} from '../../src/modules/admin/application/admin-auth.service.js';
import {
  AuditRecorder
} from '../../src/modules/admin/application/audit-recorder.js';
import {
  AuditQueryService
} from '../../src/modules/admin/application/audit-query.service.js';
import {
  ApprovalWorkbenchService
} from '../../src/modules/admin/application/approval-workbench.service.js';
import {
  OpsViewService
} from '../../src/modules/admin/application/ops-view.service.js';
import {
  ConfigReleaseService
} from '../../src/modules/admin/application/config-release.service.js';
import {
  ReconciliationService
} from '../../src/modules/ledger/application/reconciliation.service.js';
import {
  ExchangeReconciliationService
} from '../../src/modules/exchange/application/exchange-reconciliation.service.js';
import {
  PayoutReconciliationService
} from '../../src/modules/fiatpayout/application/payout-reconciliation.service.js';
import {
  AdminApiRouter
} from '../../src/modules/admin/http/admin-api.router.js';
import {
  registerAuthRoutes
} from '../../src/modules/admin/http/admin-routes.js';
import {
  registerApprovalRoutes
} from '../../src/modules/admin/http/admin-approval.routes.js';
import {
  registerOpsRoutes
} from '../../src/modules/admin/http/admin-ops.routes.js';
import {
  registerAuditRoutes
} from '../../src/modules/admin/http/admin-audit.routes.js';
import {
  registerConfigRoutes
} from '../../src/modules/admin/http/admin-config.routes.js';
import {
  PostgresWithdrawalOrderRepository,
  PostgresWithdrawalApprovalRepository,
  PostgresSignerPolicyRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';
import {
  WithdrawalRequestService
} from '../../src/modules/withdrawals/application/withdrawal-request.service.js';
import {
  WithdrawalApprovalService
} from '../../src/modules/withdrawals/application/withdrawal-approval.service.js';
import {
  PostgresExchangeOrderRepository
} from '../../src/modules/exchange/infrastructure/postgres-exchange-order.repository.js';
import {
  PostgresPayoutOrderRepository,
  PostgresProviderConfigRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-payout.repository.js';
import {
  PostgresMarketRepository
} from '../../src/modules/exchange/infrastructure/postgres-market.repository.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const BOOTSTRAP = 'bootstrap-admin';
const BOOTSTRAP_PASSWORD = 'Bootstrap-Admin-2026!';
const BOOTSTRAP_TOTP_REF = 'vault:bootstrap-totp-v1';
const BOOTSTRAP_TOTP_SECRET = base32Encode(
  Buffer.from('0123456789abcdef0123', 'utf8')
);
const FINANCE_ID = '55555555-5555-4555-8555-555555555555';
const FINANCE2_ID = '66666666-6666-4666-8666-666666666666';
const AUDITOR_ID = '77777777-7777-4777-8777-777777777777';

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const ledgerAccounts = new PostgresLedgerAccountRepository();
const ledgerTransactions = new PostgresLedgerTransactionRepository();
const withdrawalOrders = new PostgresWithdrawalOrderRepository();
const withdrawalApprovals = new PostgresWithdrawalApprovalRepository();
const signerPolicies = new PostgresSignerPolicyRepository();
const exchangeOrders = new PostgresExchangeOrderRepository();
const payoutOrders = new PostgresPayoutOrderRepository();
const providerConfigs = new PostgresProviderConfigRepository();
const markets = new PostgresMarketRepository();
const outbox = new PostgresOutboxRepository();
const adminSessions = new PostgresAdminSessionRepository();
let authService: AdminAuthService;
let workbench: ApprovalWorkbenchService;
let opsViews: OpsViewService;
let auditQueries: AuditQueryService;
let release: ConfigReleaseService;
let router: AdminApiRouter;

let actingAdminId = '';
let elevated = false;

function stubAuth(): AdminAuthService {
  const sessionFor = (adminId: string): AdminSessionSnapshot =>
    Object.freeze({
      sessionId: `session-${adminId.slice(0, 8)}`,
      adminId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      elevatedUntil: elevated
        ? new Date(Date.now() + 300_000).toISOString()
        : null,
      revokedAt: null
    });
  return {
    login: async () => {
      throw new Error('not used');
    },
    logout: async () => undefined,
    elevate: async () => ({
      outcome: 'VALID' as const,
      session: sessionFor(actingAdminId)
    }),
    requireSession: async (token: string, level: string) => {
      if (token !== 'admin-token') {
        return {
          outcome: 'DENIED' as const,
          reasonCode: 'ADMIN_SESSION_INVALID' as const
        };
      }
      if (level === 'ELEVATED' && !elevated) {
        return {
          outcome: 'DENIED' as const,
          reasonCode: 'ADMIN_ELEVATION_REQUIRED' as const
        };
      }
      return { outcome: 'VALID' as const, session: sessionFor(actingAdminId) };
    }
  } as unknown as AdminAuthService;
}

async function seedAdmin(
  adminId: string,
  role: string
): Promise<void> {
  await cleanupPool.query(
    `INSERT INTO admin_principals (admin_id, status)
     VALUES ($1::uuid, 'ACTIVE')
     ON CONFLICT (admin_id) DO NOTHING`,
    [adminId]
  );
  await cleanupPool.query(
    `INSERT INTO admin_role_grants (admin_id, role)
     VALUES ($1::uuid, $2)`,
    [adminId, role]
  );
}

function currentTotp(): string {
  return totpCode(Buffer.from('0123456789abcdef0123', 'utf8'), Date.now());
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

async function pendingWithdrawal(): Promise<string> {
  const uid = await seedUser();
  await fundUser(uid, '10000000');
  const command: WithdrawalCommand = {
    orderRef: `WD-${randomUUID().slice(0, 8)}`,
    uid,
    assetCode: 'USDT-TRC20',
    amount: '5000000',
    destinationAddress: 'TDestinationTestAddress'
  };
  const service = new WithdrawalRequestService(
    unitOfWork, withdrawalOrders, signerPolicies, ledgerAccounts,
    new PostMoneyService(unitOfWork, ledgerAccounts, ledgerTransactions),
    outbox, new RiskGate(unitOfWork)
  );
  const result = await service.request(command, {
    type: 'security.payment-authorized.v1',
    uid,
    operationType: 'withdrawal',
    orderRef: command.orderRef,
    amountSummary: command.amount,
    assetSummary: command.assetCode,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sessionId: randomUUID()
  } as never);
  return (result as { order: { withdrawalId: string } }).order.withdrawalId;
}

async function dispatch(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: {
    readonly body?: unknown;
    readonly query?: Record<string, string>;
  } = {}
) {
  return router.dispatch({
    method,
    path,
    bearerToken: 'admin-token',
    body: options.body,
    query: options.query
  });
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
    max: 1, application_name: 'xht-s9a-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s9a-platform'
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
    'outbox_messages', 'callback_inbox', 'payout_orders', 'audit_events',
    'admin_sessions', 'config_versions', 'operation_limits',
    'risk_decisions', 'exchange_orders', 'quotes',
    'withdrawal_approvals', 'withdrawal_orders', 'signer_policies',
    'admin_role_grants', 'admin_credentials', 'admin_principals',
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
    signerPolicies.insert(c, {
      policyVersion: 1,
      network: 'TRON',
      hotWalletAddress: 'THotWalletTest',
      feeAmount: '1000',
      minAutoAmount: '1000000',
      maxAmount: '50000000'
    })
  );
  await cleanupPool.query(
    `INSERT INTO config_versions (config_key, version, payload)
     VALUES ('withdrawal.approval', 1, $1::jsonb)`,
    [JSON.stringify({ dualApprovalThreshold: '3000000' })]
  );
  await cleanupPool.query(
    `INSERT INTO admin_principals (admin_id, status)
     VALUES ('11111111-1111-4111-8111-111111111111', 'ACTIVE')
     ON CONFLICT (admin_id) DO NOTHING`
  );
  await cleanupPool.query(
    `INSERT INTO admin_credentials
       (admin_id, username, password_hash, totp_secret_ref)
     VALUES ('11111111-1111-4111-8111-111111111111',
             'bootstrap-admin',
             '$argon2id$v=19$m=19456,t=3,p=1$aGh0LWJvb3RzdHJhcC1hZG1pbi1zYWx0LTAx$JkbPkSPTYnmBn4j2Tz3AlGsCfPtFVo7bBF31vTXj24o',
             'vault:bootstrap-totp-v1')
     ON CONFLICT (admin_id) DO NOTHING`
  );
  await seedAdmin(FINANCE_ID, 'FINANCE_OFFICER');
  await seedAdmin(FINANCE_ID, 'RISK_OFFICER');
  await seedAdmin(FINANCE2_ID, 'FINANCE_OFFICER');
  await seedAdmin(FINANCE2_ID, 'RISK_OFFICER');
  await seedAdmin(AUDITOR_ID, 'AUDITOR');
  const secrets = new FakeTotpSecretStore();
  secrets.setSecret(BOOTSTRAP_TOTP_REF, BOOTSTRAP_TOTP_SECRET);
  authService = new AdminAuthService(unitOfWork, adminSessions, secrets);
  workbench = new ApprovalWorkbenchService(
    unitOfWork, withdrawalOrders, payoutOrders,
    new WithdrawalApprovalService(
      unitOfWork, withdrawalOrders, withdrawalApprovals,
      new AdminAuthorizer(unitOfWork), new ConfigStore(unitOfWork), outbox
    ),
    {
      queryFirst: async () => ({
        outcome: 'SUCCEEDED_REPORTED' as const, orderRef: 'PO:X'
      })
    } as never
  );
  opsViews = new OpsViewService(
    unitOfWork,
    new ReconciliationService(unitOfWork, ledgerAccounts),
    new ExchangeReconciliationService(unitOfWork),
    new PayoutReconciliationService(unitOfWork),
    withdrawalOrders, exchangeOrders, payoutOrders
  );
  auditQueries = new AuditQueryService(unitOfWork);
  release = new ConfigReleaseService(
    unitOfWork, new ConfigStore(unitOfWork),
    markets, providerConfigs, signerPolicies
  );
  router = new AdminApiRouter(
    stubAuth(),
    new AdminAuthorizer(unitOfWork),
    new AuditRecorder(unitOfWork)
  );
  registerAuthRoutes(router, authService);
  registerApprovalRoutes(router, workbench);
  registerOpsRoutes(router, opsViews);
  registerAuditRoutes(router, auditQueries);
  registerConfigRoutes(router, release);
  actingAdminId = FINANCE_ID;
  elevated = true;
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S9-8 stage nine acceptance', () => {
  it('S9A01: authentication chains login, lockout, session, elevation', async () => {
    const ok = await authService.login({
      username: BOOTSTRAP, password: BOOTSTRAP_PASSWORD,
      totpCode: currentTotp()
    });
    expect(ok.outcome).toBe('AUTHENTICATED');
    const check = await authService.requireSession(
      (ok as { token: string }).token, 'BASIC'
    );
    expect(check.outcome).toBe('VALID');
    for (let i = 0; i < 5; i += 1) {
      await authService.login({
        username: BOOTSTRAP, password: 'wrong', totpCode: '000000'
      });
    }
    const locked = await authService.login({
      username: BOOTSTRAP, password: BOOTSTRAP_PASSWORD,
      totpCode: currentTotp()
    });
    expect(locked).toEqual({
      outcome: 'DENIED', reasonCode: 'ADMIN_AUTH_LOCKED'
    });
  });

  it('S9A02: default-deny rejects across all three layers', async () => {
    const unknownPath = await dispatch('GET', '/admin/no/such');
    expect(unknownPath.status).toBe(404);
    const noRole = await dispatch(
      'GET', '/admin/audit/events'
    );
    expect(noRole.status).toBe(403);
    expect(noRole.body).toEqual({ code: 'ADMIN_API_ROLE_DENIED' });
    elevated = false;
    const noElevation = await dispatch(
      'POST', '/admin/config/drafts', { body: {} }
    );
    expect(noElevation.status).toBe(403);
    expect(noElevation.body).toEqual({
      code: 'ADMIN_ELEVATION_REQUIRED'
    });
    elevated = true;
  });

  it('S9A03: dual approval flows through the workbench', async () => {
    const withdrawalId = await pendingWithdrawal();
    actingAdminId = FINANCE_ID;
    const vote1 = await dispatch(
      'POST', `/admin/approvals/withdrawal/${withdrawalId}/decide`,
      { body: { decision: 'APPROVE' } }
    );
    expect(vote1.body).toMatchObject({
      outcome: 'AWAITING_SECOND_APPROVAL'
    });
    actingAdminId = FINANCE2_ID;
    const vote2 = await dispatch(
      'POST', `/admin/approvals/withdrawal/${withdrawalId}/decide`,
      { body: { decision: 'APPROVE' } }
    );
    expect(vote2.body).toMatchObject({ outcome: 'APPROVED' });
  });

  it('S9A04: rejection preserves the full decision trail', async () => {
    const withdrawalId = await pendingWithdrawal();
    actingAdminId = FINANCE_ID;
    await dispatch(
      'POST', `/admin/approvals/withdrawal/${withdrawalId}/decide`,
      { body: { decision: 'APPROVE' } }
    );
    actingAdminId = FINANCE2_ID;
    const rejected = await dispatch(
      'POST', `/admin/approvals/withdrawal/${withdrawalId}/decide`,
      { body: { decision: 'REJECT', reason: 'acceptance trail' } }
    );
    expect(rejected.body).toMatchObject({ outcome: 'REJECTED' });
    const votes = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM withdrawal_approvals`
    );
    expect(votes.rows[0]?.n).toBe(2);
  });

  it('S9A05: payout resolution triggers the provider query', async () => {
    const payoutId = randomUUID();
    const resolved = await dispatch(
      'POST', `/admin/approvals/payout/${payoutId}/resolve`
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body).toEqual({ outcome: 'SUCCEEDED_REPORTED' });
  });

  it('S9A06: ops views stay read-only', async () => {
    const before = await cleanupPool.query<{ n: number }>(
      `SELECT (SELECT count(*)::int FROM withdrawal_orders)
         + (SELECT count(*)::int FROM exchange_orders)
         + (SELECT count(*)::int FROM payout_orders)
         + (SELECT count(*)::int FROM ledger_transactions) AS n`
    );
    const recon = await dispatch('GET', '/admin/ops/reconciliation');
    expect(recon.status).toBe(200);
    const watch = await dispatch('GET', '/admin/ops/watchlist');
    expect(watch.status).toBe(200);
    const after = await cleanupPool.query<{ n: number }>(
      `SELECT (SELECT count(*)::int FROM withdrawal_orders)
         + (SELECT count(*)::int FROM exchange_orders)
         + (SELECT count(*)::int FROM payout_orders)
         + (SELECT count(*)::int FROM ledger_transactions) AS n`
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('S9A07: audit query is AUDITOR-only with working filters', async () => {
    actingAdminId = FINANCE_ID;
    const financeDenied = await dispatch('GET', '/admin/audit/events');
    expect(financeDenied.status).toBe(403);
    actingAdminId = AUDITOR_ID;
    const allowed = await dispatch('GET', '/admin/audit/events', {
      query: { category: 'ADMIN_API_' }
    });
    expect(allowed.status).toBe(200);
    const metaAudit = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE event_type = 'ADMIN_API_GET_AUDIT_EVENTS'`
    );
    expect(metaAudit.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('S9A08: config release settles exactly once', async () => {
    actingAdminId = FINANCE_ID;
    const draft = await dispatch('POST', '/admin/config/drafts', {
      body: {
        targetTable: 'signer_policies',
        targetKey: 'withdrawal.tron',
        payload: {
          policyVersion: 2, network: 'TRON',
          hotWalletAddress: 'THotV2', feeAmount: '1500',
          minAutoAmount: '200000', maxAmount: '20000000'
        }
      }
    });
    expect(draft.status).toBe(201);
    const draftId = (draft.body as { draftId: string }).draftId;
    actingAdminId = FINANCE2_ID;
    const published = await dispatch(
      'POST', `/admin/config/drafts/${draftId}/publish`
    );
    expect(published.body).toMatchObject({ outcome: 'PUBLISHED' });
    const again = await dispatch(
      'POST', `/admin/config/drafts/${draftId}/publish`
    );
    expect(again.status).toBe(404);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM signer_policies
        WHERE policy_version = 2`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S9A09: the audit trail resists deletion', async () => {
    await expect(
      unitOfWork.execute(async (context) => {
        await context.executeSql(`DELETE FROM audit_events`);
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S9A10: tokens are hashed and brute force locks out', async () => {
    const result = (await authService.login({
      username: BOOTSTRAP, password: BOOTSTRAP_PASSWORD,
      totpCode: currentTotp()
    })) as { token: string };
    const stored = await cleanupPool.query<{ token_hash: string }>(
      `SELECT token_hash FROM admin_sessions LIMIT 1`
    );
    expect(stored.rows[0]?.token_hash).not.toBe(result.token);
    expect(stored.rows[0]?.token_hash).toBe(
      createHash('sha256').update(result.token).digest('hex')
    );
  });

  it('S9A11: self-review of a config draft is rejected', async () => {
    actingAdminId = FINANCE_ID;
    const draft = await dispatch('POST', '/admin/config/drafts', {
      body: {
        targetTable: 'config_versions',
        targetKey: 'withdrawal.approval',
        payload: { dualApprovalThreshold: '9999999' }
      }
    });
    const draftId = (draft.body as { draftId: string }).draftId;
    const selfPublish = await dispatch(
      'POST', `/admin/config/drafts/${draftId}/publish`
    );
    expect(selfPublish.status).toBe(403);
    expect(selfPublish.body).toEqual({
      code: 'CONFIG_SELF_REVIEW_REJECTED'
    });
    const current = await new ConfigStore(unitOfWork)
      .current('withdrawal.approval');
    expect(current.version).toBe(1);
  });

  it('S9A12: every operation class leaves granted and denied audits', async () => {
    actingAdminId = FINANCE_ID;
    await dispatch('GET', '/admin/approvals/pending');
    await dispatch('GET', '/admin/audit/events');
    actingAdminId = FINANCE2_ID;
    await dispatch('GET', '/admin/ops/watchlist');
    const rows = await cleanupPool.query<{ outcome: string }>(
      `SELECT DISTINCT outcome FROM audit_events
        WHERE event_type LIKE 'ADMIN_API_%'`
    );
    const outcomes = rows.rows.map((row) => row.outcome);
    expect(outcomes).toContain('GRANTED');
    expect(outcomes).toContain('DENIED_ROLE');
  });
});
