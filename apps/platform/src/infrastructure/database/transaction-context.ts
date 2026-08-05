import type { StageOneDatabase } from '@xht/contracts';
import {
  QueryCreator,
  type AbortableOperationOptions,
  type AbortableQueryOptions,
  type CompiledQuery,
  type ConnectionProvider,
  type DatabaseConnection,
  type DialectAdapter,
  type KyselyPlugin,
  type QueryExecutor,
  type QueryId,
  type QueryResult,
  type RootOperationNode
} from 'kysely';

export type TransactionDatabase = QueryCreator<StageOneDatabase>;

export interface TransactionContext {
  readonly database: TransactionDatabase;
  readonly executeSql: <R>(
    statement: string,
    parameters?: ReadonlyArray<unknown>
  ) => Promise<QueryResult<R>>;
}

const authenticTransactionContextErrors = new WeakSet<object>();

export class TransactionContextError extends Error {
  readonly code = 'TRANSACTION_CONTEXT_CLOSED' as const;

  constructor() {
    super('TRANSACTION_CONTEXT_CLOSED');
    this.name = 'TransactionContextError';
    Object.defineProperty(this, 'stack', {
      value:
        'TransactionContextError: TRANSACTION_CONTEXT_CLOSED',
      enumerable: false,
      writable: false,
      configurable: false
    });
    authenticTransactionContextErrors.add(this);
    Object.freeze(this);
  }
}

Object.freeze(TransactionContextError.prototype);

export function isAuthenticTransactionContextError(
  error: unknown
): error is TransactionContextError {
  return (
    typeof error === 'object' &&
    error !== null &&
    authenticTransactionContextErrors.has(error) &&
    Object.isFrozen(error) &&
    error instanceof TransactionContextError &&
    Object.getPrototypeOf(error) === TransactionContextError.prototype
  );
}

export interface TransactionContextLease {
  readonly context: TransactionContext;
  readonly revoke: () => void;
}

class RevocableLease {
  #active = true;

  assertActive(): void {
    if (!this.#active) throw new TransactionContextError();
  }

  revoke(): void {
    this.#active = false;
  }
}

class RevocableQueryExecutor implements QueryExecutor {
  readonly #delegate: QueryExecutor;
  readonly #lease: RevocableLease;

  constructor(delegate: QueryExecutor, lease: RevocableLease) {
    this.#delegate = delegate;
    this.#lease = lease;
  }

  get adapter(): DialectAdapter {
    this.#lease.assertActive();
    return this.#delegate.adapter;
  }

  get plugins(): ReadonlyArray<KyselyPlugin> {
    this.#lease.assertActive();
    return this.#delegate.plugins;
  }

  transformQuery<T extends RootOperationNode>(
    node: T,
    queryId: QueryId
  ): T {
    this.#lease.assertActive();
    return this.#delegate.transformQuery(node, queryId);
  }

  compileQuery<R = unknown>(
    node: RootOperationNode,
    queryId: QueryId
  ): CompiledQuery<R> {
    this.#lease.assertActive();
    return this.#delegate.compileQuery<R>(node, queryId);
  }

  executeQuery<R>(
    compiledQuery: CompiledQuery<R>,
    options?: AbortableQueryOptions
  ): Promise<QueryResult<R>> {
    this.#lease.assertActive();
    return this.#delegate.executeQuery(compiledQuery, options);
  }

  async *stream<R>(
    compiledQuery: CompiledQuery<R>,
    chunkSize: number,
    options?: AbortableOperationOptions
  ): AsyncIterableIterator<QueryResult<R>> {
    this.#lease.assertActive();
    for await (const result of this.#delegate.stream(
      compiledQuery,
      chunkSize,
      options
    )) {
      this.#lease.assertActive();
      yield result;
    }
  }

  provideConnection<T>(
    consumer: (connection: DatabaseConnection) => Promise<T>,
    options?: AbortableOperationOptions
  ): Promise<T> {
    this.#lease.assertActive();
    return this.#delegate.provideConnection(consumer, options);
  }

  withConnectionProvider(
    connectionProvider: ConnectionProvider
  ): QueryExecutor {
    this.#lease.assertActive();
    return new RevocableQueryExecutor(
      this.#delegate.withConnectionProvider(connectionProvider),
      this.#lease
    );
  }

  withPlugin(plugin: KyselyPlugin): QueryExecutor {
    this.#lease.assertActive();
    return new RevocableQueryExecutor(
      this.#delegate.withPlugin(plugin),
      this.#lease
    );
  }

  withPlugins(plugins: ReadonlyArray<KyselyPlugin>): QueryExecutor {
    this.#lease.assertActive();
    return new RevocableQueryExecutor(
      this.#delegate.withPlugins(plugins),
      this.#lease
    );
  }

  withPluginAtFront(plugin: KyselyPlugin): QueryExecutor {
    this.#lease.assertActive();
    return new RevocableQueryExecutor(
      this.#delegate.withPluginAtFront(plugin),
      this.#lease
    );
  }

  withoutPlugins(): QueryExecutor {
    this.#lease.assertActive();
    return new RevocableQueryExecutor(
      this.#delegate.withoutPlugins(),
      this.#lease
    );
  }
}

export function createTransactionContext(
  transactionExecutor: QueryExecutor,
  executeSql: <R>(
    statement: string,
    parameters?: ReadonlyArray<unknown>
  ) => Promise<QueryResult<R>>
): TransactionContextLease {
  const lease = new RevocableLease();
  const database = new QueryCreator<StageOneDatabase>({
    executor: new RevocableQueryExecutor(transactionExecutor, lease)
  });
  const context = Object.freeze({
    database,
    executeSql<R>(
      statement: string,
      parameters: ReadonlyArray<unknown> = []
    ): Promise<QueryResult<R>> {
      lease.assertActive();
      return executeSql<R>(statement, parameters);
    }
  });
  let revoked = false;

  return Object.freeze({
    context,
    revoke(): void {
      if (revoked) return;
      revoked = true;
      lease.revoke();
    }
  });
}
