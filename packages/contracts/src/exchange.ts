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
  | 'QUOTE_SOURCE_UNAVAILABLE'
  | 'QUOTE_NOT_CONSUMABLE'
  | 'EXCHANGE_INSUFFICIENT_FUNDS'
  | 'EXCHANGE_COMMAND_INVALID'
  | 'EXCHANGE_ORDER_NOT_FOUND';

export type ExchangeOrderStatus =
  | 'FUNDS_RESERVED'
  | 'EXECUTING'
  | 'SETTLED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUNDED';

export interface ExchangeOrderSnapshot {
  readonly exchangeOrderId: string;
  readonly orderRef: string;
  readonly uid: string;
  readonly quoteId: string;
  readonly marketKey: string;
  readonly configVersion: number;
  readonly sellAssetCode: string;
  readonly buyAssetCode: string;
  readonly sellAmount: string;
  readonly buyAmount: string;
  readonly status: ExchangeOrderStatus;
  readonly freezeLedgerTransactionId: string;
  readonly settlementLedgerTransactionId: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
}

