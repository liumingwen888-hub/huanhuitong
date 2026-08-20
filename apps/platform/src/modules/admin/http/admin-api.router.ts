import { randomUUID } from 'node:crypto';
import type {
  AdminApiRequest,
  AdminApiResponse,
  AdminSessionSnapshot
} from '@xht/contracts';
import type {
  AdminAuthService,
  SessionRequirement
} from '../application/admin-auth.service.js';
import type { AuditRecorder } from '../application/audit-recorder.js';

export interface AdminAuthorizerPort {
  isAuthorized(adminId: string, requiredRole: string): Promise<boolean>;
}

export interface AdminRouteContext {
  readonly session: AdminSessionSnapshot;
  readonly body: unknown;
  readonly bearerToken: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface PublicRouteContext {
  readonly body: unknown;
  readonly params: Readonly<Record<string, string>>;
}

export interface RouteDefinition {
  /** undefined = any authenticated admin */
  readonly requiredRole?: string;
  readonly requiredLevel: SessionRequirement;
  readonly handler: (
    context: AdminRouteContext
  ) => Promise<AdminApiResponse>;
  readonly publicHandler?: (
    context: PublicRouteContext
  ) => Promise<AdminApiResponse>;
  readonly eventType: string;
}

/**
 * Framework-agnostic admin API router: routes exist only where
 * explicitly registered (default deny — an unregistered path is a
 * 404, never an implicit allow), every request passes the fixed
 * middleware chain session → role → elevation → audit → handler,
 * and denied requests are audited with the same rigor as granted
 * ones so brute-force attempts stay visible.
 */
export class AdminApiRouter {
  readonly #routes = new Map<string, RouteDefinition>();
  readonly #auth: AdminAuthService;
  readonly #authorizer: AdminAuthorizerPort;
  readonly #audit: AuditRecorder;

  constructor(
    auth: AdminAuthService,
    authorizer: AdminAuthorizerPort,
    audit: AuditRecorder
  ) {
    this.#auth = auth;
    this.#authorizer = authorizer;
    this.#audit = audit;
  }

  public register(
    method: AdminApiRequest['method'],
    path: string,
    definition: RouteDefinition
  ): void {
    this.#routes.set(`${method} ${path}`, definition);
  }

  /** Exact match first, then single-segment :param patterns. */
  #match(
    method: AdminApiRequest['method'],
    path: string
  ): { definition: RouteDefinition; params: Record<string, string> } | undefined {
    const exact = this.#routes.get(`${method} ${path}`);
    if (exact !== undefined) {
      return { definition: exact, params: {} };
    }
    const segments = path.split('/').filter((part) => part !== '');
    for (const [key, definition] of this.#routes) {
      const [routeMethod, routePath] = key.split(' ');
      if (routeMethod !== method || routePath === undefined) {
        continue;
      }
      const routeSegments = routePath
        .split('/')
        .filter((part) => part !== '');
      if (routeSegments.length !== segments.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let matched = true;
      for (const [index, routeSegment] of routeSegments.entries()) {
        if (routeSegment.startsWith(':')) {
          params[routeSegment.slice(1)] = segments[index]!;
        } else if (routeSegment !== segments[index]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return { definition, params };
      }
    }
    return undefined;
  }

  public async dispatch(
    request: AdminApiRequest
  ): Promise<AdminApiResponse> {
    const correlationId = randomUUID();
    const match = this.#match(request.method, request.path);
    const route = match?.definition;
    const params = match?.params ?? {};
    if (route === undefined) {
      await this.#audit.record({
        eventType: `ADMIN_API_${request.method}_NOT_FOUND`,
        actorType: 'ANONYMOUS',
        actorRef: 'anonymous',
        subjectRef: request.path,
        outcome: 'DENIED_NOT_FOUND',
        correlationId
      });
      return { status: 404, body: { code: 'ADMIN_API_NOT_FOUND' } };
    }
    if (route.publicHandler !== undefined) {
      const response = await route.publicHandler({
        body: request.body,
        params
      });
      return response;
    }
    const token = request.bearerToken;
    if (token === undefined || token === '') {
      await this.#audit.record({
        eventType: route.eventType,
        actorType: 'ANONYMOUS',
        actorRef: 'anonymous',
        subjectRef: request.path,
        outcome: 'DENIED_SESSION',
        correlationId
      });
      return {
        status: 401,
        body: { code: 'ADMIN_API_SESSION_REQUIRED' }
      };
    }
    const check = await this.#auth.requireSession(
      token,
      route.requiredLevel
    );
    if (check.outcome === 'DENIED') {
      await this.#audit.record({
        eventType: route.eventType,
        actorType: 'ANONYMOUS',
        actorRef: 'anonymous',
        subjectRef: request.path,
        outcome: `DENIED_${check.reasonCode}`,
        correlationId
      });
      const status =
        check.reasonCode === 'ADMIN_ELEVATION_REQUIRED' ? 403 : 401;
      return { status, body: { code: check.reasonCode } };
    }
    if (route.requiredRole !== undefined) {
      const authorized = await this.#authorizer.isAuthorized(
        check.session.adminId,
        route.requiredRole
      );
      if (!authorized) {
        await this.#audit.record({
          eventType: route.eventType,
          actorType: 'ADMIN',
          actorRef: check.session.adminId,
          subjectRef: request.path,
          outcome: 'DENIED_ROLE',
          correlationId
        });
        return { status: 403, body: { code: 'ADMIN_API_ROLE_DENIED' } };
      }
    }
    const response = await route.handler({
      session: check.session,
      body: request.body,
      bearerToken: token,
      params,
      query: request.query ?? {}
    });
    await this.#audit.record({
      eventType: route.eventType,
      actorType: 'ADMIN',
      actorRef: check.session.adminId,
      subjectRef: request.path,
      outcome: 'GRANTED',
      correlationId
    });
    return response;
  }
}

Object.freeze(AdminApiRouter.prototype);
