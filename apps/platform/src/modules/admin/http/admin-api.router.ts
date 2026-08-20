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
}

export interface PublicRouteContext {
  readonly body: unknown;
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

  public async dispatch(
    request: AdminApiRequest
  ): Promise<AdminApiResponse> {
    const correlationId = randomUUID();
    const route = this.#routes.get(`${request.method} ${request.path}`);
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
      const response = await route.publicHandler({ body: request.body });
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
      bearerToken: token
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
