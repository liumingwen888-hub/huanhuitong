import type { StageOneDatabase } from '@xht/contracts';
import { QueryCreator, type PostgresCursor, type PostgresPool, type PostgresPoolClient, type PostgresQueryResult } from 'kysely';
export declare const DATABASE_TRANSACTION_PRECOMMIT_PROBE_SQL: 'select 1 as xht_transaction_precommit_probe';
interface ExtendedQueryConfig {
    readonly text: string;
    readonly values: ReadonlyArray<unknown>;
    readonly queryMode: 'extended';
}
interface DestructiblePostgresPoolClient extends PostgresPoolClient {
    query<R>(sql: string, parameters: ReadonlyArray<unknown>): Promise<PostgresQueryResult<R>>;
    query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
    query<R>(config: ExtendedQueryConfig): Promise<PostgresQueryResult<R>>;
    release(destroy?: boolean): void;
}
interface RuntimePostgresPool extends PostgresPool {
    readonly Client: NonNullable<PostgresPool['Client']>;
    readonly options: object;
    connect(): Promise<DestructiblePostgresPoolClient>;
    end(): Promise<void>;
}
export type DatabaseRoleErrorCode = 'DATABASE_SESSION_USER_MISMATCH' | 'DATABASE_ROLE_MISMATCH' | 'DATABASE_CONNECTION_FAILED' | 'DATABASE_CLOSE_FAILED' | 'DATABASE_CLOSED';
export declare class DatabaseRoleError extends Error {
    readonly code: DatabaseRoleErrorCode;
    constructor(code: DatabaseRoleErrorCode);
}
export type DatabaseTransactionControlErrorCode = 'DATABASE_TRANSACTION_BEGIN_FAILED' | 'DATABASE_TRANSACTION_COMMIT_REJECTED' | 'DATABASE_TRANSACTION_COMMIT_OUTCOME_UNKNOWN' | 'DATABASE_TRANSACTION_ROLLBACK_FAILED' | 'DATABASE_TRANSACTION_PRECOMMIT_ABORTED' | 'DATABASE_TRANSACTION_PRECOMMIT_CONNECTION_FAILED' | 'DATABASE_TRANSACTION_CONTROL_STATEMENT_REJECTED' | 'DATABASE_TRANSACTION_QUERY_MULTISTATEMENT' | 'DATABASE_TRANSACTION_QUERY_UNSAFE';
export declare class DatabaseTransactionControlError extends Error {
    readonly code: DatabaseTransactionControlErrorCode;
    constructor(code: DatabaseTransactionControlErrorCode);
}
export declare class DatabaseConnectionReleaseError extends Error {
    readonly code: 'DATABASE_CONNECTION_RELEASE_FAILED_AFTER_COMMIT';
    readonly outcome: 'COMMITTED';
    readonly retryable: false;
    constructor();
}
export interface DatabaseConnectionOptions {
    readonly connectionString: string;
    readonly expectedSessionUser: string;
    readonly maxConnections: number;
    readonly connectionTimeoutMillis: number;
    readonly idleTimeoutMillis: number;
    readonly applicationName: string;
}
export interface DatabaseRoleEvidence {
    readonly sessionUser: string;
    readonly currentUser: 'xht_platform' | 'xht_worker';
}
export type ManagedDatabase = QueryCreator<StageOneDatabase>;
export interface RoleBoundDatabase {
    readonly db: ManagedDatabase;
    readonly verifyRole: () => Promise<DatabaseRoleEvidence>;
    readonly close: () => Promise<void>;
}
export declare class RoleEnforcingPostgresPool implements PostgresPool {
    #private;
    readonly Client: NonNullable<PostgresPool['Client']>;
    readonly options: object;
    constructor(pool: RuntimePostgresPool, expectedSessionUser: string);
    connect(): Promise<PostgresPoolClient>;
    end(): Promise<void>;
}
export declare function createPlatformDatabase(options: DatabaseConnectionOptions): RoleBoundDatabase;
export {};
