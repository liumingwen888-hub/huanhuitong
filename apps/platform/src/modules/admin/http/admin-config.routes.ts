import type { AdminApiRouter } from './admin-api.router.js';
import type {
  ConfigReleaseService
} from '../application/config-release.service.js';

interface DraftBody {
  readonly targetTable?: unknown;
  readonly targetKey?: unknown;
  readonly payload?: unknown;
}

/**
 * Registers the config release endpoints. Drafting requires
 * FINANCE_OFFICER or RISK_OFFICER with an elevated session; the
 * review endpoints enforce that the checker is a different admin
 * from the maker inside the service (self-review is a semantic
 * rejection, not a role one).
 */
export function registerConfigRoutes(
  router: AdminApiRouter,
  release: ConfigReleaseService
): void {
  router.register('POST', '/admin/config/drafts', {
    requiredRole: 'RISK_OFFICER',
    requiredLevel: 'ELEVATED',
    eventType: 'ADMIN_API_POST_CONFIG_DRAFTS',
    handler: async ({ session, body }) => {
      const input = body as DraftBody;
      if (
        typeof input?.targetTable !== 'string' ||
        typeof input?.targetKey !== 'string' ||
        typeof input?.payload !== 'object' ||
        input.payload === null
      ) {
        return {
          status: 400,
          body: { code: 'CONFIG_PAYLOAD_INVALID' }
        };
      }
      try {
        const draft = await release.createDraft(session.adminId, {
          targetTable: input.targetTable as never,
          targetKey: input.targetKey,
          payload: input.payload as Record<string, unknown>
        });
        return { status: 201, body: draft };
      } catch (error) {
        return configError(error);
      }
    }
  });

  router.register('GET', '/admin/config/drafts', {
    requiredLevel: 'BASIC',
    eventType: 'ADMIN_API_GET_CONFIG_DRAFTS',
    handler: async () => {
      const drafts = await release.listDrafts();
      return { status: 200, body: { items: drafts } };
    }
  });

  router.register('POST', '/admin/config/drafts/:draftId/publish', {
    requiredRole: 'RISK_OFFICER',
    requiredLevel: 'ELEVATED',
    eventType: 'ADMIN_API_POST_CONFIG_DRAFTS_PUBLISH',
    handler: async ({ session, params }) => {
      try {
        const result = await release.settle(
          session.adminId,
          params.draftId ?? '',
          'publish'
        );
        return { status: 200, body: result };
      } catch (error) {
        return configError(error);
      }
    }
  });

  router.register('POST', '/admin/config/drafts/:draftId/reject', {
    requiredRole: 'RISK_OFFICER',
    requiredLevel: 'ELEVATED',
    eventType: 'ADMIN_API_POST_CONFIG_DRAFTS_REJECT',
    handler: async ({ session, params }) => {
      try {
        const result = await release.settle(
          session.adminId,
          params.draftId ?? '',
          'reject'
        );
        return { status: 200, body: result };
      } catch (error) {
        return configError(error);
      }
    }
  });
}

function configError(error: unknown): {
  status: number;
  body: { code: string };
} {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'CONFIG_PAYLOAD_INVALID';
  const status =
    code === 'CONFIG_DRAFT_NOT_FOUND'
      ? 404
      : code === 'CONFIG_SELF_REVIEW_REJECTED' ||
          code === 'CONFIG_DRAFT_ALREADY_SETTLED'
        ? 403
        : 400;
  return { status, body: { code } };
}

Object.freeze(registerConfigRoutes.prototype);
