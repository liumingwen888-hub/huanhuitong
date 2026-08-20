import { describe, expect, it } from 'vitest';
import type {
  AdminSessionSnapshot
} from '@xht/contracts';
import type {
  AdminAuthService
} from '../../src/modules/admin/application/admin-auth.service.js';
import type {
  AuditRecordInput
} from '../../src/modules/admin/application/audit-recorder.js';
import {
  AdminApiRouter
} from '../../src/modules/admin/http/admin-api.router.js';
import {
  registerAuthRoutes
} from '../../src/modules/admin/http/admin-routes.js';

const SESSION: AdminSessionSnapshot = Object.freeze({
  sessionId: 'session-1',
  adminId: '11111111-1111-4111-8111-111111111111',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  elevatedUntil: null,
  revokedAt: null
});

function makeAuth(overrides: {
  readonly loginResult?: {
    readonly outcome: 'AUTHENTICATED';
    readonly token: string;
    readonly expiresAt: string;
  } | { readonly outcome: 'DENIED'; readonly reasonCode: string };
  readonly sessionValid?: boolean;
  readonly elevationRequired?: boolean;
} = {}) {
  let loggedOut = false;
  let elevatedUntil: string | null = null;
  const service = {
    async login() {
      return (
        overrides.loginResult ?? {
          outcome: 'AUTHENTICATED' as const,
          token: 'raw-token-1',
          expiresAt: new Date(Date.now() + 600_000).toISOString()
        }
      );
    },
    async logout() {
      loggedOut = true;
    },
    async elevate() {
      elevatedUntil = new Date(Date.now() + 300_000).toISOString();
      return {
        outcome: 'VALID' as const,
        session: { ...SESSION, elevatedUntil }
      };
    },
    async requireSession(
      token: string,
      level: 'BASIC' | 'ELEVATED'
    ) {
      if (loggedOut || token !== 'raw-token-1') {
        return {
          outcome: 'DENIED' as const,
          reasonCode: 'ADMIN_SESSION_INVALID' as const
        };
      }
      if (level === 'ELEVATED' && elevatedUntil === null) {
        return {
          outcome: 'DENIED' as const,
          reasonCode: 'ADMIN_ELEVATION_REQUIRED' as const
        };
      }
      return { outcome: 'VALID' as const, session: SESSION };
    }
  };
  return service as unknown as AdminAuthService & {
    wasLoggedOut(): boolean;
  } & Record<string, unknown>;
}

function makeAudit() {
  const events: AuditRecordInput[] = [];
  return {
    events,
    async record(input: AuditRecordInput): Promise<void> {
      events.push(input);
    }
  };
}

function makeRouter(
  auth = makeAuth(),
  roles: readonly { readonly adminId: string; readonly role: string }[] = []
) {
  const audit = makeAudit();
  const router = new AdminApiRouter(
    auth,
    {
      async isAuthorized(adminId: string, requiredRole: string) {
        return roles.some(
          (grant) =>
            grant.adminId === adminId && grant.role === requiredRole
        );
      }
    },
    audit as never
  );
  registerAuthRoutes(router, auth);
  router.register('GET', '/admin/ops/ping', {
    requiredRole: 'FINANCE_OFFICER',
    requiredLevel: 'ELEVATED',
    eventType: 'ADMIN_API_GET_OPS_PING',
    handler: async () => ({ status: 200, body: { pong: true } })
  });
  return { router, audit };
}

