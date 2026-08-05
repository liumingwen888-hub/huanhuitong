# Unit of Work integration spec prefix canonical fragment

[← Canonical fragments index](00-index.md) · [← Task 4 LAYOUT-S1 index](../00-index.md)

> LAYOUT-S1 navigation metadata. The fenced bytes below are canonical future engineering content frozen from Task 4 v1.9/v11. This fragment is not an implemented project source file.

- Reconstructed target: `apps/platform/test/database/unit-of-work.integration.spec.ts`
- Assembly sequence: 1 of 5
- Responsibility: Imports, fixtures, scripted database, observers, safety helpers, setup/cleanup and describe boundary.
- Segment bytes: 31460
- Segment lines: 1139
- Segment SHA-256: `2FD69656F5222354A7C88F59257E03AD7F6E1E3029F311FDE90B6BE29C3773D2`
- Full target bytes: 113197
- Full target SHA-256: `FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789`

<!-- XHT-CANONICAL-BEGIN target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="1" -->
```ts
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { StageOneDatabase } from '@xht/contracts';
import {
  CompiledQuery,
  Kysely,
  PostgresDialect,
  SingleConnectionProvider,
  sql,
  type KyselyPlugin,
  type PostgresClient,
  type PostgresCursor,
  type PostgresPool,
  type PostgresPoolClient,
  type PostgresQueryResult,
  type QueryCreator,
  type QueryResult,
  type RootOperationNode,
  type SelectQueryBuilder,
  type UnknownRow
} from 'kysely';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import { RoleEnforcingPostgresPool } from '../../src/infrastructure/database/database.js';

interface ExtendedQueryConfig {
  readonly text: string;
  readonly values: ReadonlyArray<unknown>;
  readonly queryMode: 'extended';
}

interface DestroyablePoolClient extends PostgresPoolClient {
  query<R>(statement: string, parameters: ReadonlyArray<unknown>): Promise<PostgresQueryResult<R>>;
  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(config: ExtendedQueryConfig): Promise<PostgresQueryResult<R>>;
  release(destroy?: boolean): void;
}

interface RuntimePool extends PostgresPool {
  readonly Client: NonNullable<PostgresPool['Client']>;
  connect(): Promise<DestroyablePoolClient>;
  query<R>(
    statement: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<{ readonly rows: R[] }>;
}

interface RuntimePoolOptions {
  readonly connectionString: string;
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly allowExitOnIdle: false;
  readonly application_name: string;
}

type RuntimePoolConstructor = new (
  options: RuntimePoolOptions
) => RuntimePool;

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as {
  readonly Pool: RuntimePoolConstructor;
};

interface ReleaseEvidence {
  readonly pid: number;
  readonly destroy: boolean;
}

interface QueryEvidence {
  readonly text: string;
  readonly values: readonly unknown[];
  readonly queryMode: string | undefined;
}

class ObservablePoolClient implements DestroyablePoolClient {
  readonly #client: DestroyablePoolClient;
  readonly #pid: number;
  readonly #evidence: ReleaseEvidence[];
  readonly #queries: QueryEvidence[];

  constructor(
    client: DestroyablePoolClient,
    pid: number,
    evidence: ReleaseEvidence[],
    queries: QueryEvidence[]
  ) {
    this.#client = client;
    this.#pid = pid;
    this.#evidence = evidence;
    this.#queries = queries;
  }

  query<R>(
    statement: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<PostgresQueryResult<R>>;
  query<R>(config: ExtendedQueryConfig): Promise<PostgresQueryResult<R>>;
  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(
    input:
      | string
      | PostgresCursor<R>
      | ExtendedQueryConfig,
    parameters: ReadonlyArray<unknown> = []
  ): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof input === 'object' && 'text' in input) {
      this.#queries.push({ text: input.text, values: input.values, queryMode: input.queryMode });
      return this.#client.query<R>(input);
    }
    if (typeof input === 'string') {
      this.#queries.push({ text: input, values: parameters, queryMode: undefined });
      return this.#client.query<R>(input, parameters);
    }
    this.#queries.push({ text: '<cursor>', values: [], queryMode: undefined });
    return this.#client.query(input);
  }

  release(destroy = false): void {
    this.#evidence.push({ pid: this.#pid, destroy });
    this.#client.release(destroy);
  }
}

class ObservableRuntimePool implements PostgresPool {
  readonly Client: NonNullable<PostgresPool['Client']>;
  readonly options: object;
  readonly #pool: RuntimePool;
  readonly #evidence: ReleaseEvidence[];
  readonly #queries: QueryEvidence[];

  constructor(pool: RuntimePool, evidence: ReleaseEvidence[], queries: QueryEvidence[]) {
    this.#pool = pool;
    this.#evidence = evidence;
    this.#queries = queries;
    this.Client = pool.Client;
    this.options = pool.options;
  }

  async connect(): Promise<PostgresPoolClient> {
    const client = await this.#pool.connect();
    const observed = await client.query<{ readonly pid: number }>(
      'select pg_backend_pid()::integer as pid',
      []
    );
    const pid = observed.rows[0]?.pid;
    if (pid === undefined) {
      client.release(true);
      throw new Error('OBSERVABLE_POOL_PID_MISSING');
    }
    return new ObservablePoolClient(client, pid, this.#evidence, this.#queries);
  }

  end(): Promise<void> {
    return this.#pool.end();
  }
}

type ContextModule = typeof import(
  '../../src/infrastructure/database/transaction-context.js'
);
type UnitOfWorkModule = typeof import(
  '../../src/infrastructure/database/unit-of-work.js'
);
type FutureTransactionContext = import(
  '../../src/infrastructure/database/transaction-context.js'
).TransactionContext;
type FutureUnitOfWork = import(
  '../../src/infrastructure/database/unit-of-work.js'
).UnitOfWork;
type ContextLease = ReturnType<ContextModule['createTransactionContext']>;

const projectRoot = resolve(import.meta.dirname, '../../../..');
const contextModulePath =
  '../../src/infrastructure/database/transaction-context.js';
const unitOfWorkModulePath =
  '../../src/infrastructure/database/unit-of-work.js';
const transactionPrecommitProbeSql =
  'select 1 as xht_transaction_precommit_probe';
const flywaySources = {
  projectRoot,
  configFile: 'database/flyway.toml',
  migrationsDirectory: 'database/migrations',
  callbacksDirectory: 'database/flyway-callbacks'
} as const;

let fixture: PostgresFixture;
let database: Kysely<StageOneDatabase>;
let queryExecutionCount = 0;
let unitOfWorkModuleLoadCount = 0;
const realReleaseEvidence: ReleaseEvidence[] = [];
const realQueryEvidence: QueryEvidence[] = [];
const scriptedOnly = process.env['XHT_TASK4_SCRIPTED_ONLY'] === '1';

async function loadContextModule(): Promise<ContextModule> {
  return import(contextModulePath);
}

async function loadUnitOfWorkModule(): Promise<UnitOfWorkModule> {
  unitOfWorkModuleLoadCount += 1;
  return import(unitOfWorkModulePath);
}

const countingPlugin = {
  transformQuery(args: {
    readonly node: RootOperationNode;
  }): RootOperationNode {
    queryExecutionCount += 1;
    return args.node;
  },
  async transformResult(args: {
    readonly result: QueryResult<UnknownRow>;
  }): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
} satisfies KyselyPlugin;

const identityPlugin = {
  transformQuery(args: {
    readonly node: RootOperationNode;
  }): RootOperationNode {
    return args.node;
  },
  async transformResult(args: {
    readonly result: QueryResult<UnknownRow>;
  }): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
} satisfies KyselyPlugin;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface ScriptedState {
  readonly queries: string[];
  readonly acquiredClientIds: number[];
  readonly normalReleaseIds: number[];
  readonly destroyReleaseIds: number[];
  connectCount: number;
  endCount: number;
  acquireFailures: number;
  beginFailures: number;
  commitRejectedFailures: number;
  commitUnknownFailures: number;
  rollbackFailures: number;
  probeAbortedFailures: number;
  probeConnectionFailures: number;
  normalReleaseFailures: number;
  destroyReleaseFailures: number;
  readonly queryEvidence: QueryEvidence[];
  readonly commitStarted?: Deferred<void>;
  readonly allowCommit?: Deferred<void>;
}

function createScriptedState(
  overrides: Partial<ScriptedState> = {}
): ScriptedState {
  return {
    queries: [],
    acquiredClientIds: [],
    normalReleaseIds: [],
    destroyReleaseIds: [],
    connectCount: 0,
    endCount: 0,
    acquireFailures: 0,
    beginFailures: 0,
    commitRejectedFailures: 0,
    commitUnknownFailures: 0,
    rollbackFailures: 0,
    probeAbortedFailures: 0,
    probeConnectionFailures: 0,
    normalReleaseFailures: 0,
    destroyReleaseFailures: 0,
    queryEvidence: [],
    ...overrides
  };
}

interface SyntheticPgError extends Error {
  readonly code: string;
  readonly detail: string;
  readonly constraint: string;
  readonly sql: string;
  readonly parameters: readonly string[];
  readonly user: string;
  readonly connectionString: string;
  readonly password: string;
}

function syntheticPgError(code: string): SyntheticPgError {
  return Object.assign(new Error('synthetic-raw-message'), {
    code,
    detail: 'synthetic-raw-detail',
    constraint: 'synthetic-raw-constraint',
    sql: 'select synthetic-raw-sql',
    parameters: ['synthetic-raw-parameter'],
    user: 'synthetic-raw-user',
    connectionString: 'postgresql://synthetic-raw-connection',
    password: 'synthetic-raw-password'
  });
}

class ScriptedClient implements DestroyablePoolClient {
  readonly id: number;
  readonly #state: ScriptedState;
  readonly #returnToPool: (client: ScriptedClient) => void;
  #released = false;

  constructor(
    id: number,
    state: ScriptedState,
    returnToPool: (client: ScriptedClient) => void
  ) {
    this.id = id;
    this.#state = state;
    this.#returnToPool = returnToPool;
  }

  reserve(): void {
    this.#released = false;
  }

  query<R>(
    statement: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<PostgresQueryResult<R>>;
  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(config: ExtendedQueryConfig): Promise<PostgresQueryResult<R>>;
  query<R>(
    input: string | PostgresCursor<R> | ExtendedQueryConfig,
    parameters: ReadonlyArray<unknown> = []
  ): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof input === 'object' && 'text' in input) {
      this.#state.queryEvidence.push({
        text: input.text,
        values: input.values,
        queryMode: input.queryMode
      });
      const statement = input.text.trim().replaceAll(/\s+/gu, ' ').toLowerCase();
      return this.#execute<R>(statement);
    }
    if (typeof input !== 'string') return input;
    this.#state.queryEvidence.push({
      text: input,
      values: parameters,
      queryMode: undefined
    });
    const statement = input.trim().replaceAll(/\s+/gu, ' ').toLowerCase();
    return this.#execute<R>(statement);
  }

  release(destroy = false): void {
    if (this.#released) return;
    if (destroy) {
      this.#state.destroyReleaseIds.push(this.id);
      if (this.#state.destroyReleaseFailures > 0) {
        this.#state.destroyReleaseFailures -= 1;
        throw syntheticPgError('ECONNRESET');
      }
      this.#released = true;
      return;
    }
    this.#state.normalReleaseIds.push(this.id);
    if (this.#state.normalReleaseFailures > 0) {
      this.#state.normalReleaseFailures -= 1;
      throw syntheticPgError('ECONNRESET');
    }
    this.#released = true;
    this.#returnToPool(this);
  }

  async #execute<R>(statement: string): Promise<PostgresQueryResult<R>> {
    if (statement === 'select session_user') {
      return this.#result<R>([
        { session_user: 'xht_platform_test_login' }
      ]);
    }
    if (statement === 'set role xht_platform') {
      return this.#result<R>([]);
    }
    if (statement === 'select current_user') {
      return this.#result<R>([{ current_user: 'xht_platform' }]);
    }
    this.#state.queries.push(statement);
    if (statement === 'begin' && this.#state.beginFailures > 0) {
      this.#state.beginFailures -= 1;
      throw syntheticPgError('ECONNRESET');
    }
    if (
      statement === transactionPrecommitProbeSql &&
      this.#state.probeAbortedFailures > 0
    ) {
      this.#state.probeAbortedFailures -= 1;
      throw syntheticPgError('25P02');
    }
    if (
      statement === transactionPrecommitProbeSql &&
      this.#state.probeConnectionFailures > 0
    ) {
      this.#state.probeConnectionFailures -= 1;
      throw syntheticPgError('ECONNRESET');
    }
    if (statement === 'commit') {
      this.#state.commitStarted?.resolve();
      await this.#state.allowCommit?.promise;
      if (this.#state.commitRejectedFailures > 0) {
        this.#state.commitRejectedFailures -= 1;
        throw syntheticPgError('40001');
      }
      if (this.#state.commitUnknownFailures > 0) {
        this.#state.commitUnknownFailures -= 1;
        throw syntheticPgError('ECONNRESET');
      }
    }
    if (statement === 'rollback' && this.#state.rollbackFailures > 0) {
      this.#state.rollbackFailures -= 1;
      throw syntheticPgError('ECONNRESET');
    }
    return this.#result<R>([]);
  }

  #result<R>(rows: unknown[]): PostgresQueryResult<R> {
    return {
      command: 'SELECT',
      rowCount: 0,
      rows: rows as R[]
    };
  }
}

class ScriptedControlClient implements PostgresClient {
  constructor(_options: unknown = undefined) {}

  async connect(): Promise<PostgresClient> {
    return this;
  }

  end(): void {}

  query<R>(
    _statement: string,
    _parameters: ReadonlyArray<unknown>
  ): Promise<PostgresQueryResult<R>>;
  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(
    input: string | PostgresCursor<R>,
    _parameters: ReadonlyArray<unknown> = []
  ): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof input !== 'string') return input;
    return Promise.resolve({
      command: 'SELECT',
      rowCount: 0,
      rows: []
    });
  }
}

class ScriptedPool implements PostgresPool {
  readonly Client = ScriptedControlClient;
  readonly options = {};
  readonly #state: ScriptedState;
  readonly #idle: ScriptedClient[] = [];
  #nextClientId = 1;

  constructor(state: ScriptedState) {
    this.#state = state;
  }

  async connect(): Promise<PostgresPoolClient> {
    this.#state.connectCount += 1;
    if (this.#state.acquireFailures > 0) {
      this.#state.acquireFailures -= 1;
      throw syntheticPgError('ECONNRESET');
    }
    const client =
      this.#idle.pop() ??
      new ScriptedClient(
        this.#nextClientId++,
        this.#state,
        (released) => this.#idle.push(released)
      );
    client.reserve();
    this.#state.acquiredClientIds.push(client.id);
    return client;
  }

  async end(): Promise<void> {
    this.#state.endCount += 1;
    this.#idle.length = 0;
  }
}

function createScriptedDatabase(
  state: ScriptedState
): Kysely<StageOneDatabase> {
  const rawPool = new ScriptedPool(state);
  const rolePool = new RoleEnforcingPostgresPool(
    rawPool as never,
    'xht_platform_test_login'
  );
  return new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: rolePool
    })
  });
}

async function withManualContext<T>(
  work: (lease: ContextLease) => Promise<T> | T
): Promise<T> {
  const contextModule = await loadContextModule();
  const manualDatabase = scriptedOnly
    ? createScriptedDatabase(createScriptedState())
    : database;
  try {
    return await manualDatabase.getExecutor().provideConnection(async (connection) => {
    await connection.executeQuery(CompiledQuery.raw('begin'));
    const transactionExecutor = manualDatabase
      .getExecutor()
      .withConnectionProvider(new SingleConnectionProvider(connection));
    const lease = contextModule.createTransactionContext(
      transactionExecutor,
      <R>(
        statement: string,
        parameters: ReadonlyArray<unknown> = []
      ): Promise<QueryResult<R>> =>
        connection.executeQuery<R>(
          CompiledQuery.raw(statement, [...parameters])
        )
    );
    try {
      return await work(lease);
    } finally {
      lease.revoke();
      await connection.executeQuery(CompiledQuery.raw('rollback'));
    }
    });
  } finally {
    if (scriptedOnly) await manualDatabase.destroy();
  }
}

async function countUser(uid: string): Promise<number> {
  const rows = await database
    .selectFrom('users')
    .select('uid')
    .where('uid', '=', uid)
    .execute();
  return rows.length;
}

async function insertUser(
  target: QueryCreator<StageOneDatabase>,
  uid: string
): Promise<void> {
  await target
    .insertInto('users')
    .values({ uid, status: 'ACTIVE' })
    .execute();
}

async function backendPid(
  target: QueryCreator<StageOneDatabase>
): Promise<number> {
  const row = await target
    .selectFrom(
      sql<{ readonly pid: number }>`(
        select pg_backend_pid()::integer as pid
      )`.as('backend')
    )
    .select('backend.pid')
    .executeTakeFirstOrThrow();
  return row.pid;
}

function assertContextTypeSurface(
  context: FutureTransactionContext
): void {
  // @ts-expect-error TransactionContext exposes no transaction capability.
  void context.database.transaction;
  // @ts-expect-error TransactionContext exposes no connection capability.
  void context.database.connection;
  // @ts-expect-error TransactionContext exposes no destroy capability.
  void context.database.destroy;
  // @ts-expect-error TransactionContext exposes no executor capability.
  void context.database.getExecutor;
}

type CleanupCategory =
  | 'DATABASE_DESTROY_FAILED'
  | 'RAW_POOL_END_FAILED'
  | 'FIXTURE_STOP_FAILED';

class TestResourceError extends Error {
  readonly code:
    | 'TEST_RESOURCE_SETUP_FAILED'
    | 'TEST_RESOURCE_CLEANUP_FAILED';
  readonly categories: readonly CleanupCategory[];

  constructor(
    code: TestResourceError['code'],
    categories: readonly CleanupCategory[] = []
  ) {
    super(code);
    this.name = 'TestResourceError';
    this.code = code;
    this.categories = Object.freeze([...categories]);
    Object.freeze(this);
  }
}

interface DatabaseResource {
  readonly destroy: () => Promise<void>;
}

interface RawPoolResource {
  readonly end: () => Promise<void>;
}

interface FixtureResource {
  readonly stop: () => Promise<void>;
}

class TestResourceOwner {
  #database: DatabaseResource | undefined;
  #rawPool: RawPoolResource | undefined;
  #fixture: FixtureResource | undefined;
  #closePromise: Promise<void> | undefined;
  databaseDestroyCount = 0;
  rawPoolEndCount = 0;
  fixtureStopCount = 0;

  ownDatabase(databaseResource: DatabaseResource): void {
    if (this.#database !== undefined) {
      throw new TestResourceError('TEST_RESOURCE_SETUP_FAILED');
    }
    this.#database = databaseResource;
    this.#rawPool = undefined;
  }

  ownRawPool(rawPoolResource: RawPoolResource): void {
    if (
      this.#rawPool !== undefined ||
      this.#database !== undefined
    ) {
      throw new TestResourceError('TEST_RESOURCE_SETUP_FAILED');
    }
    this.#rawPool = rawPoolResource;
  }

  ownFixture(fixtureResource: FixtureResource): void {
    if (this.#fixture !== undefined) {
      throw new TestResourceError('TEST_RESOURCE_SETUP_FAILED');
    }
    this.#fixture = fixtureResource;
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    this.#closePromise = promise;
    void this.#closeAll().then(resolve, reject);
    return promise;
  }

  async #closeAll(): Promise<void> {
    const failures: CleanupCategory[] = [];
    if (this.#database !== undefined) {
      this.databaseDestroyCount += 1;
      try {
        await this.#database.destroy();
      } catch {
        failures.push('DATABASE_DESTROY_FAILED');
      }
    } else if (this.#rawPool !== undefined) {
      this.rawPoolEndCount += 1;
      try {
        await this.#rawPool.end();
      } catch {
        failures.push('RAW_POOL_END_FAILED');
      }
    }
    if (this.#fixture !== undefined) {
      this.fixtureStopCount += 1;
      try {
        await this.#fixture.stop();
      } catch {
        failures.push('FIXTURE_STOP_FAILED');
      }
    }
    if (failures.length > 0) {
      throw new TestResourceError(
        'TEST_RESOURCE_CLEANUP_FAILED',
        failures
      );
    }
  }
}

type SetupAction<T> = T | PromiseLike<T>;

interface ResourceSetupOperations<
  Fixture extends FixtureResource,
  RawPool extends RawPoolResource,
  Database extends DatabaseResource
> {
  readonly startFixture: () => SetupAction<Fixture>;
  readonly afterFixture?: (fixture: Fixture) => SetupAction<void>;
  readonly migrate: (fixture: Fixture) => SetupAction<unknown>;
  readonly createRawPool: (
    fixture: Fixture
  ) => SetupAction<RawPool>;
  readonly afterRawPool?: (
    rawPool: RawPool,
    fixture: Fixture
  ) => SetupAction<void>;
  readonly createDatabase: (
    rawPool: RawPool,
    fixture: Fixture
  ) => SetupAction<Database>;
  readonly afterDatabase?: (
    databaseResource: Database,
    fixture: Fixture
  ) => SetupAction<void>;
}

async function setupOwnedResources<
  Fixture extends FixtureResource,
  RawPool extends RawPoolResource,
  Database extends DatabaseResource
>(
  owner: TestResourceOwner,
  operations: ResourceSetupOperations<Fixture, RawPool, Database>
): Promise<{
  readonly fixture: Fixture;
  readonly database: Database;
}> {
  try {
    const ownedFixture = await operations.startFixture();
    owner.ownFixture(ownedFixture);
    await operations.afterFixture?.(ownedFixture);
    await operations.migrate(ownedFixture);

    const rawPool = await operations.createRawPool(ownedFixture);
    owner.ownRawPool(rawPool);
    await operations.afterRawPool?.(rawPool, ownedFixture);

    const ownedDatabase = await operations.createDatabase(
      rawPool,
      ownedFixture
    );
    owner.ownDatabase(ownedDatabase);
    await operations.afterDatabase?.(
      ownedDatabase,
      ownedFixture
    );
    return Object.freeze({
      fixture: ownedFixture,
      database: ownedDatabase
    });
  } catch {
    let cleanupCategories: readonly CleanupCategory[] = [];
    try {
      await owner.close();
    } catch (cleanupError: unknown) {
      cleanupCategories =
        cleanupError instanceof TestResourceError &&
        cleanupError.code === 'TEST_RESOURCE_CLEANUP_FAILED'
          ? cleanupError.categories
          : Object.freeze([]);
    }
    throw new TestResourceError(
      'TEST_RESOURCE_SETUP_FAILED',
      cleanupCategories
    );
  }
}

type InjectedSetupFailurePoint =
  | 'AFTER_FIXTURE'
  | 'AFTER_RAW_POOL'
  | 'AFTER_DATABASE';

type InjectedCleanupFailure =
  | 'NONE'
  | 'RAW_POOL'
  | 'DATABASE';

interface InjectedSetupEvidence {
  fixtureStopCount: number;
  rawPoolEndCount: number;
  databaseDestroyCount: number;
  readonly calls: string[];
}

function createInjectedSetupOperations(
  failurePoint: InjectedSetupFailurePoint,
  cleanupFailure: InjectedCleanupFailure,
  evidence: InjectedSetupEvidence
): ResourceSetupOperations<
  FixtureResource,
  RawPoolResource,
  DatabaseResource
> {
  const failAt = (
    point: InjectedSetupFailurePoint
  ): void => {
    if (failurePoint === point) {
      throw syntheticPgError('ECONNRESET');
    }
  };
  return {
    async startFixture(): Promise<FixtureResource> {
      evidence.calls.push('fixture:start');
      return {
        async stop(): Promise<void> {
          evidence.fixtureStopCount += 1;
          evidence.calls.push('fixture:stop');
        }
      };
    },
    afterFixture(): void {
      failAt('AFTER_FIXTURE');
    },
    async migrate(): Promise<void> {
      evidence.calls.push('migrate');
    },
    createRawPool(): RawPoolResource {
      evidence.calls.push('raw:create');
      return {
        async end(): Promise<void> {
          evidence.rawPoolEndCount += 1;
          evidence.calls.push('raw:end');
          if (cleanupFailure === 'RAW_POOL') {
            throw syntheticPgError('ECONNRESET');
          }
        }
      };
    },
    afterRawPool(): void {
      failAt('AFTER_RAW_POOL');
    },
    createDatabase(): DatabaseResource {
      evidence.calls.push('database:create');
      return {
        async destroy(): Promise<void> {
          evidence.databaseDestroyCount += 1;
          evidence.calls.push('database:destroy');
          if (cleanupFailure === 'DATABASE') {
            throw syntheticPgError('ECONNRESET');
          }
        }
      };
    },
    afterDatabase(): void {
      failAt('AFTER_DATABASE');
    }
  };
}

const resources = new TestResourceOwner();

async function createRealUnitOfWork(): Promise<
  FutureUnitOfWork
> {
  return (await loadUnitOfWorkModule()).createUnitOfWork(database);
}

async function terminateBackend(pid: number): Promise<void> {
  const adminPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: false,
    application_name: 'xht-task4-fault-controller'
  });
  try {
    const observed = await adminPool.query<{
      readonly terminated: boolean;
    }>(
      'select pg_terminate_backend($1::integer) as terminated',
      [pid]
    );
    expect(observed.rows[0]?.terminated).toBe(true);
  } finally {
    await adminPool.end();
  }
}

interface PublicSurface {
  readonly fieldNames: string[];
  readonly text: string[];
}

function collectPublicSurface(
  value: unknown,
  surface: PublicSurface = {
    fieldNames: [],
    text: []
  },
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0
): PublicSurface {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    surface.text.push(String(value));
    return surface;
  }
  if (depth > 12 || seen.has(value)) return surface;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const fieldName =
      typeof key === 'symbol'
        ? key.description ?? 'symbol'
        : key;
    surface.fieldNames.push(fieldName);
    surface.text.push(fieldName);
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      collectPublicSurface(
        descriptor.value,
        surface,
        seen,
        depth + 1
      );
    }
  }
  return surface;
}

function rawLeakHitCount(error: unknown): number {
  const surface = collectPublicSurface(error);
  const publicText = surface.text.join('\n');
  const forbiddenValues = [
    'synthetic-raw-message',
    'synthetic-raw-detail',
    'synthetic-raw-constraint',
    'synthetic-raw-sql',
    'synthetic-raw-parameter',
    'synthetic-raw-user',
    'synthetic-raw-connection',
    'synthetic-raw-password'
  ];
  const forbiddenFields = [
    'detail',
    'constraint',
    'schema',
    'table',
    'column',
    'dataType',
    'where',
    'sql',
    'parameters',
    'user',
    'connectionString',
    'password'
  ];
  return (
    forbiddenValues.filter((forbidden) => publicText.includes(forbidden)).length +
    forbiddenFields.filter((field) => surface.fieldNames.includes(field)).length
  );
}

function expectNoRawLeak(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  expect(rawLeakHitCount(error)).toBe(0);
}

function expectUnitErrorContract(
  error: unknown,
  expected: {
    readonly code: string;
    readonly outcome: string;
    readonly cause?: unknown;
  }
): void {
  expect(error).toMatchObject({
    code: expected.code,
    message: expected.code,
    outcome: expected.outcome,
    retryable: false
  });
  if ('cause' in expected) {
    expect((error as Error).cause).toBe(expected.cause);
  } else {
    expect(error).not.toHaveProperty('cause');
  }
  expectNoRawLeak(error);
}

const errorPollution = [
  ['code', 'APPLICATION_SYNTHETIC_RAW_CODE'],
  ['name', 'synthetic-raw-name'],
  ['message', 'synthetic-raw-message'],
  ['cause', syntheticPgError('23505')],
  ['outcome', 'synthetic-raw-outcome'],
  ['retryable', true],
  ['primaryCategory', 'synthetic-raw-primary-category'],
  ['cleanupCategory', 'synthetic-raw-cleanup-category'],
  ['detail', 'synthetic-raw-detail'],
  ['constraint', 'synthetic-raw-constraint'],
  ['sql', 'select synthetic-raw-sql'],
  ['parameters', ['synthetic-raw-parameter']],
  ['password', 'synthetic-raw-password'],
  ['stack', 'synthetic-raw-stack']
] as const;

function expectErrorPollutionRejected(error: Error): void {
  for (const [field, value] of errorPollution) {
    expect(
      Reflect.set(error, field, value),
      `Reflect.set accepted ${field} on ${error.name}`
    ).toBe(false);
    expect(
      Reflect.defineProperty(error, field, {
        value,
        enumerable: true,
        writable: true,
        configurable: true
      }),
      `Reflect.defineProperty accepted ${field} on ${error.name}`
    ).toBe(false);
  }
}

function forgeIdentitySafeError(prototype: object): Error {
  const error = Object.create(prototype) as Error &
    Record<string, unknown>;
  for (const [field, value] of [
    ['code', 'APPLICATION_SYNTHETIC_RAW_CODE'],
    ['name', 'synthetic-raw-name'],
    ['message', 'synthetic-raw-message'],
    ['cause', syntheticPgError('23505')],
    ['outcome', 'synthetic-raw-outcome'],
    ['retryable', true],
    ['primaryCategory', 'synthetic-raw-primary-category'],
    ['cleanupCategory', 'synthetic-raw-cleanup-category'],
    ['detail', 'synthetic-raw-detail'],
    ['constraint', 'synthetic-raw-constraint'],
    ['sql', 'select synthetic-raw-sql'],
    ['parameters', ['synthetic-raw-parameter']],
    ['password', 'synthetic-raw-password'],
    ['stack', 'synthetic-raw-stack']
  ] as const) {
    expect(
      Reflect.defineProperty(error, field, {
        value,
        enumerable: true,
        writable: true,
        configurable: true
      })
    ).toBe(true);
  }
  return Object.freeze(error);
}

beforeAll(async () => {
  if (scriptedOnly) return;
  const setup = await setupOwnedResources<
    PostgresFixture,
    RuntimePool,
    Kysely<StageOneDatabase>
  >(resources, {
    startFixture: () =>
      startPostgresFixture({
        projectRoot,
        startupTimeoutMillis: 120_000,
        stopTimeoutMillis: 10_000
      }),
    migrate: (ownedFixture) =>
      migrateAndValidate(ownedFixture, flywaySources),
    createRawPool: (ownedFixture) =>
      new Pool({
        connectionString:
          ownedFixture.platformLogin.connectionString,
        max: 4,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 10_000,
        allowExitOnIdle: false,
        application_name: 'xht-task4-unit-of-work'
      }),
    createDatabase: (rawPool, ownedFixture) => {
       const observablePool = new ObservableRuntimePool(
         rawPool,
         realReleaseEvidence,
         realQueryEvidence
       );
      const rolePool = new RoleEnforcingPostgresPool(
        observablePool as never,
        ownedFixture.platformLogin.username
      );
      return new Kysely<StageOneDatabase>({
        dialect: new PostgresDialect({ pool: rolePool }),
        plugins: [countingPlugin]
      });
    }
  });
  fixture = setup.fixture;
  database = setup.database;
}, 180_000);

afterAll(async () => {
  if (scriptedOnly) return;
  await resources.close();
  expect(resources.databaseDestroyCount).toBe(1);
  expect(resources.fixtureStopCount).toBe(1);
}, 180_000);

describe.sequential('Task 4 Unit of Work', () => {
```
<!-- XHT-CANONICAL-END target="apps/platform/test/database/unit-of-work.integration.spec.ts" sequence="1" -->
