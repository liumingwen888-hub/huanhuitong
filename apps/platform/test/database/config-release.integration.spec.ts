import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  AdminSessionSnapshot,
  StageOneDatabase
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
  AdminAuthorizer,
  ConfigStore
} from '../../src/modules/crosscutting/application/crosscutting.services.js';
import {
  PostgresMarketRepository
} from '../../src/modules/exchange/infrastructure/postgres-market.repository.js';
import {
  PostgresProviderConfigRepository
} from '../../src/modules/fiatpayout/infrastructure/postgres-payout.repository.js';
import {
  PostgresSignerPolicyRepository
} from '../../src/modules/withdrawals/infrastructure/postgres-withdrawal.repository.js';
import {
  ConfigReleaseService
} from '../../src/modules/admin/application/config-release.service.js';
import {
  AdminApiRouter
} from '../../src/modules/admin/http/admin-api.router.js';
import {
  registerConfigRoutes
} from '../../src/modules/admin/http/admin-config.routes.js';
import {
  AuditRecorder
} from '../../src/modules/admin/application/audit-recorder.js';
import {
  AdminAuthService
} from '../../src/modules/admin/application/admin-auth.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const markets = new PostgresMarketRepository();
const providers = new PostgresProviderConfigRepository();
const policies = new PostgresSignerPolicyRepository();
let configStore: ConfigStore;
let release: ConfigReleaseService;
let router: AdminApiRouter;

const MAKER_ID = '33333333-3333-4333-8333-333333333333';
const CHECKER_ID = '44444444-4444-4444-8444-444444444444';
let currentAdminId = MAKER_ID;

function sessionFor(adminId: string): AdminSessionSnapshot {
  return Object.freeze({
    sessionId: `session-${adminId.slice(0, 8)}`,
    adminId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    elevatedUntil: new Date(Date.now() + 300_000).toISOString(),
    revokedAt: null
  });
}

function stubAuth(): AdminAuthService {
  return {
    login: async () => {
      throw new Error('not used');
    },
    logout: async () => undefined,
    elevate: async () => ({
      outcome: 'VALID' as const,
      session: sessionFor(currentAdminId)
    }),
    requireSession: async (token: string) => {
      if (token === 'admin-token') {
        return {
          outcome: 'VALID' as const,
          session: sessionFor(currentAdminId)
        };
      }
      return {
        outcome: 'DENIED' as const,
        reasonCode: 'ADMIN_SESSION_INVALID' as const
      };
    }
  } as unknown as AdminAuthService;
}

