import type { AdminApiResponse } from '@xht/contracts';
import type { AdminApiRouter } from './admin-api.router.js';
import type {
  AdminAuthService
} from '../application/admin-auth.service.js';

interface LoginBody {
  readonly username?: unknown;
  readonly password?: unknown;
  readonly totpCode?: unknown;
}

interface ElevationBody {
  readonly password?: unknown;
  readonly totpCode?: unknown;
}

function badRequest(): AdminApiResponse {
  return { status: 400, body: { code: 'ADMIN_AUTH_INVALID' } };
}

/**
 * Registers the authentication endpoints on the admin API base.
 * Login is the single public route and audits its own failures;
 * everything else requires an authenticated session.
 */
export function registerAuthRoutes(
  router: AdminApiRouter,
  auth: AdminAuthService
): void {
  router.register('POST', '/admin/auth/session', {
    requiredLevel: 'BASIC',
    eventType: 'ADMIN_API_POST_AUTH_SESSION',
    handler: async () => badRequest(),
    publicHandler: async ({ body }) => {
      const input = body as LoginBody;
      if (
        typeof input?.username !== 'string' ||
        typeof input?.password !== 'string' ||
        typeof input?.totpCode !== 'string'
      ) {
        return badRequest();
      }
      const result = await auth.login({
        username: input.username,
        password: input.password,
        totpCode: input.totpCode
      });
      if (result.outcome === 'DENIED') {
        return { status: 401, body: { code: result.reasonCode } };
      }
      return {
        status: 200,
        body: { token: result.token, expiresAt: result.expiresAt }
      };
    }
  });

  router.register('DELETE', '/admin/auth/session', {
    requiredLevel: 'BASIC',
    eventType: 'ADMIN_API_DELETE_AUTH_SESSION',
    handler: async ({ bearerToken }) => {
      await auth.logout(bearerToken);
      return { status: 204, body: null };
    }
  });

  router.register('POST', '/admin/auth/elevation', {
    requiredLevel: 'BASIC',
    eventType: 'ADMIN_API_POST_AUTH_ELEVATION',
    handler: async ({ bearerToken, body }) => {
      const input = body as ElevationBody;
      if (
        typeof input?.password !== 'string' ||
        typeof input?.totpCode !== 'string'
      ) {
        return badRequest();
      }
      const result = await auth.elevate({
        sessionToken: bearerToken,
        password: input.password,
        totpCode: input.totpCode
      });
      if (result.outcome === 'DENIED') {
        return { status: 401, body: { code: result.reasonCode } };
      }
      return { status: 200, body: { session: result.session } };
    }
  });

  router.register('GET', '/admin/auth/whoami', {
    requiredLevel: 'BASIC',
    eventType: 'ADMIN_API_GET_AUTH_WHOAMI',
    handler: async ({ session }) => ({
      status: 200,
      body: {
        adminId: session.adminId,
        expiresAt: session.expiresAt,
        elevatedUntil: session.elevatedUntil
      }
    })
  });
}

Object.freeze(registerAuthRoutes.prototype);
