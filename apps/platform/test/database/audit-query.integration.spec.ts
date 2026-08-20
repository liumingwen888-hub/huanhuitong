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
  AdminAuthorizer
} from '../../src/modules/crosscutting/application/crosscutting.services.js';
import {
  AuditQueryService
} from '../../src/modules/admin/application/audit-query.service.js';
import {
  AdminApiRouter
} from '../../src/modules/admin/http/admin-api.router.js';
import {
  registerAuditRoutes
} from '../../src/modules/admin/http/admin-audit.routes.js';
import {
  AuditRecorder
} from '../../src/modules/admin/application/audit-recorder.js';
import {
  AdminAuthService
} from '../../src/modules/admin/application/admin-auth.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const AUDITOR_ID = '22222222-3333-4444-5555-666677778888';

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
let queries: AuditQueryService;
let router: AdminApiRouter;
let recorder: AuditRecorder;

const AUDITOR_SESSION: AdminSessionSnapshot = Object.freeze({
  sessionId: 'session-auditor',
  adminId: AUDITOR_ID,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  elevatedUntil: null,
  revokedAt: null
});

function stubAuth(): AdminAuthService {
  return {
    login: async () => {
      throw new Error('not used');
    },
    logout: async () => undefined,
    elevate: async () => ({
      outcome: 'VALID' as const,
      session: AUDITOR_SESSION
    }),
    requireSession: async (token: string) => {
      if (token === 'auditor-token') {
        return { outcome: 'VALID' as const, session: AUDITOR_SESSION };
      }
      return {
        outcome: 'DENIED' as const,
        reasonCode: 'ADMIN_SESSION_INVALID' as const
      };
    }
  } as unknown as AdminAuthService;
}

