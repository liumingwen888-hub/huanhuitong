import { createRequire } from 'node:module';
import type { StageOneDatabase } from '@xht/contracts';
import {
  Kysely,
  PostgresDialect,
  QueryCreator,
  sql,
  type PostgresPool,
  type PostgresPoolClient
} from 'kysely';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as {
  readonly Pool: PostgresPoolConstructor;
};

const DATABASE_BINDING = Object.freeze({
  expectedRole: 'xht_worker',
  setRoleSql: 'SET ROLE xht_worker'
} as const);
const SESSION_USER_SQL = 'select session_user' as const;
const CURRENT_USER_SQL = 'select current_user' as const;
const ROLE_EVIDENCE_SQL = 'select session_user, current_user' as const;
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
interface DestructiblePostgresPoolClient extends PostgresPoolClient {
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
      return client;
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

export function createWorkerDatabase(
  options: DatabaseConnectionOptions
): RoleBoundDatabase {
  return createRoleBoundDatabase(options);
}
