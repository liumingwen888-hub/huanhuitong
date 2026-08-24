import { randomUUID } from 'node:crypto';
import type {
  LedgerAccountId,
  PayoutContractErrorCode,
  PayoutOrderSnapshot,
  Uid,
  MetricsPort,
} from '@xht/contracts';
import { NOOP_METRICS } from '../../../infrastructure/telemetry/compose-metrics.js';
import {
  UnitOfWorkError,
  type UnitOfWork
} from '../../../infrastructure/database/unit-of-work.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import { LedgerError } from '../../ledger/domain/ledger.errors.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import {
  fiatPayoutFailed,
  fiatPayoutReversed,
  fiatPayoutSucceeded
} from '../../ledger/templates/posting-templates.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { PayoutOrderRepository } from './payout.repository.js';

export type PayoutSettlementOutcome =
  | { readonly outcome: 'SETTLED'; readonly order: PayoutOrderSnapshot }
  | { readonly outcome: 'REFUNDED'; readonly order: PayoutOrderSnapshot }
  | { readonly outcome: 'REVERSED'; readonly order: PayoutOrderSnapshot }
  | {
      readonly outcome: 'SETTLE_REJECTED';
      readonly reasonCode: PayoutContractErrorCode;
    }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: PayoutContractErrorCode;
    };

/**
 * Final settlement paths for payout orders: success posts the
 * four-line template (frozen -> upstream cost plus the fee lines),
 * failure releases the frozen funds back to available, and a
 * post-success provider reversal posts a mirrored compensation entry.
 * A fee the user cannot cover leaves the order in ACCEPTED for
 * operations — never partial fees, never inferred success.
 */
