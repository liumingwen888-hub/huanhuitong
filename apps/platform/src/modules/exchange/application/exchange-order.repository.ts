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
  markExecuting(
    context: TransactionContext,
    exchangeOrderId: string
  ): Promise<boolean>;
  markSettled(
    context: TransactionContext,
    input: {
      readonly exchangeOrderId: string;
      readonly settlementLedgerTransactionId: string;
    }
  ): Promise<boolean>;
  markFailed(
    context: TransactionContext,
    input: { readonly exchangeOrderId: string; readonly reason: string }
  ): Promise<boolean>;
  markExpired(
    context: TransactionContext,
    exchangeOrderId: string
  ): Promise<boolean>;
  markRefunded(
    context: TransactionContext,
    input: {
      readonly exchangeOrderId: string;
      readonly settlementLedgerTransactionId: string;
    }
  ): Promise<boolean>;
  findExpirable(
    context: TransactionContext,
    input: { readonly staleBefore: Date; readonly limit: number }
  ): Promise<readonly ExchangeOrderSnapshot[]>;
  findByStatuses(
    context: TransactionContext,
    input: { readonly statuses: readonly string[]; readonly limit: number }
  ): Promise<readonly ExchangeOrderSnapshot[]>;
}
