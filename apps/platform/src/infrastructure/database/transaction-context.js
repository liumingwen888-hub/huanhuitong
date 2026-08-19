import { QueryCreator } from 'kysely';
const authenticTransactionContextErrors = new WeakSet();
export class TransactionContextError extends Error {
    code = 'TRANSACTION_CONTEXT_CLOSED';
    constructor() {
        super('TRANSACTION_CONTEXT_CLOSED');
        this.name = 'TransactionContextError';
        Object.defineProperty(this, 'stack', {
            value: 'TransactionContextError: TRANSACTION_CONTEXT_CLOSED',
            enumerable: false,
            writable: false,
            configurable: false
        });
        authenticTransactionContextErrors.add(this);
        Object.freeze(this);
    }
}
Object.freeze(TransactionContextError.prototype);
export function isAuthenticTransactionContextError(error) {
    return (typeof error === 'object' &&
        error !== null &&
        authenticTransactionContextErrors.has(error) &&
        Object.isFrozen(error) &&
        error instanceof TransactionContextError &&
        Object.getPrototypeOf(error) === TransactionContextError.prototype);
}
class RevocableLease {
    #active = true;
    assertActive() {
        if (!this.#active)
            throw new TransactionContextError();
    }
    revoke() {
        this.#active = false;
    }
}
class RevocableQueryExecutor {
    #delegate;
    #lease;
    constructor(delegate, lease) {
        this.#delegate = delegate;
        this.#lease = lease;
    }
    get adapter() {
        this.#lease.assertActive();
        return this.#delegate.adapter;
    }
    get plugins() {
        this.#lease.assertActive();
        return this.#delegate.plugins;
    }
    transformQuery(node, queryId) {
        this.#lease.assertActive();
        return this.#delegate.transformQuery(node, queryId);
    }
    compileQuery(node, queryId) {
        this.#lease.assertActive();
        return this.#delegate.compileQuery(node, queryId);
    }
    executeQuery(compiledQuery, options) {
        this.#lease.assertActive();
        return this.#delegate.executeQuery(compiledQuery, options);
    }
    async *stream(compiledQuery, chunkSize, options) {
        this.#lease.assertActive();
        for await (const result of this.#delegate.stream(compiledQuery, chunkSize, options)) {
            this.#lease.assertActive();
            yield result;
        }
    }
    provideConnection(consumer, options) {
        this.#lease.assertActive();
        return this.#delegate.provideConnection(consumer, options);
    }
    withConnectionProvider(connectionProvider) {
        this.#lease.assertActive();
        return new RevocableQueryExecutor(this.#delegate.withConnectionProvider(connectionProvider), this.#lease);
    }
    withPlugin(plugin) {
        this.#lease.assertActive();
        return new RevocableQueryExecutor(this.#delegate.withPlugin(plugin), this.#lease);
    }
    withPlugins(plugins) {
        this.#lease.assertActive();
        return new RevocableQueryExecutor(this.#delegate.withPlugins(plugins), this.#lease);
    }
    withPluginAtFront(plugin) {
        this.#lease.assertActive();
        return new RevocableQueryExecutor(this.#delegate.withPluginAtFront(plugin), this.#lease);
    }
    withoutPlugins() {
        this.#lease.assertActive();
        return new RevocableQueryExecutor(this.#delegate.withoutPlugins(), this.#lease);
    }
}
export function createTransactionContext(transactionExecutor, executeSql) {
    const lease = new RevocableLease();
    const database = new QueryCreator({
        executor: new RevocableQueryExecutor(transactionExecutor, lease)
    });
    const context = Object.freeze({
        database,
        executeSql(statement, parameters = []) {
            lease.assertActive();
            return executeSql(statement, parameters);
        }
    });
    let revoked = false;
    return Object.freeze({
        context,
        revoke() {
            if (revoked)
                return;
            revoked = true;
            lease.revoke();
        }
    });
}
//# sourceMappingURL=transaction-context.js.map