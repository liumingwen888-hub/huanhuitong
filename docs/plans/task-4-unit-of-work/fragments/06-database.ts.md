# Database source canonical fragment

[← Canonical fragments index](00-index.md) · [← Task 4 LAYOUT-S1 index](../00-index.md)

> LAYOUT-S1 navigation metadata. The fenced bytes below are canonical future engineering content frozen from Task 4 v1.9/v11. This fragment is not an implemented project source file.

- Reconstructed target: `apps/platform/src/infrastructure/database/database.ts`
- Assembly sequence: 1 of 1
- Responsibility: Complete RoleEnforcingPostgresPool, query overload and extended-query future modification.
- Segment bytes: 14767
- Segment lines: 474
- Segment SHA-256: `455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C`
- Full target bytes: 14767
- Full target SHA-256: `455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C`

<!-- XHT-CANONICAL-BEGIN target="apps/platform/src/infrastructure/database/database.ts" sequence="1" -->
```ts
import { createRequire } from 'node:module';
import type { StageOneDatabase } from '@xht/contracts';
import {
  Kysely,
  PostgresDialect,
  QueryCreator,
  sql,
  type PostgresCursor,
  type PostgresPool,
  type PostgresPoolClient,
  type PostgresQueryResult
} from 'kysely';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as {
  readonly Pool: PostgresPoolConstructor;
};

const DATABASE_BINDING = Object.freeze({
  expectedRole: 'xht_platform',
  setRoleSql: 'SET ROLE xht_platform'
} as const);
const SESSION_USER_SQL = 'select session_user' as const;
const CURRENT_USER_SQL = 'select current_user' as const;
const ROLE_EVIDENCE_SQL = 'select session_user, current_user' as const;
export const DATABASE_TRANSACTION_PRECOMMIT_PROBE_SQL =
  'select 1 as xht_transaction_precommit_probe' as const;
const COMMIT_REJECTION_SQLSTATES = new Set([
  '23503',
  '23505',
  '23514',
  '23P01',
  '25006',
  '40001',
  '40P01'
]);
const MAX_CONNECTIONS = 64;
const MAX_CONNECTION_TIMEOUT_MILLIS = 120_000;
const MAX_IDLE_TIMEOUT_MILLIS = 600_000;
const MAX_CONNECTION_STRING_LENGTH = 4_096;
const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;
const APPLICATION_NAME = /^[A-Za-z0-9._-]{1,63}$/u;

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}
interface SessionUserRow {
  readonly session_user: string;
}
interface CurrentUserRow {
  readonly current_user: string;
}
interface RoleEvidenceRow extends SessionUserRow, CurrentUserRow {}
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
interface PostgresPoolOptions {
  readonly connectionString: string;
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly allowExitOnIdle: false;
  readonly application_name: string;
}
type PostgresPoolConstructor = new (
  options: PostgresPoolOptions
) => RuntimePostgresPool;

export type DatabaseRoleErrorCode =
  | 'DATABASE_SESSION_USER_MISMATCH'
  | 'DATABASE_ROLE_MISMATCH'
  | 'DATABASE_CONNECTION_FAILED'
  | 'DATABASE_CLOSE_FAILED'
  | 'DATABASE_CLOSED';

export class DatabaseRoleError extends Error {
  readonly code: DatabaseRoleErrorCode;
  constructor(code: DatabaseRoleErrorCode) {
    super(code);
    this.name = 'DatabaseRoleError';
    this.code = code;
  }
}

export type DatabaseTransactionControlErrorCode =
  | 'DATABASE_TRANSACTION_BEGIN_FAILED'
  | 'DATABASE_TRANSACTION_COMMIT_REJECTED'
  | 'DATABASE_TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
  | 'DATABASE_TRANSACTION_ROLLBACK_FAILED'
  | 'DATABASE_TRANSACTION_PRECOMMIT_ABORTED'
  | 'DATABASE_TRANSACTION_PRECOMMIT_CONNECTION_FAILED'
  | 'DATABASE_TRANSACTION_CONTROL_STATEMENT_REJECTED'
  | 'DATABASE_TRANSACTION_QUERY_MULTISTATEMENT'
  | 'DATABASE_TRANSACTION_QUERY_UNSAFE';

export class DatabaseTransactionControlError extends Error {
  readonly code: DatabaseTransactionControlErrorCode;

  constructor(code: DatabaseTransactionControlErrorCode) {
    super(code);
    this.name = 'DatabaseTransactionControlError';
    this.code = code;
  }
}

export class DatabaseConnectionReleaseError extends Error {
  readonly code = 'DATABASE_CONNECTION_RELEASE_FAILED_AFTER_COMMIT' as const;
  readonly outcome = 'COMMITTED' as const;
  readonly retryable = false as const;

  constructor() {
    super('DATABASE_CONNECTION_RELEASE_FAILED_AFTER_COMMIT');
    this.name = 'DatabaseConnectionReleaseError';
    Object.freeze(this);
  }
}

interface TransactionControlFailure {
  readonly code: DatabaseTransactionControlErrorCode;
  readonly destroyConnection: boolean;
}

function readSqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

function classifyTransactionControlFailure(
  statement: string,
  error: unknown
): TransactionControlFailure | undefined {
  const normalized = statement.trim().replaceAll(/\s+/gu, ' ').toLowerCase();
  if (
    normalized === 'begin' ||
    normalized === 'start transaction' ||
    normalized.startsWith('start transaction ')
  ) {
    return {
      code: 'DATABASE_TRANSACTION_BEGIN_FAILED',
      destroyConnection: true
    };
  }
  if (normalized === 'rollback') {
    return {
      code: 'DATABASE_TRANSACTION_ROLLBACK_FAILED',
      destroyConnection: true
    };
  }
  if (normalized === 'commit') {
    const sqlState = readSqlState(error);
    return {
      code:
        sqlState !== undefined && COMMIT_REJECTION_SQLSTATES.has(sqlState)
          ? 'DATABASE_TRANSACTION_COMMIT_REJECTED'
          : 'DATABASE_TRANSACTION_COMMIT_OUTCOME_UNKNOWN',
      destroyConnection: true
    };
  }
  if (normalized === DATABASE_TRANSACTION_PRECOMMIT_PROBE_SQL) {
    const transactionAborted = readSqlState(error) === '25P02';
    return {
      code: transactionAborted
        ? 'DATABASE_TRANSACTION_PRECOMMIT_ABORTED'
        : 'DATABASE_TRANSACTION_PRECOMMIT_CONNECTION_FAILED',
      destroyConnection: !transactionAborted
    };
  }
  return undefined;
}

class TransactionSafePostgresPoolClient implements PostgresPoolClient {
  readonly #client: DestructiblePostgresPoolClient;
  #destroyOnRelease = false;
  #outcome:
    | 'NOT_COMMITTED'
    | 'ROLLED_BACK'
    | 'COMMITTED'
    | 'UNKNOWN' = 'NOT_COMMITTED';
  #released = false;

  constructor(client: DestructiblePostgresPoolClient) {
    this.#client = client;
  }

  query<R>(
    statement: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<PostgresQueryResult<R>>;
  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(
    input: string | PostgresCursor<R>,
    parameters: ReadonlyArray<unknown> = []
  ): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof input !== 'string') return this.#client.query(input);
    return this.#execute<R>(input, parameters);
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    if (this.#destroyOnRelease) {
      try {
        this.#client.release(true);
      } catch {
        // A failed destroy-release never replaces the transaction outcome.
      }
      return;
    }
    try {
      this.#client.release();
      return;
    } catch {
      try {
        this.#client.release(true);
      } catch {
        // The fallback was attempted; raw cleanup failures stay private.
      }
    }
    if (this.#outcome === 'COMMITTED') {
      throw new DatabaseConnectionReleaseError();
    }
  }

  async #execute<R>(
    statement: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<PostgresQueryResult<R>> {
    const normalized = statement
      .trim()
      .replaceAll(/\s+/gu, ' ')
      .toLowerCase();
    try {
      const result = await this.#client.query<R>({
        text: statement,
        values: parameters,
        queryMode: 'extended'
      });
      if (normalized === 'commit') this.#outcome = 'COMMITTED';
      if (normalized === 'rollback') this.#outcome = 'ROLLED_BACK';
      return result;
    } catch (error: unknown) {
      const failure = classifyTransactionControlFailure(statement, error);
      if (failure === undefined) throw error;
      this.#destroyOnRelease ||= failure.destroyConnection;
      if (
        failure.code ===
        'DATABASE_TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
      ) {
        this.#outcome = 'UNKNOWN';
      }
      throw new DatabaseTransactionControlError(failure.code);
    }
  }
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

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise();
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
function isBoundedPositiveSafeInteger(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}
function validateOptions(options: DatabaseConnectionOptions): void {
  const valid =
    options.connectionString.length > 0 &&
    options.connectionString.length <= MAX_CONNECTION_STRING_LENGTH &&
    POSTGRES_IDENTIFIER.test(options.expectedSessionUser) &&
    APPLICATION_NAME.test(options.applicationName) &&
    isBoundedPositiveSafeInteger(options.maxConnections, MAX_CONNECTIONS) &&
    isBoundedPositiveSafeInteger(
      options.connectionTimeoutMillis,
      MAX_CONNECTION_TIMEOUT_MILLIS
    ) &&
    isBoundedPositiveSafeInteger(
      options.idleTimeoutMillis,
      MAX_IDLE_TIMEOUT_MILLIS
    );
  if (!valid) throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
}

export class RoleEnforcingPostgresPool implements PostgresPool {
  readonly Client: NonNullable<PostgresPool['Client']>;
  readonly options: object;
  readonly #pool: RuntimePostgresPool;
  readonly #expectedSessionUser: string;
  #endPromise: Promise<void> | undefined;

  constructor(pool: RuntimePostgresPool, expectedSessionUser: string) {
    this.#pool = pool;
    this.#expectedSessionUser = expectedSessionUser;
    this.Client = pool.Client;
    this.options = pool.options;
  }

  async connect(): Promise<PostgresPoolClient> {
    let client: DestructiblePostgresPoolClient;
    try {
      client = await this.#pool.connect();
    } catch {
      throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
    }
    try {
      const before = await client.query<SessionUserRow>(SESSION_USER_SQL, []);
      if (before.rows[0]?.session_user !== this.#expectedSessionUser) {
        throw new DatabaseRoleError('DATABASE_SESSION_USER_MISMATCH');
      }
      await client.query(DATABASE_BINDING.setRoleSql, []);
      const after = await client.query<CurrentUserRow>(CURRENT_USER_SQL, []);
      if (after.rows[0]?.current_user !== DATABASE_BINDING.expectedRole) {
        throw new DatabaseRoleError('DATABASE_ROLE_MISMATCH');
      }
      return new TransactionSafePostgresPoolClient(client);
    } catch (error: unknown) {
      try {
        client.release(true);
      } catch {
        // The destroy-release was invoked exactly once; its body is never public.
      }
      if (error instanceof DatabaseRoleError) throw error;
      throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
    }
  }

  end(): Promise<void> {
    if (this.#endPromise !== undefined) return this.#endPromise;
    const deferred = createDeferred();
    this.#endPromise = deferred.promise;
    try {
      const ending = this.#pool.end();
      void ending.then(
        deferred.resolve,
        () => deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'))
      );
    } catch {
      deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'));
    }
    return this.#endPromise;
  }
}

async function finishDatabaseClose(
  database: Kysely<StageOneDatabase>,
  pool: RoleEnforcingPostgresPool
): Promise<void> {
  let failed = false;
  try {
    await database.destroy();
  } catch {
    failed = true;
  }
  try {
    await pool.end();
  } catch {
    failed = true;
  }
  if (failed) throw new DatabaseRoleError('DATABASE_CLOSE_FAILED');
}

function createRoleBoundDatabase(
  options: DatabaseConnectionOptions
): RoleBoundDatabase {
  validateOptions(options);
  const rawPool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections,
    connectionTimeoutMillis: options.connectionTimeoutMillis,
    idleTimeoutMillis: options.idleTimeoutMillis,
    allowExitOnIdle: false,
    application_name: options.applicationName
  });
  const rolePool = new RoleEnforcingPostgresPool(
    rawPool,
    options.expectedSessionUser
  );
  const database = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({ pool: rolePool })
  });
  const managedDatabase = new QueryCreator<StageOneDatabase>({
    executor: database.getExecutor()
  });
  let closed = false;
  let closePromise: Promise<void> | undefined;

  async function verifyRole(): Promise<DatabaseRoleEvidence> {
    if (closed) throw new DatabaseRoleError('DATABASE_CLOSED');
    try {
      const evidence = await sql<RoleEvidenceRow>`${sql.raw(
        ROLE_EVIDENCE_SQL
      )}`.execute(database);
      const row = evidence.rows[0];
      if (row?.session_user !== options.expectedSessionUser) {
        throw new DatabaseRoleError('DATABASE_SESSION_USER_MISMATCH');
      }
      if (row.current_user !== DATABASE_BINDING.expectedRole) {
        throw new DatabaseRoleError('DATABASE_ROLE_MISMATCH');
      }
      return {
        sessionUser: row.session_user,
        currentUser: DATABASE_BINDING.expectedRole
      };
    } catch (error: unknown) {
      if (error instanceof DatabaseRoleError) throw error;
      throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
    }
  }

  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    const deferred = createDeferred();
    closePromise = deferred.promise;
    try {
      const finishing = finishDatabaseClose(database, rolePool);
      void finishing.then(
        deferred.resolve,
        () => deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'))
      );
    } catch {
      deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'));
    }
    return closePromise;
  }

  return { db: managedDatabase, verifyRole, close };
}

export function createPlatformDatabase(
  options: DatabaseConnectionOptions
): RoleBoundDatabase {
  return createRoleBoundDatabase(options);
}
```
<!-- XHT-CANONICAL-END target="apps/platform/src/infrastructure/database/database.ts" sequence="1" -->
