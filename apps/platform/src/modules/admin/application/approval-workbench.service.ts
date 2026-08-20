import type { ApprovalItem } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type {
  PayoutOrderRepository
} from '../../fiatpayout/application/payout.repository.js';
import type {
  PayoutQueryService
} from '../../fiatpayout/application/payout-query.service.js';
import type {
  WithdrawalApprovalService
} from '../../withdrawals/application/withdrawal-approval.service.js';
import type {
  WithdrawalOrderRepository
} from '../../withdrawals/application/withdrawal.repository.js';

export type WithdrawalDecisionOutcome =
  | {
      readonly outcome:
        | 'APPROVED'
        | 'AWAITING_SECOND_APPROVAL'
        | 'REJECTED'
        | 'SUPERSEDED';
      readonly orderStatus: string;
    }
  | { readonly outcome: 'DENIED'; readonly detail: string };

export type PayoutResolveOutcome =
  | {
      readonly outcome:
        | 'SUCCEEDED_REPORTED'
        | 'FAILED_REPORTED'
        | 'REVERSED_REPORTED'
        | 'UNKNOWN';
    }
  | { readonly outcome: 'DENIED'; readonly detail: string };

/**
 * Cross-domain approval workbench: a table-less orchestration layer.
 * Decision facts stay in each domain's authoritative store
 * (withdrawal_approvals, callback inbox, order state machines) —
 * this service only aggregates the pending lists and routes
 * decisions to the already-verified services. Payout "resolution"
 * triggers the provider query, never a manual state overwrite.
 */
export class ApprovalWorkbenchService {
  readonly #unitOfWork: UnitOfWork;
  readonly #withdrawals: WithdrawalOrderRepository;
  readonly #payouts: PayoutOrderRepository;
  readonly #withdrawalDecisions: WithdrawalApprovalService;
  readonly #payoutQueries: PayoutQueryService;

  constructor(
    unitOfWork: UnitOfWork,
    withdrawals: WithdrawalOrderRepository,
    payouts: PayoutOrderRepository,
    withdrawalDecisions: WithdrawalApprovalService,
    payoutQueries: PayoutQueryService
  ) {
    this.#unitOfWork = unitOfWork;
    this.#withdrawals = withdrawals;
    this.#payouts = payouts;
    this.#withdrawalDecisions = withdrawalDecisions;
    this.#payoutQueries = payoutQueries;
  }

  public async listPending(limit = 100): Promise<readonly ApprovalItem[]> {
    const [withdrawalItems, payoutItems] = await Promise.all([
      this.#unitOfWork.execute((context) =>
        this.#withdrawals.findPendingApprovals(context, limit)
      ),
      this.#unitOfWork.execute((context) =>
        this.#payouts.findUncertain(context, limit)
      )
    ]);
    const items: ApprovalItem[] = [
      ...withdrawalItems.map((order) => ({
        itemId: `WDL:${order.withdrawalId}`,
        kind: 'WITHDRAWAL_APPROVAL' as const,
        uid: order.uid,
        amount: order.amount,
        assetOrRoute: order.assetCode,
        status: order.status,
        createdAt: order.createdAt
      })),
      ...payoutItems.map((order) => ({
        itemId: `PO:${order.payoutOrderId}`,
        kind: 'PAYOUT_UNKNOWN' as const,
        uid: order.uid,
        amount: order.amount,
        assetOrRoute: order.route,
        status: order.status,
        createdAt: order.createdAt
      }))
    ];
    items.sort((a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt)
    );
    return items.slice(0, limit);
  }

  public async decideWithdrawal(input: {
    readonly withdrawalId: string;
    readonly adminId: string;
    readonly decision: 'APPROVE' | 'REJECT';
    readonly reason?: string;
  }): Promise<WithdrawalDecisionOutcome> {
    const result = await this.#withdrawalDecisions.decide({
      withdrawalId: input.withdrawalId,
      adminId: input.adminId,
      decision: input.decision,
      ...(input.reason === undefined ? {} : { reason: input.reason })
    });
    switch (result.outcome) {
      case 'APPROVED':
        return {
          outcome: 'APPROVED',
          orderStatus: result.order.status
        };
      case 'AWAITING_SECOND_APPROVAL':
        return {
          outcome: 'AWAITING_SECOND_APPROVAL',
          orderStatus: result.order.status
        };
      case 'REJECTED':
        return {
          outcome: 'REJECTED',
          orderStatus: result.order.status
        };
      case 'SUPERSEDED':
        return {
          outcome: 'SUPERSEDED',
          orderStatus: result.order.status
        };
      default:
        return {
          outcome: 'DENIED',
          detail: result.reasonCode
        };
    }
  }

  public async resolvePayout(
    payoutOrderId: string
  ): Promise<PayoutResolveOutcome> {
    const result = await this.#payoutQueries.queryFirst(payoutOrderId);
    switch (result.outcome) {
      case 'SUCCEEDED_REPORTED':
      case 'FAILED_REPORTED':
      case 'REVERSED_REPORTED':
      case 'UNKNOWN':
        return { outcome: result.outcome };
      default:
        return { outcome: 'DENIED', detail: result.reasonCode };
    }
  }
}
