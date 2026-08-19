import type { Uid } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { MarketRepository } from '../../exchange/application/market.repository.js';
import type { QuoteService } from '../../exchange/application/quote.service.js';
import type { ExchangeConfirmService } from '../../exchange/application/exchange-confirm.service.js';
import type { ExchangeCommand } from './exchange-commands.js';
import {
  EXCHANGE_REPLIES,
  exchangeReplyText,
  type ExchangeReply
} from './exchange-replies.js';
import { renderNumeric } from './numeric-render.js';

export interface ExchangeCommandInput {
  readonly command: ExchangeCommand;
  readonly externalUserId: string;
  readonly updateId: string;
}

export interface ExchangeCommandOutcome {
  readonly reply: ExchangeReply;
  readonly text: string;
}

/**
 * Telegram UX for exchange: /markets and /rate surface market facts
 * through the controlled numeric renderer (charset-whitelisted values
 * only), /exchange confirms through the S7-3 service (no payment gate
 * by stage ruling), /exchangestatus maps the six order states to
 * categorical constants.
 */
export class ExchangeCommandHandler {
  readonly #unitOfWork: UnitOfWork;
  readonly #markets: MarketRepository;
  readonly #quotes: QuoteService;
  readonly #confirm: ExchangeConfirmService;

  constructor(
    unitOfWork: UnitOfWork,
    markets: MarketRepository,
    quotes: QuoteService,
    confirm: ExchangeConfirmService
  ) {
    this.#unitOfWork = unitOfWork;
    this.#markets = markets;
    this.#quotes = quotes;
    this.#confirm = confirm;
  }

  public async execute(
    input: ExchangeCommandInput
  ): Promise<ExchangeCommandOutcome> {
    const uid = await this.#resolveUid(input.externalUserId);
    if (uid === null) {
      return reply('exchangeNotBound');
    }
    try {
      return await this.#dispatch(uid, input.command);
    } catch {
      return reply('internalError');
    }
  }

  async #dispatch(
    uid: Uid,
    command: ExchangeCommand
  ): Promise<ExchangeCommandOutcome> {
    if (command.kind === 'markets') {
      const markets = await this.#unitOfWork.execute((context) =>
        this.#markets.listActive(context)
      );
      if (markets.length === 0) {
        return reply('marketsEmpty');
      }
      const lines = markets.map((market) =>
        renderNumeric(EXCHANGE_REPLIES.marketLineTemplate, [
          { kind: 'marketKey', value: market.marketKey },
          { kind: 'amount', value: market.minSellAmount },
          { kind: 'amount', value: market.maxSellAmount }
        ])
      );
      return {
        reply: 'marketsHeader',
        text: EXCHANGE_REPLIES.marketsHeader + '\n' + lines.join('\n')
      };
    }
    if (command.kind === 'rate') {
      const result = await this.#quotes.createQuote({
        marketKey: command.marketKey,
        sellAmount: command.sellAmount
      });
      if (result.outcome === 'CREATED') {
        const secondsLeft = Math.max(
          0,
          Math.floor(
            (Date.parse(result.quote.expiresAt) - Date.now()) / 1000
          )
        );
        return {
          reply: 'rateQuotedTemplate',
          text: renderNumeric(EXCHANGE_REPLIES.rateQuotedTemplate, [
            { kind: 'quoteId', value: result.quote.quoteId },
            { kind: 'amount', value: result.quote.sellAmount },
            { kind: 'amount', value: result.quote.buyAmount },
            { kind: 'amount', value: secondsLeft.toString() }
          ])
        };
      }
      switch (result.reasonCode) {
        case 'MARKET_NOT_FOUND':
          return reply('rateMarketNotFound');
        case 'QUOTE_AMOUNT_OUT_OF_RANGE':
          return reply('rateAmountOutOfRange');
        case 'QUOTE_DEVIATION_EXCEEDED':
          return reply('rateDeviationExceeded');
        case 'QUOTE_SOURCE_UNAVAILABLE':
          return reply('rateSourceUnavailable');
        default:
          return reply('rateCommandInvalid');
      }
    }
    if (command.kind === 'confirm') {
      const result = await this.#confirm.confirm({
        quoteId: command.quoteId,
        uid
      });
      if (result.outcome === 'CONFIRMED') {
        return reply('exchangeConfirmed');
      }
      if (result.outcome === 'ALREADY_CONFIRMED') {
        return reply('exchangeAlreadyConfirmed');
      }
      switch (result.reasonCode) {
        case 'QUOTE_NOT_FOUND':
          return reply('exchangeQuoteNotFound');
        case 'QUOTE_NOT_CONSUMABLE':
          return reply('exchangeQuoteNotConsumable');
        case 'EXCHANGE_INSUFFICIENT_FUNDS':
          return reply('exchangeInsufficient');
        default:
          return reply('exchangeCommandInvalid');
      }
    }
    // status
    const status = await this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ status: string }>(
        `SELECT status FROM exchange_orders
          WHERE order_ref = $1 AND uid = $2::uuid LIMIT 1`,
        [command.orderRef, uid]
      );
      return rows.rows[0]?.status ?? null;
    });
    if (status === null) {
      return reply('exchangeStatusUnknown');
    }
    return reply(statusReply(status));
  }

  async #resolveUid(externalUserId: string): Promise<Uid | null> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ uid: string }>(
        `SELECT uid FROM channel_bindings
          WHERE channel_type='TELEGRAM' AND external_user_id=$1
            AND status='ACTIVE' LIMIT 1`,
        [externalUserId]
      );
      return (rows.rows[0]?.uid as Uid) ?? null;
    });
  }
}

function reply(key: ExchangeReply): ExchangeCommandOutcome {
  return { reply: key, text: exchangeReplyText(key) };
}

function statusReply(status: string): ExchangeReply {
  const mapping: Record<string, ExchangeReply> = {
    FUNDS_RESERVED: 'exchangeStatusFundsReserved',
    EXECUTING: 'exchangeStatusExecuting',
    SETTLED: 'exchangeStatusSettled',
    FAILED: 'exchangeStatusFailed',
    EXPIRED: 'exchangeStatusExpired',
    REFUNDED: 'exchangeStatusRefunded'
  };
  return mapping[status] ?? 'exchangeStatusUnknown';
}
