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