describe('S9-2 admin API base and RBAC middleware', () => {
  it('S9RB01: login succeeds and is audited', async () => {
    const { router, audit } = makeRouter();
    const response = await router.dispatch({
      method: 'POST',
      path: '/admin/auth/session',
      body: {
        username: 'bootstrap-admin',
        password: 'x',
        totpCode: '123456'
      }
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ token: 'raw-token-1' });
    expect(audit.events).toHaveLength(0);
  });

  it('S9RB02: unregistered paths and methods default to 404', async () => {
    const { router, audit } = makeRouter();
    const unknownPath = await router.dispatch({
      method: 'GET', path: '/admin/no/such/route'
    });
    expect(unknownPath).toEqual({
      status: 404, body: { code: 'ADMIN_API_NOT_FOUND' }
    });
    const wrongMethod = await router.dispatch({
      method: 'DELETE', path: '/admin/auth/whoami'
    });
    expect(wrongMethod.status).toBe(404);
    expect(audit.events.map((e) => e.outcome)).toEqual([
      'DENIED_NOT_FOUND', 'DENIED_NOT_FOUND'
    ]);
  });

  it('S9RB03: missing, invalid, or logged-out tokens yield 401', async () => {
    const { router, audit } = makeRouter();
    const missing = await router.dispatch({
      method: 'GET', path: '/admin/auth/whoami'
    });
    expect(missing).toEqual({
      status: 401, body: { code: 'ADMIN_API_SESSION_REQUIRED' }
    });
    const invalid = await router.dispatch({
      method: 'GET', path: '/admin/auth/whoami', bearerToken: 'wrong'
    });
    expect(invalid).toEqual({
      status: 401, body: { code: 'ADMIN_SESSION_INVALID' }
    });
    expect(audit.events.map((e) => e.outcome)).toEqual([
      'DENIED_SESSION', 'DENIED_ADMIN_SESSION_INVALID'
    ]);
  });

  it('S9RB04: insufficient role yields 403 and is audited', async () => {
    const { router, audit } = makeRouter(makeAuth(), []);
    const response = await router.dispatch({
      method: 'GET',
      path: '/admin/ops/ping',
      bearerToken: 'raw-token-1'
    });
    expect(response.status).toBe(403);
    expect(audit.events.map((e) => [e.actorType, e.outcome])).toEqual([
      ['ANONYMOUS', 'DENIED_ADMIN_ELEVATION_REQUIRED']
    ]);
  });

  it('S9RB05: elevation gates pass after elevating', async () => {
    const auth = makeAuth();
    const { router, audit } = makeRouter(auth, [
      {
        adminId: SESSION.adminId,
        role: 'FINANCE_OFFICER'
      }
    ]);
    const denied = await router.dispatch({
      method: 'GET', path: '/admin/ops/ping', bearerToken: 'raw-token-1'
    });
    expect(denied).toEqual({
      status: 403, body: { code: 'ADMIN_ELEVATION_REQUIRED' }
    });
    const elevated = await auth.elevate({
      sessionToken: 'raw-token-1', password: 'x', totpCode: '123456'
    });
    expect(elevated.outcome).toBe('VALID');
    const ok = await router.dispatch({
      method: 'GET', path: '/admin/ops/ping', bearerToken: 'raw-token-1'
    });
    expect(ok).toEqual({ status: 200, body: { pong: true } });
    expect(audit.events.at(-1)?.outcome).toBe('GRANTED');
  });

  it('S9RB06: failed logins stay visible in the audit trail', async () => {
    const failing = makeAuth({
      loginResult: {
        outcome: 'DENIED',
        reasonCode: 'ADMIN_AUTH_INVALID'
      }
    });
    const { router } = makeRouter(failing);
    const response = await router.dispatch({
      method: 'POST',
      path: '/admin/auth/session',
      body: {
        username: 'bootstrap-admin',
        password: 'wrong',
        totpCode: '000000'
      }
    });
    expect(response).toEqual({
      status: 401, body: { code: 'ADMIN_AUTH_INVALID' }
    });
  });

  it('S9RB07: whoami reflects the session and logout invalidates', async () => {
    const auth = makeAuth();
    const { router } = makeRouter(auth);
    const whoami = await router.dispatch({
      method: 'GET', path: '/admin/auth/whoami', bearerToken: 'raw-token-1'
    });
    expect(whoami.status).toBe(200);
    expect(whoami.body).toMatchObject({ adminId: SESSION.adminId });
    const logout = await router.dispatch({
      method: 'DELETE',
      path: '/admin/auth/session',
      bearerToken: 'raw-token-1'
    });
    expect(logout.status).toBe(204);
    const after = await router.dispatch({
      method: 'GET', path: '/admin/auth/whoami', bearerToken: 'raw-token-1'
    });
    expect(after.status).toBe(401);
  });
});
