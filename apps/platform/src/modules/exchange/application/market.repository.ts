import type { MarketDirectionSnapshot } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export interface InsertMarketConfigInput {
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
}

export interface MarketRepository {
  findActive(
    context: TransactionContext,
    marketKey: string
  ): Promise<MarketDirectionSnapshot | null>;
  listActive(
    context: TransactionContext
  ): Promise<readonly MarketDirectionSnapshot[]>;
  insert(
    context: TransactionContext,
    input: InsertMarketConfigInput
  ): Promise<MarketDirectionSnapshot>;
}
