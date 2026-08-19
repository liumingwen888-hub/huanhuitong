import type {
  LedgerAccountId,
  LedgerAccountPurpose,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type { PostMoneyCommand } from '@xht/contracts';

export interface LedgerAccountSnapshot {
  readonly accountId: LedgerAccountId;
  readonly ownerUid: Uid | null;
  readonly assetCode: string;
  readonly purpose: LedgerAccountPurpose;
  readonly status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  readonly version: number;
}

export interface OpenAccountInput {
  readonly ownerUid: Uid;
  readonly assetCode: string;
  readonly purpose: LedgerAccountPurpose;
  readonly idempotencyKey: string;
}

export interface LedgerAccountRepository {
  findAccount(
    context: TransactionContext,
    accountId: LedgerAccountId
  ): Promise<LedgerAccountSnapshot | null>;
  findAccountByOwner(
    context: TransactionContext,
    input: {
      readonly ownerUid: Uid;
      readonly assetCode: string;
      readonly purpose: LedgerAccountPurpose;
    }
  ): Promise<LedgerAccountSnapshot | null>;
  openUserAccount(
    context: TransactionContext,
    input: OpenAccountInput
  ): Promise<LedgerAccountSnapshot>;
}

export interface LedgerTransactionRepository {
  findTransactionIdByIdempotencyKey(
    context: TransactionContext,
    idempotencyKey: string
  ): Promise<string | null>;
  insertPostedTransaction(
    context: TransactionContext,
    command: PostMoneyCommand
  ): Promise<string>;
}
