import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export interface CallbackInboxSnapshot {
  readonly callbackId: string;
  readonly providerId: string;
  readonly providerEventId: string;
  readonly providerIdempotencyKey: string;
  readonly reportedStatus: 'SUCCEEDED' | 'FAILED' | 'REVERSED';
  readonly receivedAt: string;
}

export interface CallbackInboxRepository {
  insert(
    context: TransactionContext,
    input: {
      readonly providerId: string;
      readonly providerEventId: string;
      readonly providerIdempotencyKey: string;
      readonly reportedStatus: 'SUCCEEDED' | 'FAILED' | 'REVERSED';
    }
  ): Promise<CallbackInboxSnapshot>;
  hasEvent(
    context: TransactionContext,
    input: { readonly providerId: string; readonly providerEventId: string }
  ): Promise<boolean>;
}
