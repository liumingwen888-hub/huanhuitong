import type { WatchItem, WatchItemKind } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type {
  ExchangeOrderRepository
} from '../../exchange/application/exchange-order.repository.js';
import type {
  ExchangeReconciliationService
} from '../../exchange/application/exchange-reconciliation.service.js';
import type {
  PayoutOrderRepository
} from '../../fiatpayout/application/payout.repository.js';
import type {
  PayoutReconciliationService
} from '../../fiatpayout/application/payout-reconciliation.service.js';
import type {
  ReconciliationService
} from '../../ledger/application/reconciliation.service.js';
import type {
  WithdrawalOrderRepository
} from '../../withdrawals/application/withdrawal.repository.js';

export interface MergedReconciliationReport {
  readonly ledger: unknown;
  readonly exchange: unknown;
  readonly payout: unknown;
  readonly checkedAt: string;
}

/**
 * Read-only operations views: merges the three verified
 * reconciliation reports without any repair or transformation, and
 * builds the cross-domain watchlist (settle pending, release
 * pending, unknown) straight from order statuses. No writes, no
 * state transitions — discrepancies surface for humans.
 */
export class OpsViewService {
  readonly #unitOfWork: UnitOfWork;
  readonly #ledgerReconciliation: ReconciliationService;
  readonly #exchangeReconciliation: ExchangeReconciliationService;
  readonly #payoutReconciliation: PayoutReconciliationService;
  readonly #withdrawals: WithdrawalOrderRepository;
  readonly #exchanges: ExchangeOrderRepository;
  readonly #payouts: PayoutOrderRepository;

  constructor(
    unitOfWork: UnitOfWork,
    ledgerReconciliation: ReconciliationService,
    exchangeReconciliation: ExchangeReconciliationService,
    payoutReconciliation: PayoutReconciliationService,
    withdrawals: WithdrawalOrderRepository,
    exchanges: ExchangeOrderRepository,
    payouts: PayoutOrderRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#ledgerReconciliation = ledgerReconciliation;
    this.#exchangeReconciliation = exchangeReconciliation;
    this.#payoutReconciliation = payoutReconciliation;
    this.#withdrawals = withdrawals;
    this.#exchanges = exchanges;
    this.#payouts = payouts;
  }

  public async reconciliationReport(): Promise<MergedReconciliationReport> {
    const [ledger, exchange, payout] = await Promise.all([
      this.#ledgerReconciliation.runAll(),
      this.#exchangeReconciliation.runAll(),
      this.#payoutReconciliation.runAll()
    ]);
    return Object.freeze({
      ledger: Object.freeze(ledger as unknown as object),
      exchange: Object.freeze(exchange as unknown as object),
      payout: Object.freeze(payout as unknown as object),
      checkedAt: new Date().toISOString()
    });
  }

  public async watchlist(limit = 100): Promise<readonly WatchItem[]> {
    const [withdrawals, exchanges, payouts] = await Promise.all([
      this.#unitOfWork.execute((context) =>
        this.#withdrawals.findByStatuses(context, {
          statuses: [
            'BROADCAST', 'REJECTED', 'FAILED', 'EXPIRED'
          ],
          limit
        })
      ),
      this.#unitOfWork.execute((context) =>
        this.#exchanges.findByStatuses(context, {
          statuses: [
            'FUNDS_RESERVED', 'EXECUTING', 'FAILED', 'EXPIRED'
          ],
          limit
        })
      ),
      this.#unitOfWork.execute((context) =>
        this.#payouts.findByStatuses(context, {
          statuses: [
            'ACCEPTED', 'FAILED', 'UNKNOWN', 'SUBMITTING'
          ],
          limit
        })
      )
    ]);
    const items: WatchItem[] = [
      ...withdrawals.map((order) => ({
        itemId: `WDL:${order.withdrawalId}`,
        kind: watchKind(order.status, 'WITHDRAWAL'),
        domain: 'WITHDRAWAL' as const,
        uid: order.uid,
        amount: order.amount,
        assetOrRoute: order.assetCode,
        status: order.status,
        ageMinutes: ageMinutes(order.createdAt)
      })),
      ...exchanges.map((order) => ({
        itemId: `XCH:${order.exchangeOrderId}`,
        kind: watchKind(order.status, 'EXCHANGE'),
        domain: 'EXCHANGE' as const,
        uid: order.uid,
        amount: order.sellAmount,
        assetOrRoute: order.sellAssetCode,
        status: order.status,
        ageMinutes: ageMinutes(order.createdAt)
      })),
      ...payouts.map((order) => ({
        itemId: `PO:${order.payoutOrderId}`,
        kind: watchKind(order.status, 'PAYOUT'),
        domain: 'PAYOUT' as const,
        uid: order.uid,
        amount: order.amount,
        assetOrRoute: order.route,
        status: order.status,
        ageMinutes: ageMinutes(order.createdAt)
      }))
    ];
    items.sort((a, b) => a.ageMinutes - b.ageMinutes);
    return items.slice(0, limit);
  }
}

function watchKind(
  status: string,
  domain: 'WITHDRAWAL' | 'EXCHANGE' | 'PAYOUT'
): WatchItemKind {
  switch (domain) {
    case 'WITHDRAWAL':
      if (status === 'BROADCAST') {
        return 'SETTLE_PENDING';
      }
      return 'RELEASE_PENDING';
    case 'EXCHANGE':
      if (status === 'FUNDS_RESERVED' || status === 'EXECUTING') {
        return 'SETTLE_PENDING';
      }
      return 'RELEASE_PENDING';
    case 'PAYOUT':
      if (status === 'ACCEPTED') {
        return 'SETTLE_PENDING';
      }
      if (status === 'FAILED') {
        return 'RELEASE_PENDING';
      }
      return 'UNKNOWN';
  }
}

function ageMinutes(createdAtIso: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - Date.parse(createdAtIso)) / 60_000)
  );
}