async function seedEvents(): Promise<void> {
  const base = Date.now() - 60 * 60_000;
  const rows: [string, string, string, string, number][] = [
    ['ADMIN_API_GET_OPS_WATCHLIST', 'ADMIN', AUDITOR_ID, 'GRANTED', 0],
    ['ADMIN_API_GET_OPS_WATCHLIST', 'ADMIN', AUDITOR_ID, 'GRANTED', 1],
    ['WITHDRAWAL_REQUESTED', 'USER', 'uid-1', 'OK', 2],
    ['ADMIN_API_GET_APPROVALS_PENDING', 'ANONYMOUS', 'anonymous',
     'DENIED_SESSION', 3],
    ['PAYOUT_CALLBACK_INGESTED', 'SYSTEM', 'fake-bank-v1', 'OK', 4]
  ];
  for (const [eventType, actorType, actorRef, outcome, offsetMin] of rows) {
    await cleanupPool.query(
      `INSERT INTO audit_events
         (event_type, actor_type, actor_ref, subject_ref, outcome,
          correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6::uuid,
               clock_timestamp() - ($7 || ' minutes')::interval)`,
      [eventType, actorType, actorRef, 'subject', outcome,
        randomUUID(), String(60 - offsetMin)]
    );
  }
  void base;
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
    max: 1, application_name: 'xht-s95-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s95-platform'
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
  await cleanupPool.query(`DELETE FROM audit_events`);
  await cleanupPool.query(
    `DELETE FROM admin_role_grants WHERE admin_id = $1::uuid`,
    [AUDITOR_ID]
  );
  await seedEvents();
  queries = new AuditQueryService(unitOfWork);
  recorder = new AuditRecorder(unitOfWork);
  router = new AdminApiRouter(
    stubAuth(),
    new AdminAuthorizer(unitOfWork),
    recorder
  );
  registerAuditRoutes(router, queries);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

async function grantAuditor(): Promise<void> {
  await cleanupPool.query(
    `INSERT INTO admin_principals (admin_id, status)
     VALUES ($1::uuid, 'ACTIVE')
     ON CONFLICT (admin_id) DO NOTHING`,
    [AUDITOR_ID]
  );
  await cleanupPool.query(
    `INSERT INTO admin_role_grants (admin_id, role)
     VALUES ($1::uuid, 'AUDITOR')`,
    [AUDITOR_ID]
  );
}

async function dispatch(query: Record<string, string> = {}) {
  return router.dispatch({
    method: 'GET',
    path: '/admin/audit/events',
    bearerToken: 'auditor-token',
    query
  });
}

describe.sequential('S9-5 audit query', () => {
  it('S9AQ01: time-window filters are precise', async () => {
    await grantAuditor();
    const all = await dispatch();
    expect(all.status).toBe(200);
    const items = (all.body as { items: unknown[] }).items;
    expect(items).toHaveLength(5);
    const from = new Date(Date.now() - 60 * 60_000 + 90_000);
    const recent = await dispatch({
      from: from.toISOString()
    });
    const recentItems = (recent.body as { items: unknown[] }).items;
    expect(recentItems.length).toBeLessThan(5);
    const invalid = await dispatch({ from: 'not-a-date' });
    expect(invalid.status).toBe(400);
  });

  it('S9AQ02: actor filters match exactly', async () => {
    await grantAuditor();
    const anonymous = await dispatch({ actor: 'anonymous' });
    const items = (anonymous.body as {
      items: { actorRef: string }[];
    }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.actorRef).toBe('anonymous');
    const auditor = await dispatch({
      actor: AUDITOR_ID, category: 'ADMIN_API_'
    });
    const auditorItems = (auditor.body as {
      items: { eventType: string }[];
    }).items;
    expect(
      auditorItems.filter(
        (item) => item.eventType === 'ADMIN_API_GET_OPS_WATCHLIST'
      )
    ).toHaveLength(2);
    const badActor = await dispatch({ actor: 'DROP TABLE' });
    expect(badActor.status).toBe(400);
  });

  it('S9AQ03: category filters use the whitelist only', async () => {
    await grantAuditor();
    const adminApi = await dispatch({ category: 'ADMIN_API_' });
    expect(
      (adminApi.body as { items: unknown[] }).items
    ).toHaveLength(3);
    const payouts = await dispatch({ category: 'PAYOUT_' });
    expect(
      (payouts.body as { items: unknown[] }).items
    ).toHaveLength(1);
    const forbidden = await dispatch({ category: "%'; DROP" });
    expect(forbidden.status).toBe(400);
  });

  it('S9AQ04: keyset pagination never overlaps or skips', async () => {
    await grantAuditor();
    for (let i = 0; i < 60; i += 1) {
      await cleanupPool.query(
        `INSERT INTO audit_events
           (event_type, actor_type, actor_ref, subject_ref, outcome,
            correlation_id, occurred_at)
         VALUES ('ADMIN_API_TEST_FILL', 'SYSTEM', 'fill', 'fill', 'OK',
                 $1::uuid, clock_timestamp())`,
        [randomUUID()]
      );
    }
    const page1 = await dispatch({ limit: '30' });
    expect(page1.status).toBe(200);
    const body1 = page1.body as {
      items: { auditEventId: string }[];
      nextCursor: string;
    };
    expect(body1.items).toHaveLength(30);
    expect(body1.nextCursor).not.toBeNull();
    const page2 = await dispatch({ limit: '30', cursor: body1.nextCursor });
    const body2 = page2.body as {
      items: { auditEventId: string }[];
      nextCursor: string;
    };
    const ids1 = new Set(body1.items.map((item) => item.auditEventId));
    const ids2 = body2.items.map((item) => item.auditEventId);
    expect(ids2.every((id) => !ids1.has(id))).toBe(true);
    const allIds = new Set([...ids1, ...ids2]);
    const total = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events`
    );
    expect(allIds.size).toBe(body1.items.length + body2.items.length);
    expect(total.rows[0]?.n).toBeGreaterThanOrEqual(allIds.size);
    const overLimit = await dispatch({ limit: '500' });
    const overBody = overLimit.body as { items: unknown[] };
    expect(overBody.items.length).toBeLessThanOrEqual(200);
  });

  it('S9AQ05: only AUDITOR role may retrieve', async () => {
    const denied = await dispatch();
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ code: 'ADMIN_API_ROLE_DENIED' });
    await grantAuditor();
    const allowed = await dispatch();
    expect(allowed.status).toBe(200);
  });

  it('S9AQ06: retrieval itself is audited', async () => {
    await grantAuditor();
    await dispatch({ category: 'ADMIN_API_' });
    const rows = await cleanupPool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events
        WHERE event_type = 'ADMIN_API_GET_AUDIT_EVENTS'`
    );
    expect(rows.rows).toHaveLength(1);
  });
});
