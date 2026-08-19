import type {
  QuoteContractErrorCode,
  QuoteSnapshot
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import {
  computeBuyAmount,
  exceedsDeviationTolerance,
  parseDecimalRate
} from '../domain/quote-math.js';
import type { QuoteSourcePort } from '../domain/quote-source.port.js';
import type { MarketRepository } from './market.repository.js';
import type { QuoteRepository } from './quote.repository.js';

export interface CreateQuoteInput {
  readonly marketKey: string;
  readonly sellAmount: string;
}

export type CreateQuoteResult =
  | { readonly outcome: 'CREATED'; readonly quote: QuoteSnapshot }
  | {
      readonly outcome: 'REJECTED';
      readonly reasonCode: QuoteContractErrorCode;
    };

/**
 * Builds auditable, time-boxed quotes: validates the active market and
 * its limits, fetches the rate through the quote-source port, rejects
 * deviations beyond the market tolerance (fail-closed, zero writes),
 * computes the buyer's proceeds with pure BigInt round-down math and
 * persists the snapshot bound to the market config version used.
 */
export class QuoteService {
  readonly #unitOfWork: UnitOfWork;
  readonly #markets: MarketRepository;
  readonly #quotes: QuoteRepository;
  readonly #source: QuoteSourcePort;

  constructor(
    unitOfWork: UnitOfWork,
    markets: MarketRepository,
    quotes: QuoteRepository,
    source: QuoteSourcePort
  ) {
    this.#unitOfWork = unitOfWork;
    this.#markets = markets;
    this.#quotes = quotes;
    this.#source = source;
  }

  public async createQuote(
    input: CreateQuoteInput
  ): Promise<CreateQuoteResult> {
    const market = await this.#unitOfWork.execute((context) =>
      this.#markets.findActive(context, input.marketKey)
    );
    if (market === null) {
      return { outcome: 'REJECTED', reasonCode: 'MARKET_NOT_FOUND' };
    }
    if (!/^[0-9]{1,18}$/u.test(input.sellAmount) || input.sellAmount === '0') {
      return { outcome: 'REJECTED', reasonCode: 'QUOTE_COMMAND_INVALID' };
    }
    if (
      BigInt(input.sellAmount) < BigInt(market.minSellAmount) ||
      BigInt(input.sellAmount) > BigInt(market.maxSellAmount)
    ) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'QUOTE_AMOUNT_OUT_OF_RANGE'
      };
    }
    let fetched;
    try {
      fetched = await this.#source.getRate({
        marketKey: market.marketKey,
        sellAssetCode: market.sellAssetCode,
        buyAssetCode: market.buyAssetCode
      });
    } catch {
      return {
        outcome: 'REJECTED',
        reasonCode: 'QUOTE_SOURCE_UNAVAILABLE'
      };
    }
    let rate;
    let referenceRate;
    try {
      rate = parseDecimalRate(fetched.rate);
      referenceRate = parseDecimalRate(fetched.referenceRate);
    } catch {
      return { outcome: 'REJECTED', reasonCode: 'QUOTE_SOURCE_UNAVAILABLE' };
    }
    if (
      exceedsDeviationTolerance({
        rate,
        referenceRate,
        toleranceBp: market.deviationToleranceBp
      })
    ) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'QUOTE_DEVIATION_EXCEEDED'
      };
    }
    const decimals = await this.#lookupDecimals(
      market.sellAssetCode,
      market.buyAssetCode
    );
    if (decimals === null) {
      return { outcome: 'REJECTED', reasonCode: 'QUOTE_COMMAND_INVALID' };
    }
    const buyAmount = computeBuyAmount({
      sellAmount: BigInt(input.sellAmount),
      rateNum: rate.num,
      rateDen: rate.den,
      sellDecimals: decimals.sell,
      buyDecimals: decimals.buy,
      spreadBp: market.spreadBp
    });
    if (buyAmount <= 0n) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'QUOTE_AMOUNT_OUT_OF_RANGE'
      };
    }
    const expiresAt = new Date(
      Date.now() + market.quoteTtlSeconds * 1000
    );
    const quote = await this.#unitOfWork.execute((context) =>
      this.#quotes.insert(context, {
        marketKey: market.marketKey,
        configVersion: market.configVersion,
        sellAmount: input.sellAmount,
        referenceRate: fetched.referenceRate,
        buyAmount: buyAmount.toString(),
        sourceId: fetched.sourceId,
        expiresAt
      })
    );
    return { outcome: 'CREATED', quote };
  }

  async #lookupDecimals(
    sellAssetCode: string,
    buyAssetCode: string
  ): Promise<{ readonly sell: number; readonly buy: number } | null> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        asset_code: string;
        decimals: number;
      }>(
        `SELECT asset_code, decimals FROM asset_catalog
          WHERE asset_code = ANY($1::text[])`,
        [[sellAssetCode, buyAssetCode]]
      );
      const byCode = new Map(
        rows.rows.map((row) => [row.asset_code, row.decimals])
      );
      const sell = byCode.get(sellAssetCode);
      const buy = byCode.get(buyAssetCode);
      if (sell === undefined || buy === undefined) {
        return null;
      }
      return { sell, buy };
    });
  }
}