export class PayoutSettlementService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: PayoutOrderRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;

  readonly #metrics: MetricsPort;

  constructor(
    unitOfWork: UnitOfWork,
    orders: PayoutOrderRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository,
    metrics: MetricsPort = NOOP_METRICS
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
    this.#metrics = metrics;
  }

  public async settle(payoutOrderId: string): Promise<PayoutSettlementOutcome> {
    const order = await this.#load(payoutOrderId);
    if (order === null) {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_ORDER_NOT_FOUND' };
    }
    if (order.status !== 'ACCEPTED') {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' };
    }
    const frozenAccountId = await this.#ensureUserAccount(
      order.uid as Uid,
      order.sourceAssetCode,
      'USER_FROZEN'
    );
    const availableAccountId = await this.#ensureUserAccount(
      order.uid as Uid,
      order.sourceAssetCode,
      'USER_AVAILABLE'
    );
    // the principal leg flows through CLEARING_DIFF (unrestricted)
    // rather than a debit-normal UPSTREAM_COST — crediting the latter
    // required a pre-funded balance no treasury flow provides, which
    // deadlocked the first real payout settlement
    const upstreamCostAccountId = await this.#ensurePlatformAccount(
      order.sourceAssetCode,
      'CLEARING_DIFF'
    );
    const feeIncomeAccountId = await this.#ensurePlatformAccount(
      order.sourceAssetCode,
      'FEE_INCOME'
    );
    const template = fiatPayoutSucceeded({
      userAvailableAccountId: availableAccountId,
      userFrozenAccountId: frozenAccountId,
      upstreamCostAccountId,
      feeIncomeAccountId,
      amount: order.amount,
      feeAmount: order.feeAmount,
      orderId: order.orderRef
    });
    if (!template.ok) {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_COMMAND_INVALID' };
    }
    let settlementTransactionId: string;
    try {
      const posting = await this.#poster.post(template.command);
      settlementTransactionId = posting.transactionId;
    } catch (error: unknown) {
      if (
        (error instanceof LedgerError &&
          error.code === 'LEDGER_NEGATIVE_BALANCE') ||
        (error instanceof UnitOfWorkError &&
          error.code === 'TRANSACTION_CALLBACK_FAILED')
      ) {
        return {
          outcome: 'SETTLE_REJECTED',
          reasonCode: 'PAYOUT_INSUFFICIENT_FUNDS'
        };
      }
      throw error;
    }
    const succeeded = await this.#unitOfWork.execute((context) =>
      this.#orders.markSucceeded(context, {
        payoutOrderId,
        settlementLedgerTransactionId: settlementTransactionId
      })
    );
    const current = await this.#reload(payoutOrderId, order);
    if (!succeeded && current.status !== 'SUCCEEDED') {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' };
    }
    this.#metrics.incrementCounter('payout_succeeded_total', {
      domain: 'payout', outcome: 'settled'
    });
    await this.#notify(current, 'telegram.payout-succeeded.v1');
    return { outcome: 'SETTLED', order: current };
  }

  public async release(payoutOrderId: string): Promise<PayoutSettlementOutcome> {
    const order = await this.#load(payoutOrderId);
    if (order === null) {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_ORDER_NOT_FOUND' };
    }
    if (order.status !== 'FAILED') {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' };
    }
    const frozenAccountId = await this.#ensureUserAccount(
      order.uid as Uid,
      order.sourceAssetCode,
      'USER_FROZEN'
    );
    const availableAccountId = await this.#ensureUserAccount(
      order.uid as Uid,
      order.sourceAssetCode,
      'USER_AVAILABLE'
    );
    const template = fiatPayoutFailed({
      userAvailableAccountId: availableAccountId,
      userFrozenAccountId: frozenAccountId,
      amount: order.amount,
      orderId: order.orderRef
    });
    if (!template.ok) {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_COMMAND_INVALID' };
    }
    const posting = await this.#poster.post(template.command);
    const refunded = await this.#unitOfWork.execute((context) =>
      this.#orders.markRefunded(context, {
        payoutOrderId,
        settlementLedgerTransactionId: posting.transactionId
      })
    );
    const current = await this.#reload(payoutOrderId, order);
    if (!refunded && current.status !== 'REFUNDED') {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' };
    }
    await this.#notify(current, 'telegram.payout-refunded.v1');
    return { outcome: 'REFUNDED', order: current };
  }

  public async reverse(payoutOrderId: string): Promise<PayoutSettlementOutcome> {
    const order = await this.#load(payoutOrderId);
    if (order === null) {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_ORDER_NOT_FOUND' };
    }
    if (order.status !== 'SUCCEEDED') {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' };
    }
    const availableAccountId = await this.#ensureUserAccount(
      order.uid as Uid,
      order.sourceAssetCode,
      'USER_AVAILABLE'
    );
    // mirrors the settlement leg: principal flows through
    // CLEARING_DIFF so the reversal DR lands on the same account
    const upstreamCostAccountId = await this.#ensurePlatformAccount(
      order.sourceAssetCode,
      'CLEARING_DIFF'
    );
    const feeIncomeAccountId = await this.#ensurePlatformAccount(
      order.sourceAssetCode,
      'FEE_INCOME'
    );
    const template = fiatPayoutReversed({
      userAvailableAccountId: availableAccountId,
      upstreamCostAccountId,
      feeIncomeAccountId,
      amount: order.amount,
      feeAmount: order.feeAmount,
      orderId: order.orderRef
    });
    if (!template.ok) {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_COMMAND_INVALID' };
    }
    const posting = await this.#poster.post(template.command);
    const reversed = await this.#unitOfWork.execute((context) =>
      this.#orders.markReversed(context, {
        payoutOrderId,
        settlementLedgerTransactionId: posting.transactionId
      })
    );
    const current = await this.#reload(payoutOrderId, order);
    if (!reversed && current.status !== 'REVERSED') {
      return { outcome: 'DENIED', reasonCode: 'PAYOUT_INVALID_TRANSITION' };
    }
    await this.#notify(current, 'telegram.payout-reversed.v1');
    return { outcome: 'REVERSED', order: current };
  }

  async #load(payoutOrderId: string): Promise<PayoutOrderSnapshot | null> {
    return this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, payoutOrderId)
    );
  }

  async #reload(
    payoutOrderId: string,
    fallback: PayoutOrderSnapshot
  ): Promise<PayoutOrderSnapshot> {
    return (await this.#load(payoutOrderId)) ?? fallback;
  }

  async #ensureUserAccount(
    uid: Uid,
    assetCode: string,
    purpose: 'USER_AVAILABLE' | 'USER_FROZEN'
  ): Promise<LedgerAccountId> {
    return this.#unitOfWork.execute((context) =>
      this.#accounts
        .openUserAccount(context, {
          ownerUid: uid,
          assetCode,
          purpose,
          idempotencyKey: `open:${uid}:${assetCode}:${purpose}`
        })
        .then((account) => account.accountId)
    );
  }

  async #ensurePlatformAccount(
    assetCode: string,
    purpose: 'UPSTREAM_COST' | 'FEE_INCOME' | 'CLEARING_DIFF'
  ): Promise<LedgerAccountId> {
    // owner_uid is NULL here and plain UNIQUE indexes never collide
    // on NULL — select first, insert only when absent (S6-6 lesson)
    return this.#unitOfWork.execute(async (context) => {
      const existing = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = $2 LIMIT 1`,
        [assetCode, purpose]
      );
      if (existing.rows.length === 1) {
        return existing.rows[0]!.account_id as LedgerAccountId;
      }
      await context.executeSql(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES (NULL, $1, $2)
         ON CONFLICT (owner_uid, asset_code, purpose) DO NOTHING`,
        [assetCode, purpose]
      );
      const settled = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = $2 LIMIT 1`,
        [assetCode, purpose]
      );
      return settled.rows[0]!.account_id as LedgerAccountId;
    });
  }

  async #notify(
    order: PayoutOrderSnapshot,
    topic: string
  ): Promise<void> {
    const eventId = randomUUID();
    await this.#unitOfWork.execute((context) =>
      this.#outbox.enqueue(context, {
        id: eventId,
        topic,
        eventKey: `${topic}:${order.orderRef}`,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        payload: {
          type: topic,
          uid: order.uid,
          orderRef: order.orderRef,
          route: order.route,
          amount: order.amount,
          status: order.status
        }
      })
    );
  }
}
