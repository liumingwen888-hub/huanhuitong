import type { AdminApiRouter } from './admin-api.router.js';
import type {
  OpsViewService
} from '../application/ops-view.service.js';

/**
 * Registers the read-only operations views: the merged three-domain
 * reconciliation report (discrepancies pass through untouched) and
 * the cross-domain watchlist. Both endpoints write nothing.
 */
export function registerOpsRoutes(
  router: AdminApiRouter,
  views: OpsViewService
): void {
  router.register('GET', '/admin/ops/reconciliation', {
    requiredLevel: 'BASIC',
    eventType: 'ADMIN_API_GET_OPS_RECONCILIATION',
    handler: async () => {
      const report = await views.reconciliationReport();
      return { status: 200, body: report };
    }
  });

  router.register('GET', '/admin/ops/watchlist', {
    requiredLevel: 'BASIC',
    eventType: 'ADMIN_API_GET_OPS_WATCHLIST',
    handler: async () => {
      const items = await views.watchlist(100);
      return { status: 200, body: { items } };
    }
  });
}

Object.freeze(registerOpsRoutes.prototype);
