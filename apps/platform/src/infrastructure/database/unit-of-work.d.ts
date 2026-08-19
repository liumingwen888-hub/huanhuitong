import type { StageOneDatabase } from '@xht/contracts';
import { type Kysely } from 'kysely';
import { TransactionContextError, type TransactionContext } from './transaction-context.js';
export type UnitOfWorkErrorCode = 'NESTED_UNIT_OF_WORK' | 'TRANSACTION_ACQUIRE_FAILED' | 'TRANSACTION_BEGIN_FAILED' | 'TRANSACTION_CALLBACK_FAILED' | 'TRANSACTION_ABORTED_BEFORE_COMMIT' | 'TRANSACTION_ABORTED_AND_ROLLBACK_FAILED' | 'TRANSACTION_PRECOMMIT_CONNECTION_FAILED' | 'TRANSACTION_COMMIT_FAILED' | 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN' | 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED' | 'TRANSACTION_COMMIT_AND_ROLLBACK_FAILED' | 'TRANSACTION_COMMITTED_WITH_RELEASE_FAILURE' | 'TRANSACTION_CONTROL_STATEMENT_REJECTED' | 'TRANSACTION_QUERY_MULTISTATEMENT' | 'TRANSACTION_QUERY_UNSAFE' | 'TRANSACTION_INTERNAL_FAILED';
export type UnitOfWorkFailureCategory = 'CALLBACK' | 'PRECOMMIT' | 'COMMIT' | 'ROLLBACK' | 'RELEASE';
export type UnitOfWorkOutcome = 'NOT_COMMITTED' | 'ROLLED_BACK' | 'COMMITTED' | 'UNKNOWN';
export declare class UnitOfWorkError extends Error {
    readonly code: UnitOfWorkErrorCode;
    readonly outcome: UnitOfWorkOutcome;
    readonly retryable: false;
    readonly primaryCategory: UnitOfWorkFailureCategory | undefined;
    readonly cleanupCategory: UnitOfWorkFailureCategory | undefined;
    constructor(code: UnitOfWorkErrorCode, safeCause?: SafeCallbackError);
}
export declare class PublicUnitOfWorkError extends Error {
    readonly code: string;
    readonly retryable: false;
    constructor(code: string);
}
type SafeCallbackError = PublicUnitOfWorkError | TransactionContextError | UnitOfWorkError;
export interface UnitOfWork {
    readonly execute: <T>(work: (context: TransactionContext) => T | PromiseLike<T>) => Promise<T>;
}
export declare function createUnitOfWork(database: Kysely<StageOneDatabase>): UnitOfWork;
export {};
