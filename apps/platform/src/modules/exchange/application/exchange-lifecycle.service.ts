import { randomUUID } from 'node:crypto';
import type {
  ExchangeOrderSnapshot,
  LedgerAccountId,
  QuoteContractErrorCode,
  Uid
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type {
  ConfigStore
} from '../../crosscutting/application/crosscutting.services.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import { exchangeReleased } from '../../ledger/templates/posting-templates.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { ExchangeOrderRepository } from './exchange-order.repository.js';
import type { QuoteRepository } from './quote.repository.js';

export type ExchangeFailResult =
  | { readonly outcome: 'FAILED'; readonly order: ExchangeOrderSnapshot }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: QuoteContractErrorCode;
    };

export type ExchangeReleaseResult =
  | { readonly outcome: 'REFUNDED'; readonly order: ExchangeOrderSnapshot }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: QuoteContractErrorCode;
    };

export type ExchangeOrderExpiryResult =
  | { readonly outcome: 'EXPIRED'; readonly ids: readonly string[] }
  | { readonly outcome: 'SKIPPED_NO_CONFIG' };

export type QuoteSweepResult = {
  readonly outcome: 'SWEPT';
  readonly quoteIds: readonly string[];
};

/**
 * Failure, expiry and release for exchange orders: failure is a human
 * decision with a mandatory reason, expiry is a configured-TTL sweep
 * that does nothing without an authorized configuration, and release
 * is the only path that moves funds back to available. Settlement
 * failures never auto-fail — a stuck order stays retryable in
 * EXECUTING until an operator decides.
 */
export class ExchangeLifecycleService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: ExchangeOrderRepository;
  readonly #quotes: QuoteRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;
  readonly #config: ConfigStore;

  constructor(
    unitOfWork: UnitOfWork,
    orders: ExchangeOrderRepository,
    quotes: QuoteRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository,
    config: ConfigStore
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#quotes = quotes;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
    this.#config = config;
  }

  public async fail(input: {
    readonly exchangeOrderId: string;
    readonly reason: string;
  }): Promise<ExchangeFailResult> {
    if (input.reason.length === 0) {
      return { outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID' };
    }
    const order = await this.#load(input.exchangeOrderId);
    if (order === null) {
      return {
        outcome: 'DENIED',
        reasonCode: 'EXCHANGE_ORDER_NOT_FOUND'
      };
    }
    const failed = await this.#unitOfWork.execute((context) =>
      this.#orders.markFailed(context, {
        exchangeOrderId: input.exchangeOrderId,
        reason: input.reason
      })
    );
    if (!failed) {
      return { outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID' };
    }
    const current = await this.#reload(input.exchangeOrderId, order);
    await this.#notify(current, 'telegram.exchange-failed.v1');
    return { outcome: 'FAILED', order: current };
  }

  public async release(
    exchangeOrderId: string
  ): Promise<ExchangeReleaseResult> {
    const order = await this.#load(exchangeOrderId);
    if (order === null) {
      return {
        outcome: 'DENIED',
        reasonCode: 'EXCHANGE_ORDER_NOT_FOUND'
      };
    }
    if (order.status !== 'FAILED' && order.status !== 'EXPIRED') {
      return { outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID' };
    }
    const frozenAccountId = await this.#ensureUserAccount(
      order.uid as Uid,
      order.sellAssetCode,
      'USER_FROZEN'
    );
    const availableAccountId = await this.#ensureUserAccount(
      order.uid as Uid,
      order.sellAssetCode,
      'USER_AVAILABLE'
    );
    const template = exchangeReleased({
      userAvailableAccountId: availableAccountId,
      userFrozenAccountId: frozenAccountId,
      sellAmount: order.sellAmount,
      orderId: order.orderRef
    });
    if (!template.ok) {
      return { outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID' };
    }
    const posting = await this.#poster.post(template.command);
    const refunded = await this.#unitOfWork.execute((context) =>
      this.#orders.markRefunded(context, {
        exchangeOrderId,
        settlementLedgerTransactionId: posting.transactionId
      })
    );
    const current = await this.#reload(exchangeOrderId, order);
    if (!refunded) {
      if (current.status === 'REFUNDED') {
        return { outcome: 'REFUNDED', order: current };
      }
      return { outcome: 'DENIED', reasonCode: 'EXCHANGE_COMMAND_INVALID' };
    }
    await this.#notify(current, 'telegram.exchange-refunded.v1');
    return { outcome: 'REFUNDED', order: current };
  }

  public async expireStaleOrders(
    limit: number
  ): Promise<ExchangeOrderExpiryResult> {
    let ttlSeconds: number | null = null;
    try {
      const config = await this.#config.current('exchange.execution');
      const raw = (config.payload as {
        settleTtlSeconds?: unknown;
      }).settleTtlSeconds;
      if (
        typeof raw === 'number' &&
        Number.isInteger(raw) &&
        raw > 0
      ) {
        ttlSeconds = raw;
      }
    } catch {
      ttlSeconds = null;
    }
    if (ttlSeconds === null) {
      // expiry moves money: without an authorized configuration no
      // order is ever expired
      return { outcome: 'SKIPPED_NO_CONFIG' };
    }
    const staleBefore = new Date(Date.now() - ttlSeconds * 1000);
    const stale = await this.#unitOfWork.execute((context) =>
      this.#orders.findExpirable(context, { staleBefore, limit })
    );
    const expired: string[] = [];
    for (const order of stale) {
      const marked = await this.#unitOfWork.execute((context) =>
        this.#orders.markExpired(context, order.exchangeOrderId)
      );
      if (marked) {
        expired.push(order.exchangeOrderId);
      }
    }
    return { outcome: 'EXPIRED', ids: expired };
  }

  public async expireElapsedQuotes(
    limit: number
  ): Promise<QuoteSweepResult> {
    const quoteIds = await this.#unitOfWork.execute((context) =>
      this.#quotes.expireElapsed(context, limit)
    );
    return { outcome: 'SWEPT', quoteIds };
  }

  async #load(exchangeOrderId: string): Promise<ExchangeOrderSnapshot | null> {
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

  async #notify(
    order: ExchangeOrderSnapshot,
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
          marketKey: order.marketKey,
          sellAssetCode: order.sellAssetCode,
          buyAssetCode: order.buyAssetCode,
          sellAmount: order.sellAmount,
          status: order.status
        }
      })
    );
  }
}
