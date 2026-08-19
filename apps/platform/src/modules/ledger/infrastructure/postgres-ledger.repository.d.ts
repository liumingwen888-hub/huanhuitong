import type { LedgerAccountId, LedgerAccountPurpose, PostMoneyCommand, Uid } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type { LedgerAccountRepository, LedgerAccountSnapshot, LedgerTransactionRepository, OpenAccountInput } from '../application/ledger.repository.js';
export declare class PostgresLedgerAccountRepository implements LedgerAccountRepository {
    findAccount(context: TransactionContext, accountId: LedgerAccountId): Promise<LedgerAccountSnapshot | null>;
    findAccountByOwner(context: TransactionContext, input: {
        readonly ownerUid: Uid;
        readonly assetCode: string;
        readonly purpose: LedgerAccountPurpose;
    }): Promise<LedgerAccountSnapshot | null>;
    openUserAccount(context: TransactionContext, input: OpenAccountInput): Promise<LedgerAccountSnapshot>;
    lockAccount(context: TransactionContext, accountId: LedgerAccountId): Promise<LedgerAccountSnapshot | null>;
    accountBalance(context: TransactionContext, accountId: LedgerAccountId): Promise<string>;
    bumpAccountVersions(context: TransactionContext, accountIds: readonly LedgerAccountId[]): Promise<void>;
    applyProjectionDelta(context: TransactionContext, input: {
        readonly accountId: LedgerAccountId;
        readonly delta: bigint;
        readonly transactionId: string;
    }): Promise<void>;
    upsertProjectionAbsolute(context: TransactionContext, input: {
        readonly accountId: LedgerAccountId;
        readonly signedBalance: string;
        readonly transactionId: string | null;
    }): Promise<void>;
    readProjection(context: TransactionContext, accountId: LedgerAccountId): Promise<{
        readonly signedBalance: string;
    } | null>;
}
export declare class PostgresLedgerTransactionRepository implements LedgerTransactionRepository {
    findTransactionIdByIdempotencyKey(context: TransactionContext, idempotencyKey: string): Promise<string | null>;
    insertPostedTransaction(context: TransactionContext, command: PostMoneyCommand): Promise<string>;
    findTransactionWithLines(context: TransactionContext, transactionId: string): Promise<{
        readonly status: 'POSTED' | 'REVERSED';
        readonly transactionType: string;
        readonly reversedBy: string | null;
        readonly lines: readonly {
            readonly accountId: LedgerAccountId;
            readonly direction: 'DEBIT' | 'CREDIT';
            readonly amount: string;
        }[];
    } | null>;
    insertReversalTransaction(context: TransactionContext, input: {
        readonly idempotencyKey: string;
        readonly originalTransactionId: string;
        readonly lines: readonly {
            readonly accountId: LedgerAccountId;
            readonly direction: 'DEBIT' | 'CREDIT';
            readonly amount: string;
        }[];
    }): Promise<string>;
    markOriginalReversed(context: TransactionContext, input: {
        readonly originalTransactionId: string;
        readonly reversalTransactionId: string;
    }): Promise<boolean>;
}
