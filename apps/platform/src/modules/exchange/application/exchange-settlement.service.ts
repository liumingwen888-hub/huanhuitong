import { randomUUID } from 'node:crypto';
import type {
  ExchangeOrderSnapshot,
  LedgerAccountId,
  QuoteContractErrorCode,
  Uid
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import { exchangeSettled } from '../../ledger/templates/posting-templates.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { ExchangeOrderRepository } from './exchange-order.repository.js';

export type ExchangeSettlementResult =
  | { readonly outcome: 'SETTLED'; readonly order: ExchangeOrderSnapshot }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: QuoteContractErrorCode;
    };

/**
 * Settles a confirmed exchange: FUNDS_RESERVED is CAS-moved to
 * EXECUTING (idempotent re-entry after a crash), the two-leg
 * settlement posts through the ledger kernel — the sell leg balances
 * within the sell asset (frozen -> sell clearing) and the buy leg
 * within the buy asset (buy clearing -> user available) — and the
 * order is CAS-moved to SETTLED with the settlement transaction
 * linked. Spread and rounding value facts accumulate in the two
 * clearing accounts for S7-6 reconciliation.
 */
export class ExchangeSettlementService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: ExchangeOrderRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;

  constructor(
    unitOfWork: UnitOfWork,
    orders: ExchangeOrderRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
  }

  public async settle(
    exchangeOrderId: string
  ): Promise<ExchangeSettlementResult> {
    const order = await this.#load(exchangeOrderId);
    if (order === null) {
      return {
        outcome: 'DENIED',
        reasonCode: 'EXCHANGE_ORDER_NOT_FOUND'
      };
    }
    if (order.status === 'SETTLED') {
      return { outcome: 'SETTLED', order };
    }
    if (order.status === 'FUNDS_RESERVED') {
      const moved = await this.#unitOfWork.execute((context) =>
        this.#orders.markExecuting(context, exchangeOrderId)
      );
      if (!moved) {
        const current = await this.#reload(exchangeOrderId, order);
        if (current.status === 'EXECUTING' || current.status === 'SETTLED') {
          return this.settle(exchangeOrderId);
        }
        return {
          outcome: 'DENIED',
          reasonCode: 'EXCHANGE_COMMAND_INVALID'
        };
      }
    } else if (order.status !== 'EXECUTING') {
      return { outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID' };
    }
    const sellFrozenAccountId = await this.#ensureUserAccount(
      order.uid as Uid,
      order.sellAssetCode,
      'USER_FROZEN'
    );
    const buyAvailableAccountId = await this.#ensureUserAccount(
      order.uid as Uid,
      order.buyAssetCode,
      'USER_AVAILABLE'
    );
    const sellClearingAccountId = await this.#ensurePlatformAccount(
      order.sellAssetCode
    );
    const buyClearingAccountId = await this.#ensurePlatformAccount(
      order.buyAssetCode
    );
    const template = exchangeSettled({
      sellFrozenAccountId,
      sellClearingAccountId,
      buyClearingAccountId,
      buyAvailableAccountId,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      orderId: order.orderRef
    });
    if (!template.ok) {
      return { outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID' };
    }
    const posting = await this.#poster.post(template.command);
    const settled = await this.#unitOfWork.execute((context) =>
      this.#orders.markSettled(context, {
        exchangeOrderId,
        settlementLedgerTransactionId: posting.transactionId
      })
    );
    const current = await this.#reload(exchangeOrderId, order);
    if (!settled) {
      if (current.status === 'SETTLED') {
        return { outcome: 'SETTLED', order: current };
      }
      return { outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID' };
    }
    await this.#notify(current);
    return { outcome: 'SETTLED', order: current };
  }

  async #load(
    exchangeOrderId: string
  ): Promise<ExchangeOrderSnapshot | null> {
    return this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, exchangeOrderId)
    );
  }

  async #reload(
    exchangeOrderId: string,
    fallback: ExchangeOrderSnapshot
  ): Promise<ExchangeOrderSnapshot> {
    return (await this.#load(exchangeOrderId)) ?? fallback;
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

  async #ensurePlatformAccount(assetCode: string): Promise<LedgerAccountId> {
    // owner_uid is NULL here and plain UNIQUE indexes never collide on
    // NULL, so select first and only insert when absent (S6-6 lesson)
    return this.#unitOfWork.execute(async (context) => {
      const existing = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = 'CLEARING_DIFF' LIMIT 1`,
        [assetCode]
      );
      if (existing.rows.length === 1) {
        return existing.rows[0]!.account_id as LedgerAccountId;
      }
      await context.executeSql(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES (NULL, $1, 'CLEARING_DIFF')
         ON CONFLICT (owner_uid, asset_code, purpose) DO NOTHING`,
        [assetCode]
      );
      const settled = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = 'CLEARING_DIFF' LIMIT 1`,
        [assetCode]
      );
      return settled.rows[0]!.account_id as LedgerAccountId;
    });
  }

  async #notify(order: ExchangeOrderSnapshot): Promise<void> {
    const topic = 'telegram.exchange-settled.v1';
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
          marketKey: order.marketKey,
          sellAssetCode: order.sellAssetCode,
          buyAssetCode: order.buyAssetCode,
          sellAmount: order.sellAmount,
          buyAmount: order.buyAmount,
          status: order.status
        }
      })
    );
  }
}
