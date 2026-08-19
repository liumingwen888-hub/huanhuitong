import { randomUUID } from 'node:crypto';
import type {
  ExchangeOrderSnapshot,
  LedgerAccountId,
  QuoteContractErrorCode,
  Uid
} from '@xht/contracts';
import {
  UnitOfWorkError,
  type UnitOfWork
} from '../../../infrastructure/database/unit-of-work.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import { LedgerError } from '../../ledger/domain/ledger.errors.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import { exchangeFrozen } from '../../ledger/templates/posting-templates.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { ExchangeOrderRepository } from './exchange-order.repository.js';
import type { QuoteRepository } from './quote.repository.js';

export interface ConfirmExchangeInput {
  readonly quoteId: string;
  readonly uid: Uid;
}

export type ConfirmExchangeResult =
  | {
      readonly outcome: 'CONFIRMED';
      readonly order: ExchangeOrderSnapshot;
    }
  | {
      readonly outcome: 'ALREADY_CONFIRMED';
      readonly order: ExchangeOrderSnapshot;
    }
  | {
      readonly outcome: 'REJECTED';
      readonly reasonCode: QuoteContractErrorCode;
    };

/**
 * Confirms an exchange quote and freezes the sell-side funds. The
 * order reference is derived deterministically from the quote id
 * (XCHG:{quoteId}) so replays re-post the same freeze through the
 * template idempotency key; quote consumption (ACTIVE + unexpired CAS)
 * and order creation happen in one atomic unit of work so concurrent
 * confirmations converge to exactly one order.
 */
export class ExchangeConfirmService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: ExchangeOrderRepository;
  readonly #quotes: QuoteRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;

  constructor(
    unitOfWork: UnitOfWork,
    orders: ExchangeOrderRepository,
    quotes: QuoteRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#quotes = quotes;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
  }

  public async confirm(
    input: ConfirmExchangeInput
  ): Promise<ConfirmExchangeResult> {
    const existing = await this.#unitOfWork.execute((context) =>
      this.#orders.findByQuote(context, input.quoteId)
    );
    if (existing !== null) {
      return { outcome: 'ALREADY_CONFIRMED', order: existing };
    }
    const quote = await this.#unitOfWork.execute((context) =>
      this.#quotes.findById(context, input.quoteId)
    );
    if (quote === null) {
      return { outcome: 'REJECTED', reasonCode: 'QUOTE_NOT_FOUND' };
    }
    // market key format is SELL:BUY; asset codes contain no colon
    const [sellAssetCode, buyAssetCode] = quote.marketKey.split(':');
    if (sellAssetCode === undefined || buyAssetCode === undefined) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'EXCHANGE_COMMAND_INVALID'
      };
    }
    const availableAccountId = await this.#ensureAccount(
      input.uid,
      sellAssetCode,
      'USER_AVAILABLE'
    );
    const precheck = await this.#unitOfWork.execute((context) =>
      this.#accounts.accountBalance(context, availableAccountId)
    );
    // accountBalance is the signed DEBIT-minus-CREDIT sum; USER_AVAILABLE
    // is credit-normal, so spendable funds are the negated balance
    if (-BigInt(precheck) < BigInt(quote.sellAmount)) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'EXCHANGE_INSUFFICIENT_FUNDS'
      };
    }
    const frozenAccountId = await this.#ensureAccount(
      input.uid,
      sellAssetCode,
      'USER_FROZEN'
    );
    const orderRef = `XCHG:${quote.quoteId}`;
    const template = exchangeFrozen({
      userAvailableAccountId: availableAccountId,
      userFrozenAccountId: frozenAccountId,
      sellAmount: quote.sellAmount,
      orderId: orderRef
    });
    if (!template.ok) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'EXCHANGE_COMMAND_INVALID'
      };
    }
    let freezeTransactionId: string;
    try {
      const posting = await this.#poster.post(template.command);
      freezeTransactionId = posting.transactionId;
    } catch (error: unknown) {
      if (
        (error instanceof LedgerError &&
          error.code === 'LEDGER_NEGATIVE_BALANCE') ||
        (error instanceof UnitOfWorkError &&
          error.code === 'TRANSACTION_CALLBACK_FAILED')
      ) {
        return {
          outcome: 'REJECTED',
          reasonCode: 'EXCHANGE_INSUFFICIENT_FUNDS'
        };
      }
      throw error;
    }
    let atomic: AtomicOutcome;
    try {
      atomic = await this.#unitOfWork.execute(async (context) => {
        const consumed = await this.#quotes.consumeActive(
          context,
          quote.quoteId
        );
        if (consumed === null) {
          const winner = await this.#orders.findByQuote(
            context,
            quote.quoteId
          );
          if (winner !== null) {
            return { kind: 'ALREADY' as const, order: winner };
          }
          return { kind: 'NOT_CONSUMABLE' as const };
        }
        const order = await this.#orders.createOrder(context, {
          orderRef,
          uid: input.uid,
          quoteId: quote.quoteId,
          marketKey: quote.marketKey,
          configVersion: quote.configVersion,
          sellAssetCode,
          buyAssetCode,
          sellAmount: quote.sellAmount,
          buyAmount: quote.buyAmount,
          freezeLedgerTransactionId: freezeTransactionId
        });
        return { kind: 'CREATED' as const, order };
      });
    } catch (error: unknown) {
      if (
        error instanceof UnitOfWorkError &&
        error.code === 'TRANSACTION_CALLBACK_FAILED'
      ) {
        const winner = await this.#unitOfWork.execute((context) =>
          this.#orders.findByQuote(context, quote.quoteId)
        );
        if (winner !== null) {
          return { outcome: 'ALREADY_CONFIRMED', order: winner };
        }
      }
      throw error;
    }
    if (atomic.kind === 'ALREADY') {
      return { outcome: 'ALREADY_CONFIRMED', order: atomic.order };
    }
    if (atomic.kind === 'NOT_CONSUMABLE') {
      return { outcome: 'REJECTED', reasonCode: 'QUOTE_NOT_CONSUMABLE' };
    }
    await this.#notify(atomic.order);
    return { outcome: 'CONFIRMED', order: atomic.order };
  }

  async #ensureAccount(
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

  async #notify(order: ExchangeOrderSnapshot): Promise<void> {
    const topic = 'telegram.exchange-reserved.v1';
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

type AtomicOutcome =
  | { readonly kind: 'CREATED'; readonly order: ExchangeOrderSnapshot }
  | { readonly kind: 'ALREADY'; readonly order: ExchangeOrderSnapshot }
  | { readonly kind: 'NOT_CONSUMABLE' };