async function grantRoles(): Promise<void> {
  for (const [adminId, role] of [
    [MAKER_ID, 'RISK_OFFICER'],
    [CHECKER_ID, 'RISK_OFFICER']
  ] as const) {
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
}

async function createDraft(targetTable: string, targetKey: string) {
  currentAdminId = MAKER_ID;
  const response = await router.dispatch({
    method: 'POST',
    path: '/admin/config/drafts',
    bearerToken: 'admin-token',
    body: {
      targetTable,
      targetKey,
      payload:
        targetTable === 'market_configs'
          ? {
              marketKey: targetKey,
              configVersion: 2,
              sellAssetCode: 'USDT-TRC20',
              buyAssetCode: 'USDT-ERC20',
              quoteScale: 8,
              spreadBp: 75,
              minSellAmount: '200000',
              maxSellAmount: '5000000000',
              quoteTtlSeconds: 30,
              deviationToleranceBp: 500
            }
          : targetTable === 'signer_policies'
            ? {
                policyVersion: 2,
                network: 'TRON',
                hotWalletAddress: 'THotWalletV2',
                feeAmount: '1500',
                minAutoAmount: '200000',
                maxAmount: '20000000'
              }
            : targetTable === 'config_versions'
              ? { dualApprovalThreshold: '5000000' }
              : {}
    }
  });
  expect(response.status).toBe(201);
  return (response.body as { draftId: string }).draftId;
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
    max: 1, application_name: 'xht-s96-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s96-platform'
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
    'audit_events', 'admin_sessions', 'config_versions',
    'admin_role_grants', 'admin_credentials', 'admin_principals',
    'market_configs', 'provider_configs', 'signer_policies'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
  await grantRoles();
  configStore = new ConfigStore(unitOfWork);
  release = new ConfigReleaseService(
    unitOfWork, configStore, markets, providers, policies
  );
  router = new AdminApiRouter(
    stubAuth(),
    new AdminAuthorizer(unitOfWork),
    new AuditRecorder(unitOfWork)
  );
  registerConfigRoutes(router, release);
  currentAdminId = MAKER_ID;
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S9-6 config release flow', () => {
  it('S9CR01: draft then publish activates a market config version', async () => {
    const draftId = await createDraft(
      'market_configs', 'USDT-TRC20:USDT-ERC20'
    );
    currentAdminId = CHECKER_ID;
    const publish = await router.dispatch({
      method: 'POST',
      path: `/admin/config/drafts/${draftId}/publish`,
      bearerToken: 'admin-token'
    });
    expect(publish.status).toBe(200);
    expect(publish.body).toMatchObject({ outcome: 'PUBLISHED' });
    const active = await unitOfWork.execute((c) =>
      markets.findActive(c, 'USDT-TRC20:USDT-ERC20')
    );
    expect(active?.spreadBp).toBe(75);
  });

  it('S9CR02: the maker cannot settle their own draft', async () => {
    const draftId = await createDraft(
      'market_configs', 'USDT-TRC20:USDT-ERC20'
    );
    currentAdminId = MAKER_ID;
    const selfPublish = await router.dispatch({
      method: 'POST',
      path: `/admin/config/drafts/${draftId}/publish`,
      bearerToken: 'admin-token'
    });
    expect(selfPublish.status).toBe(403);
    expect(selfPublish.body).toEqual({
      code: 'CONFIG_SELF_REVIEW_REJECTED'
    });
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM market_configs
        WHERE market_key = 'USDT-TRC20:USDT-ERC20'`
    );
    expect(count.rows[0]?.n).toBe(0);
  });

  it('S9CR03: rejection leaves the target untouched but audited', async () => {
    const draftId = await createDraft(
      'signer_policies', 'withdrawal.tron'
    );
    currentAdminId = CHECKER_ID;
    const reject = await router.dispatch({
      method: 'POST',
      path: `/admin/config/drafts/${draftId}/reject`,
      bearerToken: 'admin-token'
    });
    expect(reject.status).toBe(200);
    expect(reject.body).toEqual({ outcome: 'REJECTED' });
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM signer_policies`
    );
    expect(count.rows[0]?.n).toBe(0);
    const drafts = await release.listDrafts();
    expect(drafts).toHaveLength(0);
  });

  it('S9CR04: a draft settles exactly once', async () => {
    const draftId = await createDraft(
      'signer_policies', 'withdrawal.tron'
    );
    currentAdminId = CHECKER_ID;
    const first = await router.dispatch({
      method: 'POST',
      path: `/admin/config/drafts/${draftId}/publish`,
      bearerToken: 'admin-token'
    });
    expect(first.status).toBe(200);
    const second = await router.dispatch({
      method: 'POST',
      path: `/admin/config/drafts/${draftId}/publish`,
      bearerToken: 'admin-token'
    });
    expect(second.status).toBe(404);
    const count = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM signer_policies
        WHERE policy_version = 2`
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it('S9CR05: non-whitelisted targets are rejected', async () => {
    const response = await router.dispatch({
      method: 'POST',
      path: '/admin/config/drafts',
      bearerToken: 'admin-token',
      body: { targetTable: 'users', targetKey: 'hack', payload: {} }
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'CONFIG_TARGET_INVALID' });
  });

  it('S9CR06: maker and checker identities both land in the audit', async () => {
    const draftId = await createDraft(
      'market_configs', 'USDT-TRC20:USDT-ERC20'
    );
    currentAdminId = CHECKER_ID;
    await router.dispatch({
      method: 'POST',
      path: `/admin/config/drafts/${draftId}/publish`,
      bearerToken: 'admin-token'
    });
    const events = await cleanupPool.query<{
      event_type: string;
      actor_ref: string;
      outcome: string;
    }>(
      `SELECT event_type, actor_ref, outcome FROM audit_events
        WHERE event_type LIKE 'ADMIN_API_%CONFIG%'`
    );
    const byType = new Map(events.rows.map((r) => [r.event_type, r]));
    expect(byType.get('ADMIN_API_POST_CONFIG_DRAFTS')?.actor_ref)
      .toBe(MAKER_ID);
    expect(byType.get('ADMIN_API_POST_CONFIG_DRAFTS_PUBLISH')?.actor_ref)
      .toBe(CHECKER_ID);
    expect(
      byType.get('ADMIN_API_POST_CONFIG_DRAFTS_PUBLISH')?.outcome
    ).toBe('GRANTED');
  });

  it('S9CR07: business config keys publish through ConfigStore', async () => {
    const draftId = await createDraft(
      'config_versions', 'withdrawal.approval'
    );
    currentAdminId = CHECKER_ID;
    const publish = await router.dispatch({
      method: 'POST',
      path: `/admin/config/drafts/${draftId}/publish`,
      bearerToken: 'admin-token'
    });
    expect(publish.status).toBe(200);
    const current = await configStore.current('withdrawal.approval');
    expect(current.payload).toMatchObject({
      dualApprovalThreshold: '5000000'
    });
    expect(current.version).toBe(1);
  });
});
