export interface RateFetch {
  readonly marketKey: string;
  readonly sellAssetCode: string;
  readonly buyAssetCode: string;
}

export interface RateQuote {
  readonly rate: string;
  readonly referenceRate: string;
  readonly sourceId: string;
}

/**
 * The only quote-source surface the exchange domain may depend on.
 * Implementations return both the tradable rate and the reference
 * rate used for deviation checks; real oracles are a
 * production-stage authorization.
 */
export interface QuoteSourcePort {
  getRate(input: RateFetch): Promise<RateQuote>;
}
