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
  lockAccount(
    context: TransactionContext,
    accountId: LedgerAccountId
  ): Promise<LedgerAccountSnapshot | null>;
  signedBalance(
    context: Parameters<LedgerAccountRepository['accountBalance']>[0],
    accountId: LedgerAccountId
  ): Promise<string>;
  accountBalance(
    context: TransactionContext,
    accountId: LedgerAccountId
  ): Promise<string>;
  bumpAccountVersions(
    context: TransactionContext,
    accountIds: readonly LedgerAccountId[]
  ): Promise<void>;
  applyProjectionDelta(
    context: TransactionContext,
    input: {
      readonly accountId: LedgerAccountId;
      readonly delta: bigint;
      readonly transactionId: string;
    }
  ): Promise<void>;
  upsertProjectionAbsolute(
    context: TransactionContext,
    input: {
      readonly accountId: LedgerAccountId;
      readonly signedBalance: string;
      readonly transactionId: string | null;
    }
  ): Promise<void>;
  readProjection(
    context: TransactionContext,
    accountId: LedgerAccountId
  ): Promise<{ readonly signedBalance: string } | null>;
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
  findTransactionWithLines(
    context: TransactionContext,
    transactionId: string
  ): Promise<{
    readonly status: 'POSTED' | 'REVERSED';
    readonly transactionType: string;
    readonly reversedBy: string | null;
    readonly lines: readonly {
      readonly accountId: LedgerAccountId;
      readonly direction: 'DEBIT' | 'CREDIT';
      readonly amount: string;
    }[];
  } | null>;
  insertReversalTransaction(
    context: TransactionContext,
    input: {
      readonly idempotencyKey: string;
      readonly originalTransactionId: string;
      readonly lines: readonly {
        readonly accountId: LedgerAccountId;
        readonly direction: 'DEBIT' | 'CREDIT';
        readonly amount: string;
      }[];
    }
  ): Promise<string>;
  markOriginalReversed(
    context: TransactionContext,
    input: {
      readonly originalTransactionId: string;
      readonly reversalTransactionId: string;
    }
  ): Promise<boolean>;
}
