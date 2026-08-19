import type { ExchangeOrderSnapshot } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export interface CreateExchangeOrderInput {
  readonly orderRef: string;
  readonly uid: string;
  readonly quoteId: string;
  readonly marketKey: string;
  readonly configVersion: number;
  readonly sellAssetCode: string;
  readonly buyAssetCode: string;
  readonly sellAmount: string;
  readonly buyAmount: string;
  readonly freezeLedgerTransactionId: string;
}

export interface ExchangeOrderRepository {
  createOrder(
    context: TransactionContext,
    input: CreateExchangeOrderInput
  ): Promise<ExchangeOrderSnapshot>;
  findByQuote(
    context: TransactionContext,
    quoteId: string
  ): Promise<ExchangeOrderSnapshot | null>;
  findById(
    context: TransactionContext,
    exchangeOrderId: string
  ): Promise<ExchangeOrderSnapshot | null>;
}
