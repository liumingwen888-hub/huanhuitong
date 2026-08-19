import { createRequire } from 'node:module';
import { Kysely, PostgresDialect, QueryCreator, sql } from 'kysely';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const DATABASE_BINDING = Object.freeze({
    expectedRole: 'xht_platform',
    setRoleSql: 'SET ROLE xht_platform'
});
const SESSION_USER_SQL = 'select session_user';
const CURRENT_USER_SQL = 'select current_user';
const ROLE_EVIDENCE_SQL = 'select session_user, current_user';
export const DATABASE_TRANSACTION_PRECOMMIT_PROBE_SQL = 'select 1 as xht_transaction_precommit_probe';
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
export class DatabaseRoleError extends Error {
    code;
    constructor(code) {
        super(code);
        this.name = 'DatabaseRoleError';
        this.code = code;
    }
}
export class DatabaseTransactionControlError extends Error {
    code;
    constructor(code) {
        super(code);
        this.name = 'DatabaseTransactionControlError';
        this.code = code;
    }
}
export class DatabaseConnectionReleaseError extends Error {
    code = 'DATABASE_CONNECTION_RELEASE_FAILED_AFTER_COMMIT';
    outcome = 'COMMITTED';
    retryable = false;
    constructor() {
        super('DATABASE_CONNECTION_RELEASE_FAILED_AFTER_COMMIT');
        this.name = 'DatabaseConnectionReleaseError';
        Object.freeze(this);
    }
}
function readSqlState(error) {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return undefined;
    }
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}
function classifyTransactionControlFailure(statement, error) {
    const normalized = statement.trim().replaceAll(/\s+/gu, ' ').toLowerCase();
    if (normalized === 'begin' ||
        normalized === 'start transaction' ||
        normalized.startsWith('start transaction ')) {
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
            code: sqlState !== undefined && COMMIT_REJECTION_SQLSTATES.has(sqlState)
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
class TransactionSafePostgresPoolClient {
    #client;
    #destroyOnRelease = false;
    #outcome = 'NOT_COMMITTED';
    #released = false;
    constructor(client) {
        this.#client = client;
    }
    query(input, parameters = []) {
        if (typeof input !== 'string')
            return this.#client.query(input);
        return this.#execute(input, parameters);
    }
    release() {
        if (this.#released)
            return;
        this.#released = true;
        if (this.#destroyOnRelease) {
            try {
                this.#client.release(true);
            }
            catch {
                // A failed destroy-release never replaces the transaction outcome.
            }
            return;
        }
        try {
            this.#client.release();
            return;
        }
        catch {
            try {
                this.#client.release(true);
            }
            catch {
                // The fallback was attempted; raw cleanup failures stay private.
            }
        }
        if (this.#outcome === 'COMMITTED') {
            throw new DatabaseConnectionReleaseError();
        }
    }
    async #execute(statement, parameters) {
        const normalized = statement
            .trim()
            .replaceAll(/\s+/gu, ' ')
            .toLowerCase();
        try {
            const result = await this.#client.query({
                text: statement,
                values: parameters,
                queryMode: 'extended'
            });
            if (normalized === 'commit')
                this.#outcome = 'COMMITTED';
            if (normalized === 'rollback')
                this.#outcome = 'ROLLED_BACK';
            return result;
        }
        catch (error) {
            const failure = classifyTransactionControlFailure(statement, error);
            if (failure === undefined)
                throw error;
            this.#destroyOnRelease ||= failure.destroyConnection;
            if (failure.code ===
                'DATABASE_TRANSACTION_COMMIT_OUTCOME_UNKNOWN') {
                this.#outcome = 'UNKNOWN';
            }
            throw new DatabaseTransactionControlError(failure.code);
        }
    }
}
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = () => resolvePromise();
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}
function isBoundedPositiveSafeInteger(value, maximum) {
    return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}
