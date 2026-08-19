import type {
  QuoteSourcePort,
  RateFetch,
  RateQuote
} from './quote-source.port.js';

/**
 * Configurable fake quote source for tests: rates are set per market
 * as {rate, referenceRate} decimal strings; unconfigured markets fail
 * closed. Every fetch is recorded for assertions.
 */
export class FakeQuoteSource implements QuoteSourcePort {
  readonly #rates = new Map<string, { rate: string; referenceRate: string }>();
  readonly fetches: RateFetch[] = [];

  public setRate(
    marketKey: string,
    rate: string,
    referenceRate: string
  ): void {
    this.#rates.set(marketKey, { rate, referenceRate });
  }

  public async getRate(input: RateFetch): Promise<RateQuote> {
    this.fetches.push(input);
    const configured = this.#rates.get(input.marketKey);
    if (configured === undefined) {
      throw new Error('RATE_SOURCE_UNAVAILABLE');
    }
    return {
      rate: configured.rate,
      referenceRate: configured.referenceRate,
      sourceId: 'fake-configured-v1'
    };
  }
}

Object.freeze(FakeQuoteSource.prototype);
