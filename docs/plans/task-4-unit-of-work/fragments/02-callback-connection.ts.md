# CallbackConnection and UnitOfWork source suffix canonical fragment

[← Canonical fragments index](00-index.md) · [← Task 4 LAYOUT-S1 index](../00-index.md)

> LAYOUT-S1 navigation metadata. The fenced bytes below are canonical future engineering content frozen from Task 4 v1.9/v11. This fragment is not an implemented project source file.

- Reconstructed target: `apps/platform/src/infrastructure/database/unit-of-work.ts`
- Assembly sequence: 2 of 2
- Responsibility: CallbackConnection, CallbackLease, private control channel, createUnitOfWork and execution lifecycle.
- Segment bytes: 6160
- Segment lines: 226
- Segment SHA-256: `8AD4EBC0F13AEDA07ED6D4987D5827C018D26E913514367490F8D6B83C905C22`
- Full target bytes: 25165
- Full target SHA-256: `A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A`

<!-- XHT-CANONICAL-BEGIN target="apps/platform/src/infrastructure/database/unit-of-work.ts" sequence="2" -->
```ts
class CallbackConnection implements DatabaseConnection {
  readonly #delegate: DatabaseConnection;
  readonly #lease: { assertActive(): void };
  constructor(delegate: DatabaseConnection, lease: { assertActive(): void }) {
    this.#delegate = delegate;
    this.#lease = lease;
  }
  executeQuery<R>(
    compiled: CompiledQuery,
    options?: AbortableOperationOptions
  ): Promise<QueryResult<R>> {
    this.#assertAllowed(compiled.sql);
    return this.#delegate.executeQuery<R>(compiled, options);
  }

  streamQuery<R>(
    compiled: CompiledQuery,
    chunkSize: number,
    options?: AbortableOperationOptions
  ): AsyncIterableIterator<QueryResult<R>> {
    this.#assertAllowed(compiled.sql);
    return this.#delegate.streamQuery<R>(compiled, chunkSize, options);
  }

  #assertAllowed(sqlText: string): void {
    this.#lease.assertActive();
    const verdict = scanCallbackSql(sqlText);
    if (verdict.kind === 'multi') {
      throw new DatabaseTransactionControlError('DATABASE_TRANSACTION_QUERY_MULTISTATEMENT');
    }
    if (verdict.kind === 'control') {
      throw new DatabaseTransactionControlError('DATABASE_TRANSACTION_CONTROL_STATEMENT_REJECTED');
    }
    if (verdict.kind === 'unsafe') {
      throw new DatabaseTransactionControlError(
        'DATABASE_TRANSACTION_QUERY_UNSAFE'
      );
    }
  }
}

class CallbackLease {
  #active = true;
  assertActive(): void { if (!this.#active) throw new TransactionContextError(); }
  revoke(): void { this.#active = false; }
}

export interface UnitOfWork {
  readonly execute: <T>(
    work: (context: TransactionContext) => T | PromiseLike<T>
  ) => Promise<T>;
}

interface ExecutionMarker {
  active: boolean;
}

const executionMarker = new AsyncLocalStorage<ExecutionMarker>();
const BEGIN = CompiledQuery.raw('begin');
const PRECOMMIT_PROBE = CompiledQuery.raw(
  DATABASE_TRANSACTION_PRECOMMIT_PROBE_SQL
);
const COMMIT = CompiledQuery.raw('commit');
const ROLLBACK = CompiledQuery.raw('rollback');

async function rollback(connection: DatabaseConnection): Promise<boolean> {
  try {
    await connection.executeQuery(ROLLBACK);
    return true;
  } catch {
    return false;
  }
}

async function ensureCommitReady(
  connection: DatabaseConnection
): Promise<void> {
  try {
    await connection.executeQuery(PRECOMMIT_PROBE);
  } catch (error: unknown) {
    if (
      isControlError(
        error,
        'DATABASE_TRANSACTION_PRECOMMIT_ABORTED'
      )
    ) {
      if (await rollback(connection)) {
        throw new UnitOfWorkError(
          'TRANSACTION_ABORTED_BEFORE_COMMIT'
        );
      }
      throw new UnitOfWorkError(
        'TRANSACTION_ABORTED_AND_ROLLBACK_FAILED'
      );
    }
    throw new UnitOfWorkError(
      'TRANSACTION_PRECOMMIT_CONNECTION_FAILED'
    );
  }
}

async function commit(
  connection: DatabaseConnection
): Promise<void> {
  try {
    await connection.executeQuery(COMMIT);
  } catch (error: unknown) {
    if (
      isControlError(
        error,
        'DATABASE_TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
      )
    ) {
      throw new UnitOfWorkError(
        'TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
      );
    }
    if (await rollback(connection)) {
      throw new UnitOfWorkError('TRANSACTION_COMMIT_FAILED');
    }
    throw new UnitOfWorkError(
      'TRANSACTION_COMMIT_AND_ROLLBACK_FAILED'
    );
  }
}

async function executeOnConnection<T>(
  root: Kysely<StageOneDatabase>,
  connection: DatabaseConnection,
  work: (context: TransactionContext) => T | PromiseLike<T>
): Promise<T> {
  try {
    await connection.executeQuery(BEGIN);
  } catch {
    throw new UnitOfWorkError('TRANSACTION_BEGIN_FAILED');
  }

  const callbackLease = new CallbackLease();
  const callbackConnection = new CallbackConnection(connection, callbackLease);
  const transactionExecutor = root
    .getExecutor()
    .withConnectionProvider(new SingleConnectionProvider(callbackConnection));
  const lease = createTransactionContext(
    transactionExecutor,
    <R>(
      statement: string,
      parameters: ReadonlyArray<unknown> = []
    ): Promise<QueryResult<R>> =>
      callbackConnection.executeQuery<R>(
        CompiledQuery.raw(statement, [...parameters])
      )
  );
  let result!: T;
  let callbackError: unknown;
  let callbackFailed = false;

  try {
    result = await work(lease.context);
  } catch (error: unknown) {
    callbackFailed = true;
    callbackError = error;
  } finally {
    lease.revoke();
    callbackLease.revoke();
  }

  if (callbackFailed) {
    callbackFailure(callbackError, await rollback(connection));
  }

  await ensureCommitReady(connection);
  await commit(connection);
  return result;
}

export function createUnitOfWork(
  database: Kysely<StageOneDatabase>
): UnitOfWork {
  async function executeRoot<T>(
    work: (context: TransactionContext) => T | PromiseLike<T>
  ): Promise<T> {
    let acquired = false;
    try {
      return await database.getExecutor().provideConnection(
        async (connection) => {
          acquired = true;
          return executeOnConnection(database, connection, work);
        }
      );
    } catch (error: unknown) {
      if (!acquired) {
        throw new UnitOfWorkError('TRANSACTION_ACQUIRE_FAILED');
      }
      if (isSafeCallbackError(error)) throw error;
      if (
        error instanceof DatabaseConnectionReleaseError &&
        Object.isFrozen(error) &&
        error.code ===
          'DATABASE_CONNECTION_RELEASE_FAILED_AFTER_COMMIT'
      ) {
        throw new UnitOfWorkError(
          'TRANSACTION_COMMITTED_WITH_RELEASE_FAILURE'
        );
      }
      throw new UnitOfWorkError('TRANSACTION_INTERNAL_FAILED');
    }
  }

  function execute<T>(
    work: (context: TransactionContext) => T | PromiseLike<T>
  ): Promise<T> {
    if (executionMarker.getStore()?.active === true) {
      return Promise.reject(new UnitOfWorkError('NESTED_UNIT_OF_WORK'));
    }
    const marker: ExecutionMarker = { active: true };
    return executionMarker.run(marker, async () => {
      try {
        return await executeRoot(work);
      } finally {
        marker.active = false;
      }
    });
  }

  return Object.freeze({ execute });
}
```
<!-- XHT-CANONICAL-END target="apps/platform/src/infrastructure/database/unit-of-work.ts" sequence="2" -->
