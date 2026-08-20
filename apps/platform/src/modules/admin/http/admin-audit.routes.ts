import type { AdminApiRouter } from './admin-api.router.js';
import type {
  AuditQueryService
} from '../application/audit-query.service.js';

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Registers the audit retrieval endpoint. Retrieval is AUDITOR-only:
 * the reviewers of the audit trail must be distinct from the roles
 * that operate funds, so FINANCE and SUPPORT are denied here.
 */
export function registerAuditRoutes(
  router: AdminApiRouter,
  queries: AuditQueryService
): void {
  router.register('GET', '/admin/audit/events', {
    requiredRole: 'AUDITOR',
    requiredLevel: 'BASIC',
    eventType: 'ADMIN_API_GET_AUDIT_EVENTS',
    handler: async ({ query }) => {
      try {
        const limit = toNumber(query.limit);
        const result = await queries.query({
          ...(query.from === undefined ? {} : { from: query.from }),
          ...(query.to === undefined ? {} : { to: query.to }),
          ...(query.actor === undefined ? {} : { actor: query.actor }),
          ...(query.category === undefined
            ? {}
            : { category: query.category }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(limit === undefined ? {} : { limit })
        });
        return {
          status: 200,
          body: {
            items: result.items,
            nextCursor: result.nextCursor
          }
        };
      } catch {
        return {
          status: 400,
          body: { code: 'AUDIT_QUERY_INVALID' }
        };
      }
    }
  });
}

Object.freeze(registerAuditRoutes.prototype);
