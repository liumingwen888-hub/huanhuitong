export interface MarketDirectionSnapshot {
  readonly marketKey: string;
  readonly configVersion: number;
  readonly sellAssetCode: string;
  readonly buyAssetCode: string;
  readonly quoteScale: number;
  readonly spreadBp: number;
  readonly minSellAmount: string;
  readonly maxSellAmount: string;
  readonly quoteTtlSeconds: number;
  readonly deviationToleranceBp: number;
  readonly activatedAt: string;
}

export type MarketContractErrorCode =
  | 'MARKET_NOT_FOUND'
  | 'MARKET_COMMAND_INVALID';

export type QuoteStatus = 'ACTIVE' | 'CONSUMED' | 'EXPIRED';

export interface QuoteSnapshot {
  readonly quoteId: string;
  readonly marketKey: string;
  readonly configVersion: number;
  readonly sellAmount: string;
  readonly referenceRate: string;
  readonly buyAmount: string;
  readonly sourceId: string;
  readonly status: QuoteStatus;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export type QuoteContractErrorCode =
  | 'MARKET_NOT_FOUND'
  | 'MARKET_COMMAND_INVALID'
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_DEVIATION_EXCEEDED'
  | 'QUOTE_AMOUNT_OUT_OF_RANGE'
  | 'QUOTE_COMMAND_INVALID'
  | 'QUOTE_SOURCE_UNAVAILABLE';