function validateOptions(options) {
    const valid = options.connectionString.length > 0 &&
        options.connectionString.length <= MAX_CONNECTION_STRING_LENGTH &&
        POSTGRES_IDENTIFIER.test(options.expectedSessionUser) &&
        APPLICATION_NAME.test(options.applicationName) &&
        isBoundedPositiveSafeInteger(options.maxConnections, MAX_CONNECTIONS) &&
        isBoundedPositiveSafeInteger(options.connectionTimeoutMillis, MAX_CONNECTION_TIMEOUT_MILLIS) &&
        isBoundedPositiveSafeInteger(options.idleTimeoutMillis, MAX_IDLE_TIMEOUT_MILLIS);
    if (!valid)
        throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
}
export class RoleEnforcingPostgresPool {
    Client;
    options;
    #pool;
    #expectedSessionUser;
    #endPromise;
    constructor(pool, expectedSessionUser) {
        this.#pool = pool;
        this.#expectedSessionUser = expectedSessionUser;
        this.Client = pool.Client;
        this.options = pool.options;
    }
    async connect() {
        let client;
        try {
            client = await this.#pool.connect();
        }
        catch {
            throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
        }
        try {
            const before = await client.query(SESSION_USER_SQL, []);
            if (before.rows[0]?.session_user !== this.#expectedSessionUser) {
                throw new DatabaseRoleError('DATABASE_SESSION_USER_MISMATCH');
            }
            await client.query(DATABASE_BINDING.setRoleSql, []);
            const after = await client.query(CURRENT_USER_SQL, []);
            if (after.rows[0]?.current_user !== DATABASE_BINDING.expectedRole) {
                throw new DatabaseRoleError('DATABASE_ROLE_MISMATCH');
            }
            return new TransactionSafePostgresPoolClient(client);
        }
        catch (error) {
            try {
                client.release(true);
            }
            catch {
                // The destroy-release was invoked exactly once; its body is never public.
            }
            if (error instanceof DatabaseRoleError)
                throw error;
            throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
        }
    }
    end() {
        if (this.#endPromise !== undefined)
            return this.#endPromise;
        const deferred = createDeferred();
        this.#endPromise = deferred.promise;
        try {
            const ending = this.#pool.end();
            void ending.then(deferred.resolve, () => deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED')));
        }
        catch {
            deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'));
        }
        return this.#endPromise;
    }
}
async function finishDatabaseClose(database, pool) {
    let failed = false;
    try {
        await database.destroy();
    }
    catch {
        failed = true;
    }
    try {
        await pool.end();
    }
    catch {
        failed = true;
    }
    if (failed)
        throw new DatabaseRoleError('DATABASE_CLOSE_FAILED');
}
function createRoleBoundDatabase(options) {
    validateOptions(options);
    const rawPool = new Pool({
        connectionString: options.connectionString,
        max: options.maxConnections,
        connectionTimeoutMillis: options.connectionTimeoutMillis,
        idleTimeoutMillis: options.idleTimeoutMillis,
        allowExitOnIdle: false,
        application_name: options.applicationName
    });
    const rolePool = new RoleEnforcingPostgresPool(rawPool, options.expectedSessionUser);
    const database = new Kysely({
        dialect: new PostgresDialect({ pool: rolePool })
    });
    const managedDatabase = new QueryCreator({
        executor: database.getExecutor()
    });
    let closed = false;
    let closePromise;
    async function verifyRole() {
        if (closed)
            throw new DatabaseRoleError('DATABASE_CLOSED');
        try {
            const evidence = await sql `${sql.raw(ROLE_EVIDENCE_SQL)}`.execute(database);
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
        }
        catch (error) {
            if (error instanceof DatabaseRoleError)
                throw error;
            throw new DatabaseRoleError('DATABASE_CONNECTION_FAILED');
        }
    }
    function close() {
        if (closePromise !== undefined)
            return closePromise;
        closed = true;
        const deferred = createDeferred();
        closePromise = deferred.promise;
        try {
            const finishing = finishDatabaseClose(database, rolePool);
            void finishing.then(deferred.resolve, () => deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED')));
        }
        catch {
            deferred.reject(new DatabaseRoleError('DATABASE_CLOSE_FAILED'));
        }
        return closePromise;
    }
    return { db: managedDatabase, verifyRole, close };
}
export function createPlatformDatabase(options) {
    return createRoleBoundDatabase(options);
}
//# sourceMappingURL=database.js.map