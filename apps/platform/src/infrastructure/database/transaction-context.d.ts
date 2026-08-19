import type { StageOneDatabase } from '@xht/contracts';
import { QueryCreator, type QueryExecutor, type QueryResult } from 'kysely';
export type TransactionDatabase = QueryCreator<StageOneDatabase>;
export interface TransactionContext {
    readonly database: TransactionDatabase;
    readonly executeSql: <R>(statement: string, parameters?: ReadonlyArray<unknown>) => Promise<QueryResult<R>>;
}
export declare class TransactionContextError extends Error {
    readonly code: 'TRANSACTION_CONTEXT_CLOSED';
    constructor();
}
export declare function isAuthenticTransactionContextError(error: unknown): error is TransactionContextError;
export interface TransactionContextLease {
    readonly context: TransactionContext;
    readonly revoke: () => void;
}
export declare function createTransactionContext(transactionExecutor: QueryExecutor, executeSql: <R>(statement: string, parameters?: ReadonlyArray<unknown>) => Promise<QueryResult<R>>): TransactionContextLease;
