import type { QuoteSnapshot } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export interface InsertQuoteInput {
  readonly marketKey: string;
  readonly configVersion: number;
  readonly sellAmount: string;
  readonly referenceRate: string;
  readonly buyAmount: string;
  readonly sourceId: string;
  readonly expiresAt: Date;
}

export interface QuoteRepository {
  insert(
    context: TransactionContext,
    input: InsertQuoteInput
  ): Promise<QuoteSnapshot>;
  findById(
    context: TransactionContext,
    quoteId: string
  ): Promise<QuoteSnapshot | null>;
  consumeActive(
    context: TransactionContext,
    quoteId: string
  ): Promise<QuoteSnapshot | null>;
}
