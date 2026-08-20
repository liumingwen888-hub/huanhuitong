import type { AdminApiResponse } from '@xht/contracts';
import type { AdminApiRouter } from './admin-api.router.js';
import type {
  ApprovalWorkbenchService
} from '../application/approval-workbench.service.js';

interface DecideBody {
  readonly decision?: unknown;
  readonly reason?: unknown;
}

/**
 * Registers the approval workbench endpoints. The pending list is
 * readable by any authenticated admin (all five roles are internal
 * trusted roles); decisions require FINANCE_OFFICER plus an
 * elevated session, and payout "resolution" routes to the
 * query-first service rather than any manual state overwrite.
 */
export function registerApprovalRoutes(
  router: AdminApiRouter,
  workbench: ApprovalWorkbenchService
): void {
  router.register('GET', '/admin/approvals/pending', {
    requiredLevel: 'BASIC',
    eventType: 'ADMIN_API_GET_APPROVALS_PENDING',
    handler: async () => {
      const items = await workbench.listPending(100);
      return { status: 200, body: { items } };
    }
  });

  router.register(
    'POST',
    '/admin/approvals/withdrawal/:withdrawalId/decide',
    {
      requiredRole: 'FINANCE_OFFICER',
      requiredLevel: 'ELEVATED',
      eventType: 'ADMIN_API_POST_APPROVALS_WITHDRAWAL_DECIDE',
      handler: async ({ session, body, params }) => {
        const input = body as DecideBody;
        if (
          (input?.decision !== 'APPROVE' &&
            input?.decision !== 'REJECT') ||
          (input?.decision === 'REJECT' &&
            typeof input?.reason !== 'string')
        ) {
          return {
            status: 400,
            body: { code: 'ADMIN_APPROVAL_DECISION_INVALID' }
          };
        }
        const result = await workbench.decideWithdrawal({
          withdrawalId: params.withdrawalId ?? '',
          adminId: session.adminId,
          decision: input.decision,
          ...(typeof input.reason === 'string'
            ? { reason: input.reason }
            : {})
        });
        if (result.outcome === 'DENIED') {
          return {
            status:
              result.detail === 'WITHDRAWAL_ORDER_NOT_FOUND'
                ? 404
                : result.detail === 'WITHDRAWAL_DUPLICATE_APPROVAL'
                  ? 409
                  : 422,
            body: { code: result.detail }
          };
        }
        return {
          status: 200,
          body: {
            outcome: result.outcome,
            orderStatus: result.orderStatus
          }
        };
      }
    }
  );

  router.register(
    'POST',
    '/admin/approvals/payout/:payoutOrderId/resolve',
    {
      requiredRole: 'FINANCE_OFFICER',
      requiredLevel: 'ELEVATED',
      eventType: 'ADMIN_API_POST_APPROVALS_PAYOUT_RESOLVE',
      handler: async ({ params }) => {
        const result = await workbench.resolvePayout(
          params.payoutOrderId ?? ''
        );
        if (result.outcome === 'DENIED') {
          return {
            status:
              result.detail === 'PAYOUT_ORDER_NOT_FOUND' ? 404 : 422,
            body: { code: result.detail }
          };
        }
        return { status: 200, body: { outcome: result.outcome } };
      }
    }
  );
}

Object.freeze(registerApprovalRoutes.prototype);
