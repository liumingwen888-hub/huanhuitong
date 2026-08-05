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
  it('UOW01: sync callback returns scalar after a successful commit', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      await expect(local.execute(() => 41)).resolves.toBe(41);
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit'
      ]);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW02: async callback preserves object identity and commits', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const expected = Object.freeze({ uid });
    const observed = await unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      return expected;
    });
    expect(observed).toBe(expected);
    expect(await countUser(uid)).toBe(1);
  });

  it('UOW03: two writes share one backend and commit together', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const observed = await unitOfWork.execute(async (context) => {
      const before = await backendPid(context.database);
      await insertUser(context.database, uid);
      await context.database
        .insertInto('memberships')
        .values({ uid, status: 'ACTIVE' })
        .execute();
      return { before, after: await backendPid(context.database) };
    });
    expect(observed.after).toBe(observed.before);
    expect(await countUser(uid)).toBe(1);
    expect(
      await database
        .selectFrom('memberships')
        .select('uid')
        .where('uid', '=', uid)
        .execute()
    ).toHaveLength(1);
  });

  it('UOW04: sync throw rolls back and preserves safe cause identity', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const module = await loadUnitOfWorkModule();
    const local = module.createUnitOfWork(scripted);
    const expected = new module.PublicUnitOfWorkError(
      'APPLICATION_SYNTHETIC_CALLBACK'
    );
    try {
      const observed = local.execute(() => {
        throw expected;
      });
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_CALLBACK_FAILED',
          outcome: 'ROLLED_BACK',
          cause: expected
        }
      );
      expect(state.queries).toEqual(['begin', 'rollback']);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW05: async reject rolls back and preserves safe cause identity', async () => {
    const module = await loadUnitOfWorkModule();
    const unitOfWork = module.createUnitOfWork(database);
    const uid = randomUUID();
    const expected = new module.PublicUnitOfWorkError(
      'DOMAIN_SYNTHETIC_ASYNC_REJECTION'
    );
    const observed = unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      await Promise.resolve();
      throw expected;
    });
    expectUnitErrorContract(
      await observed.catch((failure: unknown) => failure),
      {
        code: 'TRANSACTION_CALLBACK_FAILED',
        outcome: 'ROLLED_BACK',
        cause: expected
      }
    );
    expect(await countUser(uid)).toBe(0);
  });

  it('UOW06: second write constraint failure rolls back every write', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const observed = unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      await context.database
        .insertInto('memberships')
        .values({ uid, status: 'ACTIVE' })
        .execute();
      await context.database
        .insertInto('memberships')
        .values({ uid, status: 'ACTIVE' })
        .execute();
    });
    const error = await observed.catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'TRANSACTION_CALLBACK_FAILED',
      message: 'TRANSACTION_CALLBACK_FAILED'
    });
    expectNoRawLeak(error);
    expect(await countUser(uid)).toBe(0);
  });

  it('UOW07: caught SQL failure cannot produce a false commit', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const observed = unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      await context.database
        .insertInto('memberships')
        .values({ uid, status: 'ACTIVE' })
        .execute();
      try {
        await context.database
          .insertInto('memberships')
          .values({ uid, status: 'ACTIVE' })
          .execute();
      } catch {
        return 'not-committed';
      }
      return 'unreachable';
    });
    await expect(observed).rejects.toEqual(
      expect.objectContaining({
        code: 'TRANSACTION_ABORTED_BEFORE_COMMIT',
        message: 'TRANSACTION_ABORTED_BEFORE_COMMIT'
      })
    );
    expect(await countUser(uid)).toBe(0);
  });

  it('UOW08: derived QueryCreator stays on the same transaction backend', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    const observed = await unitOfWork.execute(async (context) => {
      const derived = context.database.withSchema('public');
      const before = await backendPid(context.database);
      await insertUser(derived, uid);
      return { before, after: await backendPid(derived) };
    });
    expect(observed.after).toBe(observed.before);
    expect(await countUser(uid)).toBe(1);
  });

  it('UOW09: revoked context rejects late use without SQL', async () => {
    const unitLoadsBefore = unitOfWorkModuleLoadCount;
    await withManualContext(async (lease) => {
      lease.revoke();
      const before = queryExecutionCount;
      await expect(
        lease.context.database.selectFrom('users').select('uid').execute()
      ).rejects.toEqual(
        expect.objectContaining({
          code: 'TRANSACTION_CONTEXT_CLOSED',
          message: 'TRANSACTION_CONTEXT_CLOSED'
        })
      );
      expect(queryExecutionCount).toBe(before);
    });
    expect(unitOfWorkModuleLoadCount).toBe(unitLoadsBefore);
  });

  it('UOW10: escaped database facade rejects after callback scope', async () => {
    const unitLoadsBefore = unitOfWorkModuleLoadCount;
    let escaped!: QueryCreator<StageOneDatabase>;
    await withManualContext((lease) => {
      escaped = lease.context.database;
    });
    const before = queryExecutionCount;
    await expect(
      escaped.selectFrom('users').select('uid').execute()
    ).rejects.toMatchObject({ code: 'TRANSACTION_CONTEXT_CLOSED' });
    expect(queryExecutionCount).toBe(before);
    expect(unitOfWorkModuleLoadCount).toBe(unitLoadsBefore);
  });

  it('UOW11: escaped prebuilt builder rejects after revocation', async () => {
    const unitLoadsBefore = unitOfWorkModuleLoadCount;
    let builder!: SelectQueryBuilder<
      StageOneDatabase,
      'users',
      Record<string, never>
    >;
    await withManualContext((lease) => {
      builder = lease.context.database.selectFrom('users');
    });
    const before = queryExecutionCount;
    await expect(builder.select('uid').execute()).rejects.toMatchObject({
      code: 'TRANSACTION_CONTEXT_CLOSED'
    });
    expect(queryExecutionCount).toBe(before);
    expect(unitOfWorkModuleLoadCount).toBe(unitLoadsBefore);
  });

  it('UOW12: plugin, pluginless, and schema derivatives retain the lease', async () => {
    const unitLoadsBefore = unitOfWorkModuleLoadCount;
    let derivatives!: ReadonlyArray<QueryCreator<StageOneDatabase>>;
    await withManualContext((lease) => {
      derivatives = [
        lease.context.database.withPlugin(identityPlugin),
        lease.context.database.withoutPlugins(),
        lease.context.database.withSchema('public')
      ];
    });
    const before = queryExecutionCount;
    for (const derivative of derivatives) {
      await expect(
        derivative.selectFrom('users').select('uid').execute()
      ).rejects.toMatchObject({ code: 'TRANSACTION_CONTEXT_CLOSED' });
    }
    expect(queryExecutionCount).toBe(before);
    expect(unitOfWorkModuleLoadCount).toBe(unitLoadsBefore);
  });

  it('UOW13: nested execute rejects before acquiring another connection', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      let nestedError: unknown;
      const observed = local.execute(() =>
        local.execute(() => 'nested').catch((error: unknown) => {
          nestedError = error;
          throw error;
        })
      );
      const error = await observed.catch((failure: unknown) => failure);
      expectUnitErrorContract(error, {
        code: 'TRANSACTION_CALLBACK_FAILED',
        outcome: 'ROLLED_BACK',
        cause: nestedError
      });
      expectUnitErrorContract(nestedError, {
        code: 'NESTED_UNIT_OF_WORK',
        outcome: 'NOT_COMMITTED'
      });
      expect(state.connectCount).toBe(1);
      expect(state.queries).toEqual(['begin', 'rollback']);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW14: independent outer executes remain concurrent and isolated', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      await expect(
        Promise.all([
          local.execute(async () => {
            await Promise.resolve();
            return 'first';
          }),
          local.execute(async () => {
            await Promise.resolve();
            return 'second';
          })
        ])
      ).resolves.toEqual(['first', 'second']);
      expect(state.connectCount).toBe(2);
      expect(state.normalReleaseIds).toHaveLength(2);
      expect(state.destroyReleaseIds).toEqual([]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW15: uncommitted row is local then becomes globally visible', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const uid = randomUUID();
    await unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      expect(
        await context.database
          .selectFrom('users')
          .select('uid')
          .where('uid', '=', uid)
          .execute()
      ).toHaveLength(1);
      expect(await countUser(uid)).toBe(0);
    });
    expect(await countUser(uid)).toBe(1);
  });

  it('UOW16: rolled-back row is not visible on any later connection', async () => {
    const module = await loadUnitOfWorkModule();
    const unitOfWork = module.createUnitOfWork(database);
    const expected = new module.PublicUnitOfWorkError(
      'DOMAIN_SYNTHETIC_ROLLBACK'
    );
    const uid = randomUUID();
    const observed = unitOfWork.execute(async (context) => {
      await insertUser(context.database, uid);
      expect(
        await context.database
          .selectFrom('users')
          .select('uid')
          .where('uid', '=', uid)
          .execute()
      ).toHaveLength(1);
      throw expected;
    });
    expectUnitErrorContract(
      await observed.catch((failure: unknown) => failure),
      {
        code: 'TRANSACTION_CALLBACK_FAILED',
        outcome: 'ROLLED_BACK',
        cause: expected
      }
    );
    expect(await countUser(uid)).toBe(0);
  });

  it('UOW17: transaction keeps platform session and current roles', async () => {
    const unitOfWork = await createRealUnitOfWork();
    const evidence = await unitOfWork.execute(async (context) => {
      return context.database
        .selectFrom(
          sql<{
            readonly session_user: string;
            readonly current_user: string;
          }>`(
            select session_user, current_user
          )`.as('roles')
        )
        .select(['roles.session_user', 'roles.current_user'])
        .executeTakeFirstOrThrow();
    });
    expect(evidence).toEqual({
      session_user: fixture.platformLogin.username,
      current_user: 'xht_platform'
    });
  });

  it('UOW18: acquire and begin failures skip callback and release correctly', async () => {
    const state = createScriptedState({
      acquireFailures: 1,
      beginFailures: 1
    });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    let callbackCount = 0;
    try {
      await expect(
        local.execute(() => {
          callbackCount += 1;
        })
      ).rejects.toMatchObject({ code: 'TRANSACTION_ACQUIRE_FAILED' });
      await expect(
        local.execute(() => {
          callbackCount += 1;
        })
      ).rejects.toMatchObject({ code: 'TRANSACTION_BEGIN_FAILED' });
      await expect(local.execute(() => 'recovered')).resolves.toBe(
        'recovered'
      );
      expect(callbackCount).toBe(0);
      expect(state.acquiredClientIds).toEqual([1, 2]);
      expect(state.destroyReleaseIds).toEqual([1]);
      expect(state.normalReleaseIds).toEqual([2]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW19: rollback fault injection preserves primary and recovery evidence', async () => {
    const state = createScriptedState({ rollbackFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const module = await loadUnitOfWorkModule();
    const local = module.createUnitOfWork(scripted);
    const callbackError = new module.PublicUnitOfWorkError(
      'APPLICATION_SYNTHETIC_PRIMARY'
    );
    try {
      const callbackRollbackFailure = local.execute(() => {
        throw callbackError;
      });
      await expect(callbackRollbackFailure).rejects.toMatchObject({
        code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        message: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        primaryCategory: 'CALLBACK',
        cleanupCategory: 'ROLLBACK',
        cause: callbackError
      });
      expectNoRawLeak(
        await callbackRollbackFailure.catch(
          (error: unknown) => error
        )
      );

      state.commitRejectedFailures = 1;
      state.rollbackFailures = 1;
      const commitRollbackFailure = local.execute(() => 'hidden-result');
      await expect(commitRollbackFailure).rejects.toMatchObject({
        code: 'TRANSACTION_COMMIT_AND_ROLLBACK_FAILED',
        message: 'TRANSACTION_COMMIT_AND_ROLLBACK_FAILED',
        primaryCategory: 'COMMIT',
        cleanupCategory: 'ROLLBACK'
      });
      await expect(local.execute(() => 'recovered')).resolves.toBe(
        'recovered'
      );
      expect(state.acquiredClientIds).toEqual([1, 2, 3]);
      expect(state.destroyReleaseIds).toEqual([1, 2]);
      expect(state.normalReleaseIds).toEqual([3]);
      expectNoRawLeak(
        await commitRollbackFailure.catch(
          (error: unknown) => error
        )
      );
    } finally {
      await scripted.destroy();
    }
  });

  it('REV01: context is revoked while commit is pending', async () => {
    const commitStarted = createDeferred<void>();
    const allowCommit = createDeferred<void>();
    const state = createScriptedState({ commitStarted, allowCommit });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    let escaped!: FutureTransactionContext;
    let settled = false;
    try {
      const execution = local
        .execute((context) => {
          escaped = context;
          return 'committed';
        })
        .finally(() => {
          settled = true;
        });
      await commitStarted.promise;
      expect(settled).toBe(false);
      const before = state.queries.length;
      await expect(
        escaped.database.selectFrom('users').select('uid').execute()
      ).rejects.toMatchObject({ code: 'TRANSACTION_CONTEXT_CLOSED' });
      expect(state.queries).toHaveLength(before);
      allowCommit.resolve();
      await expect(execution).resolves.toBe('committed');
    } finally {
      allowCommit.resolve();
      await scripted.destroy();
    }
  });

  it('UOW20: cleanup attempts every owner after a destroy failure', async () => {
    const calls: string[] = [];
    const owner = new TestResourceOwner();
    let reentrant: Promise<void> | undefined;
    owner.ownDatabase({
      destroy(): Promise<void> {
        calls.push('database');
        reentrant = owner.close();
        return Promise.reject(syntheticPgError('ECONNRESET'));
      }
    });
    owner.ownFixture({
      async stop(): Promise<void> {
        calls.push('fixture');
      }
    });
    const first = owner.close();
    const second = owner.close();
    expect(second).toBe(first);
    expect(reentrant).toBe(first);
    const error = await first.catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'TEST_RESOURCE_CLEANUP_FAILED',
      message: 'TEST_RESOURCE_CLEANUP_FAILED',
      categories: ['DATABASE_DESTROY_FAILED']
    });
    expectNoRawLeak(error);
    expect(calls).toEqual(['database', 'fixture']);
    expect(owner.databaseDestroyCount).toBe(1);
    expect(owner.fixtureStopCount).toBe(1);
    expect(owner.close()).toBe(first);
  });

  it('CLEAN01: partial setup owns and closes every acquired resource exactly once', async () => {
    const cases = [
      {
        point: 'AFTER_FIXTURE',
        cleanupFailure: 'NONE',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 0,
          databaseDestroyCount: 0,
          categories: []
        }
      },
      {
        point: 'AFTER_RAW_POOL',
        cleanupFailure: 'NONE',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 1,
          databaseDestroyCount: 0,
          categories: []
        }
      },
      {
        point: 'AFTER_DATABASE',
        cleanupFailure: 'NONE',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 0,
          databaseDestroyCount: 1,
          categories: []
        }
      },
      {
        point: 'AFTER_RAW_POOL',
        cleanupFailure: 'RAW_POOL',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 1,
          databaseDestroyCount: 0,
          categories: ['RAW_POOL_END_FAILED']
        }
      },
      {
        point: 'AFTER_DATABASE',
        cleanupFailure: 'DATABASE',
        expected: {
          fixtureStopCount: 1,
          rawPoolEndCount: 0,
          databaseDestroyCount: 1,
          categories: ['DATABASE_DESTROY_FAILED']
        }
      }
    ] as const;

    for (const scenario of cases) {
      const owner = new TestResourceOwner();
      const evidence: InjectedSetupEvidence = {
        fixtureStopCount: 0,
        rawPoolEndCount: 0,
        databaseDestroyCount: 0,
        calls: []
      };
      const error = await setupOwnedResources(
        owner,
        createInjectedSetupOperations(
          scenario.point,
          scenario.cleanupFailure,
          evidence
        )
      ).catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        code: 'TEST_RESOURCE_SETUP_FAILED',
        message: 'TEST_RESOURCE_SETUP_FAILED',
        categories: scenario.expected.categories
      });
      expect(evidence).toMatchObject({
        fixtureStopCount:
          scenario.expected.fixtureStopCount,
        rawPoolEndCount: scenario.expected.rawPoolEndCount,
        databaseDestroyCount:
          scenario.expected.databaseDestroyCount
      });
      expect(owner.fixtureStopCount).toBe(
        scenario.expected.fixtureStopCount
      );
      expect(owner.rawPoolEndCount).toBe(
        scenario.expected.rawPoolEndCount
      );
      expect(owner.databaseDestroyCount).toBe(
        scenario.expected.databaseDestroyCount
      );
      const fixtureStopIndex =
        evidence.calls.indexOf('fixture:stop');
      const databaseDestroyIndex =
        evidence.calls.indexOf('database:destroy');
      const rawPoolEndIndex = evidence.calls.indexOf('raw:end');
      if (databaseDestroyIndex >= 0) {
        expect(fixtureStopIndex).toBeGreaterThan(
          databaseDestroyIndex
        );
      }
      if (rawPoolEndIndex >= 0) {
        expect(fixtureStopIndex).toBeGreaterThan(rawPoolEndIndex);
      }
      expectNoRawLeak(error);
    }
  });

  it('UOW21: commit outcome unknown never rolls back or returns result', async () => {
    const state = createScriptedState({ commitUnknownFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'hidden-result');
      const error = await observed.catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        code: 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN',
        message: 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN'
      });
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit'
      ]);
      expect(state.queries).not.toContain('rollback');
      expect(state.destroyReleaseIds).toEqual([1]);
      expectNoRawLeak(error);
      await expect(local.execute(() => 'recovered')).resolves.toBe(
        'recovered'
      );
      expect(state.acquiredClientIds).toEqual([1, 2]);
      expect(state.normalReleaseIds).toEqual([2]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW22: raw callback errors are sanitized with both rollback outcomes', async () => {
    const state = createScriptedState();
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const rollbackSuccess = local.execute(() => {
        throw syntheticPgError('23505');
      });
      const first = await rollbackSuccess.catch(
        (failure: unknown) => failure
      );
      expect(first).toMatchObject({
        code: 'TRANSACTION_CALLBACK_FAILED',
        message: 'TRANSACTION_CALLBACK_FAILED'
      });
      expect(first).not.toHaveProperty('cause');
      expectNoRawLeak(first);

      state.rollbackFailures = 1;
      const rollbackFailure = local.execute(() => {
        throw syntheticPgError('23505');
      });
      const second = await rollbackFailure.catch(
        (failure: unknown) => failure
      );
      expect(second).toMatchObject({
        code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        message: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        primaryCategory: 'CALLBACK',
        cleanupCategory: 'ROLLBACK'
      });
      expect(second).not.toHaveProperty('cause');
      expectNoRawLeak(second);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('UOW23: real rollback connection fault is destroyed before recovery', async () => {
    const module = await loadUnitOfWorkModule();
    const unitOfWork = module.createUnitOfWork(database);
    const expected = new module.PublicUnitOfWorkError(
      'DOMAIN_REAL_ROLLBACK_FAULT'
    );
    let failedPid = 0;
    const evidenceStart = realReleaseEvidence.length;
    const observed = unitOfWork.execute(async (context) => {
      failedPid = await backendPid(context.database);
      await terminateBackend(failedPid);
      throw expected;
    });
    const error = await observed.catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
      cleanupCategory: 'ROLLBACK',
      cause: expected
    });
    expectNoRawLeak(error);
    const failedEvidence = realReleaseEvidence
      .slice(evidenceStart)
      .filter((item) => item.pid === failedPid);
    expect(failedEvidence).toContainEqual({
      pid: failedPid,
      destroy: true
    });
    expect(failedEvidence).not.toContainEqual({
      pid: failedPid,
      destroy: false
    });
    const recoveredPid = await unitOfWork.execute((context) =>
      backendPid(context.database)
    );
    expect(recoveredPid).not.toBe(failedPid);
  });

  it('UOW24: real precommit connection fault destroys the client', async () => {
    const unitOfWork = await createRealUnitOfWork();
    let failedPid = 0;
    const evidenceStart = realReleaseEvidence.length;
    const observed = unitOfWork.execute(async (context) => {
      failedPid = await backendPid(context.database);
      await terminateBackend(failedPid);
      return 'hidden-result';
    });
    const error = await observed.catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: 'TRANSACTION_PRECOMMIT_CONNECTION_FAILED',
      message: 'TRANSACTION_PRECOMMIT_CONNECTION_FAILED'
    });
    expectNoRawLeak(error);
    const failedEvidence = realReleaseEvidence
      .slice(evidenceStart)
      .filter((item) => item.pid === failedPid);
    expect(failedEvidence).toContainEqual({
      pid: failedPid,
      destroy: true
    });
    expect(failedEvidence).not.toContainEqual({
      pid: failedPid,
      destroy: false
    });
    const recoveredPid = await unitOfWork.execute((context) =>
      backendPid(context.database)
    );
    expect(recoveredPid).not.toBe(failedPid);
  });

  it('UOW25: explicit commit rejection rolls back and hides its result', async () => {
    const state = createScriptedState({ commitRejectedFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'hidden-result');
      const error = await observed.catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        code: 'TRANSACTION_COMMIT_FAILED',
        message: 'TRANSACTION_COMMIT_FAILED',
        primaryCategory: 'COMMIT'
      });
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit',
        'rollback'
      ]);
      expect(state.destroyReleaseIds).toEqual([1]);
      expectNoRawLeak(error);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL01: committed outcome survives normal release failure', async () => {
    const state = createScriptedState({ normalReleaseFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'committed-result');
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_COMMITTED_WITH_RELEASE_FAILURE',
          outcome: 'COMMITTED'
        }
      );
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit'
      ]);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL02: rolled-back callback cause survives normal release failure', async () => {
    const state = createScriptedState({ normalReleaseFailures: 1 });
    const scripted = createScriptedDatabase(state);
    const module = await loadUnitOfWorkModule();
    const local = module.createUnitOfWork(scripted);
    const primary = new module.PublicUnitOfWorkError(
      'APPLICATION_RELEASE_ROLLBACK'
    );
    try {
      const observed = local.execute(() => {
        throw primary;
      });
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_CALLBACK_FAILED',
          outcome: 'ROLLED_BACK',
          cause: primary
        }
      );
      expect(state.queries).toEqual(['begin', 'rollback']);
      expect(state.normalReleaseIds).toEqual([1]);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL03: unknown commit survives destroy release failure', async () => {
    const state = createScriptedState({
      commitUnknownFailures: 1,
      destroyReleaseFailures: 1
    });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'hidden-result');
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN',
          outcome: 'UNKNOWN'
        }
      );
      expect(state.queries).not.toContain('rollback');
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL04: callback and rollback failure survives destroy release failure', async () => {
    const state = createScriptedState({
      rollbackFailures: 1,
      destroyReleaseFailures: 1
    });
    const scripted = createScriptedDatabase(state);
    const module = await loadUnitOfWorkModule();
    const local = module.createUnitOfWork(scripted);
    const primary = new module.PublicUnitOfWorkError(
      'DOMAIN_RELEASE_ROLLBACK_FAILURE'
    );
    try {
      const observed = local.execute(() => {
        throw primary;
      });
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
          outcome: 'NOT_COMMITTED',
          cause: primary
        }
      );
      expect(state.queries).toEqual(['begin', 'rollback']);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('REL05: rejected commit outcome survives destroy release failure', async () => {
    const state = createScriptedState({
      commitRejectedFailures: 1,
      destroyReleaseFailures: 1
    });
    const scripted = createScriptedDatabase(state);
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    try {
      const observed = local.execute(() => 'hidden-result');
      expectUnitErrorContract(
        await observed.catch((failure: unknown) => failure),
        {
          code: 'TRANSACTION_COMMIT_FAILED',
          outcome: 'ROLLED_BACK'
        }
      );
      expect(state.queries).toEqual([
        'begin',
        transactionPrecommitProbeSql,
        'commit',
        'rollback'
      ]);
      expect(state.destroyReleaseIds).toEqual([1]);
    } finally {
      await scripted.destroy();
    }
  });

  it('IMM01: every identity-safe error is frozen and rejects field pollution', async () => {
    const module = await loadUnitOfWorkModule();
    const contextModule = await loadContextModule();
    const publicError = new module.PublicUnitOfWorkError(
      'APPLICATION_IMMUTABLE_ERROR'
    );
    const contextError = new contextModule.TransactionContextError();
    const unitError = new module.UnitOfWorkError(
      'TRANSACTION_CALLBACK_FAILED',
      publicError
    );
    const authenticErrors = [
      publicError,
      contextError,
      unitError
    ] as const;
    for (const error of authenticErrors) {
      expect(Object.isFrozen(error)).toBe(true);
      expect(Object.isFrozen(Object.getPrototypeOf(error))).toBe(true);
      expectErrorPollutionRejected(error);
      expectNoRawLeak(error);
    }
    expect(publicError.message).toBe('APPLICATION_IMMUTABLE_ERROR');
    expect(contextError.message).toBe('TRANSACTION_CONTEXT_CLOSED');
    expect(unitError.message).toBe('TRANSACTION_CALLBACK_FAILED');
    expect(unitError.cause).toBe(publicError);

    for (const authenticError of authenticErrors) {
      for (const rollbackFailures of [0, 1]) {
        const state = createScriptedState({ rollbackFailures });
        const scripted = createScriptedDatabase(state);
        const local = module.createUnitOfWork(scripted);
        try {
          const observed = local.execute(() => {
            throw authenticError;
          });
          expectUnitErrorContract(
            await observed.catch((failure: unknown) => failure),
            {
              code:
                rollbackFailures === 0
                  ? 'TRANSACTION_CALLBACK_FAILED'
                  : 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
              outcome:
                rollbackFailures === 0
                  ? 'ROLLED_BACK'
                  : 'NOT_COMMITTED',
              cause: authenticError
            }
          );
        } finally {
          await scripted.destroy();
        }
      }
    }

    const forgedErrors = [
      {
        ErrorClass: module.PublicUnitOfWorkError,
        error: forgeIdentitySafeError(
          module.PublicUnitOfWorkError.prototype
        )
      },
      {
        ErrorClass: contextModule.TransactionContextError,
        error: forgeIdentitySafeError(
          contextModule.TransactionContextError.prototype
        )
      },
      {
        ErrorClass: module.UnitOfWorkError,
        error: forgeIdentitySafeError(
          module.UnitOfWorkError.prototype
        )
      }
    ] as const;
    for (const forged of forgedErrors) {
      expect(Object.isFrozen(forged.error)).toBe(true);
      expect(forged.error).toBeInstanceOf(forged.ErrorClass);
      expect(Object.getPrototypeOf(forged.error)).toBe(
        forged.ErrorClass.prototype
      );
      expect(() => {
        new module.UnitOfWorkError(
          'TRANSACTION_CALLBACK_FAILED',
          forged.error as never
        );
      }).toThrowError('UNIT_OF_WORK_SAFE_CAUSE_INVALID');

      for (const rollbackFailures of [0, 1]) {
        const state = createScriptedState({ rollbackFailures });
        const scripted = createScriptedDatabase(state);
        const local = module.createUnitOfWork(scripted);
        try {
          const observed = local.execute(() => {
            throw forged.error;
          });
          const error = await observed.catch(
            (failure: unknown) => failure
          );
          expectUnitErrorContract(error, {
            code:
              rollbackFailures === 0
                ? 'TRANSACTION_CALLBACK_FAILED'
                : 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
            outcome:
              rollbackFailures === 0
                ? 'ROLLED_BACK'
                : 'NOT_COMMITTED'
          });
          expect(error).not.toHaveProperty('cause');
          expectNoRawLeak(error);
        } finally {
          await scripted.destroy();
        }
      }
    }
  });
const transactionControlCases = [
  'BEGIN',
  'START TRANSACTION',
  'END',
  'ABORT',
  'SAVEPOINT xht_guard',
  'RELEASE SAVEPOINT xht_guard',
  'ROLLBACK TO xht_guard',
  'PREPARE TRANSACTION xht_guard',
  'COMMIT PREPARED xht_guard',
  'ROLLBACK PREPARED xht_guard',
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
  'SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE'
] as const;

function executeInjectedSql(
  target: FutureTransactionContext,
  sqlText: string,
  parameters: ReadonlyArray<unknown> = []
): Promise<QueryResult<UnknownRow>> {
  return target.executeSql<UnknownRow>(sqlText, parameters);
}

async function rejectScriptedSql(
  sqlText: string,
  expectedCode:
    | 'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    | 'TRANSACTION_QUERY_MULTISTATEMENT'
    | 'TRANSACTION_QUERY_UNSAFE',
  overrides: Partial<ScriptedState> = {}
): Promise<{ readonly error: unknown; readonly state: ScriptedState }> {
  const state = createScriptedState(overrides);
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    const error = await local
      .execute((context) => executeInjectedSql(context, sqlText))
      .catch((failure: unknown) => failure);
    const expectedFinalCode =
      overrides.rollbackFailures !== undefined && overrides.rollbackFailures > 0
        ? 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED'
        : expectedCode;
    expect(error).toMatchObject({ code: expectedFinalCode });
    expect(
      state.queryEvidence.filter((entry) => entry.text === sqlText)
    ).toHaveLength(0);
    expectNoRawLeak(error);
    return { error, state };
  } finally {
    await scripted.destroy();
  }
}

it('TXCTL01: single ROLLBACK is rejected before send', async () => {
  const evidence = await rejectScriptedSql(
    'ROLLBACK',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL02: single COMMIT is rejected before send', async () => {
  const evidence = await rejectScriptedSql(
    'COMMIT',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL03: BEGIN START TRANSACTION END and ABORT are rejected', async () => {
  for (const statement of transactionControlCases.slice(0, 4)) {
    const evidence = await rejectScriptedSql(
      statement,
      'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('TXCTL04: SAVEPOINT RELEASE SAVEPOINT and ROLLBACK TO are rejected', async () => {
  for (const statement of transactionControlCases.slice(4, 7)) {
    const evidence = await rejectScriptedSql(
      statement,
      'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('TXCTL05: prepared transaction controls are rejected', async () => {
  for (const statement of transactionControlCases.slice(7, 10)) {
    const evidence = await rejectScriptedSql(
      statement,
      'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('TXCTL06: SET TRANSACTION is rejected', async () => {
  const evidence = await rejectScriptedSql(
    transactionControlCases[10],
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL07: SET SESSION CHARACTERISTICS AS TRANSACTION is rejected', async () => {
  const evidence = await rejectScriptedSql(
    transactionControlCases[11],
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL08: case BOM whitespace line and nested block comments cannot bypass', async () => {
  for (const statement of [
    '\uFEFF  rOlLbAcK ;',
    '-- guard\nCoMmIt',
    '/* outer /* nested */ still */ BEGIN'
  ]) {
    const evidence = await rejectScriptedSql(
      statement,
      'TRANSACTION_CONTROL_STATEMENT_REJECTED'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('TXCTL09: select rollback select has zero partial execution', async () => {
  const evidence = await rejectScriptedSql(
    'select 1; rollback; select 1',
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL10: select commit select has zero partial execution', async () => {
  const evidence = await rejectScriptedSql(
    'select 1; commit; select 1',
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL11: insert followed by commit has zero partial execution', async () => {
  const evidence = await rejectScriptedSql(
    "insert into users (uid, status) values ('x', 'ACTIVE'); commit",
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('TXCTL12: legal write followed by ROLLBACK rolls back the write', async () => {
  const local = await createRealUnitOfWork();
  const uid = randomUUID();
  const error = await local
    .execute(async (context) => {
      await insertUser(context.database, uid);
      await executeInjectedSql(context, 'ROLLBACK');
    })
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({
    code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    outcome: 'ROLLED_BACK'
  });
  await expect(countUser(uid)).resolves.toBe(0);
});

it('TXCTL13: legal write followed by COMMIT rolls back the write', async () => {
  const local = await createRealUnitOfWork();
  const uid = randomUUID();
  const error = await local
    .execute(async (context) => {
      await insertUser(context.database, uid);
      await executeInjectedSql(context, 'COMMIT');
    })
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({
    code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    outcome: 'ROLLED_BACK'
  });
  await expect(countUser(uid)).resolves.toBe(0);
});

it('TXCTL14: rollback success preserves the policy result contract', async () => {
  const evidence = await rejectScriptedSql(
    'ROLLBACK',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expectUnitErrorContract(evidence.error, {
    code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    outcome: 'ROLLED_BACK'
  });
});

it('TXCTL15: rollback failure preserves recovery evidence', async () => {
  const evidence = await rejectScriptedSql(
    'COMMIT',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    { rollbackFailures: 1 }
  );
  expect(evidence.error).toMatchObject({
    code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
    outcome: 'NOT_COMMITTED',
    cause: { code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED' }
  });
  expectNoRawLeak(evidence.error);
});

it('TXCTL16: release failure does not replace the transaction result', async () => {
  const evidence = await rejectScriptedSql(
    'ROLLBACK',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    { normalReleaseFailures: 1 }
  );
  expect(evidence.error).toMatchObject({
    code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
    outcome: 'ROLLED_BACK'
  });
  expect(evidence.state.destroyReleaseIds).toEqual([1]);
});

it('TXCTL17: policy rejection returns a healthy client normally', async () => {
  const evidence = await rejectScriptedSql(
    'COMMIT',
    'TRANSACTION_CONTROL_STATEMENT_REJECTED'
  );
  expect(evidence.state.normalReleaseIds).toEqual([1]);
  expect(evidence.state.destroyReleaseIds).toEqual([]);
});

it('TXCTL18: execute after policy rejection still uses the pool', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await local
      .execute((context) => executeInjectedSql(context, 'COMMIT'))
      .catch(() => undefined);
    await expect(local.execute(() => 42)).resolves.toBe(42);
    expect(state.acquiredClientIds).toEqual([1, 1]);
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL19: string and dollar literals do not cause false positives', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await expect(
      local.execute((context) =>
        executeInjectedSql(
          context,
          "select 'commit; rollback' as a, $$begin; end$$ as b"
        )
      )
    ).resolves.toMatchObject({ rows: [] });
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL20: comment keywords and semicolons do not cause false positives', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await expect(
      local.execute((context) =>
        executeInjectedSql(
          context,
          '-- commit; rollback\nselect /* begin; /* abort */ */ 1'
        )
      )
    ).resolves.toMatchObject({ rows: [] });
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL21: no-parameter callback query uses extended mode', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await local.execute((context) =>
      context.database.selectNoFrom(sql.lit(1).as('value')).execute()
    );
    expect(state.queryEvidence).toContainEqual({
      text: expect.stringContaining('select 1'),
      values: [],
      queryMode: 'extended'
    });
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL22: parameterized callback query remains usable in extended mode', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await local.execute((context) =>
      context.database.selectNoFrom(sql.val(41).as('value')).execute()
    );
    expect(state.queryEvidence).toContainEqual({
      text: expect.stringContaining('select $1'),
      values: [41],
      queryMode: 'extended'
    });
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL23: callback cannot obtain raw client pool or executor', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await expect(
      local.execute((context) => {
        const surface = collectPublicSurface(context.database);
        expect(surface.fieldNames).not.toEqual(
          expect.arrayContaining([
            'rawClient',
            'pool',
            'driver',
            'connection',
            'getExecutor',
            'provideConnection'
          ])
        );
        expect(Reflect.get(context.database, 'getExecutor')).toBeUndefined();
        return 1;
      })
    ).resolves.toBe(1);
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL24: reflection prototype and plugin do not expose internal channels', async () => {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await expect(
      local.execute(async (context) => {
        const derived = context.database.withPlugin(identityPlugin);
        const surfaces = [context.database, derived, Object.getPrototypeOf(context.database)];
        for (const surface of surfaces) {
          const observed = collectPublicSurface(surface);
          expect(observed.fieldNames).not.toEqual(
            expect.arrayContaining(['rawClient', 'pool', 'connection', 'getExecutor'])
          );
        }
        await derived.selectNoFrom(sql.lit(1).as('value')).execute();
        return 1;
      })
    ).resolves.toBe(1);
  } finally {
    await scripted.destroy();
  }
});

it('TXCTL25: policy errors expose zero raw SQL parameters or secrets', async () => {
  const evidence = await rejectScriptedSql(
    'select 1; commit; select 1 -- synthetic-raw-password',
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expectUnitErrorContract(evidence.error, {
    code: 'TRANSACTION_QUERY_MULTISTATEMENT',
    outcome: 'ROLLED_BACK'
  });
  expectNoRawLeak(evidence.error);
});

const lexicalCaseContract = {
  LEX01: {
    sql: String.raw`select '\'; commit`,
    characters: String.raw`ordinary string: backslash, closing quote, top-level ; commit`,
    meaning: 'ordinary string is configuration-ambiguous, so strategy A rejects',
    expected: 'reject',
    delegates: 0
  },
  LEX02: {
    sql: String.raw`select '\'; rollback`,
    characters: String.raw`ordinary string: backslash, closing quote, top-level ; rollback`,
    meaning: 'ordinary string is configuration-ambiguous, so strategy A rejects',
    expected: 'reject',
    delegates: 0
  },
  LEX03: {
    sql: String.raw`insert into xht_probe(value) values ('\'); commit`,
    characters: String.raw`insert value has ordinary backslash before closing quote`,
    meaning: 'reject before the insert can reach the delegate',
    expected: 'reject',
    delegates: 0
  },
  LEX04: {
    sql: [
      String.raw`select '\'; commit`,
      String.raw`select '\'; COMMIT`,
      String.raw`select '\'; CoMmIt`
    ],
    characters: 'three keyword case variants after the same ordinary string',
    meaning: 'all are rejected by the string policy before keyword case matters',
    expected: 'reject',
    delegates: 0
  },
  LEX05: {
    sql: "select 'commit' as value",
    characters: 'commit is inside a closed ordinary string without backslash',
    meaning: 'one SELECT statement',
    expected: 'accept',
    delegates: 1
  },
  LEX06: {
    sql: "select 'rollback' as value",
    characters: 'rollback is inside a closed ordinary string without backslash',
    meaning: 'one SELECT statement',
    expected: 'accept',
    delegates: 1
  },
  LEX07: {
    sql: "select 'it''s commit' as value",
    characters: 'ordinary string uses doubled single quote',
    meaning: 'doubled quote remains inside one ordinary string',
    expected: 'accept',
    delegates: 1
  },
  LEX08: {
    sql: String.raw`select E'\'; commit'`,
    characters: String.raw`E string backslash-escapes the first quote; final quote closes`,
    meaning: 'semicolon and commit remain inside the escape string',
    expected: 'accept',
    delegates: 1
  },
  LEX09: {
    sql: String.raw`select E'\\'; commit`,
    characters: String.raw`E string has escaped backslash, then closes before ; commit`,
    meaning: 'commit is a second top-level statement',
    expected: 'reject',
    delegates: 0
  },
  LEX10: {
    sql: [
      String.raw`select e'\'; commit'`,
      String.raw`select E'\'; commit'`
    ],
    characters: 'lowercase and uppercase escape prefixes with identical bodies',
    meaning: 'both semicolons remain inside their escape strings',
    expected: 'accept',
    delegates: 1
  },
  LEX11: {
    sql: String.raw`select employee'\'; commit`,
    characters: String.raw`identifier ends in e immediately before an ordinary quote`,
    meaning: 'the identifier suffix is not an E prefix; ordinary backslash policy rejects',
    expected: 'reject',
    delegates: 0
  },
  LEX12: {
    sql: 'select $tag$; commit rollback$tag$ as value',
    characters: 'semicolon and controls are inside a matched dollar tag',
    meaning: 'one SELECT statement',
    expected: 'accept',
    delegates: 1
  },
  LEX13: {
    sql: 'select $tag$safe$tag$; commit',
    characters: 'matched dollar string closes before top-level ; commit',
    meaning: 'commit is a second statement',
    expected: 'reject',
    delegates: 0
  },
  LEX14: {
    sql: 'select 1 /* outer ; commit /* nested */ rollback */ -- commit\r\n;',
    characters: 'nested block comment, line comment, CRLF, one trailing semicolon',
    meaning: 'comment text is ignored and the only semicolon is trailing',
    expected: 'accept',
    delegates: 1
  },
  LEX15: {
    sql:
      '\uFEFF -- commit\r\n/* outer /* rollback */ safe */ ' +
      String.raw`select '\'; commit`,
    characters: 'BOM, CRLF, comments, then the exact ordinary-string exploit',
    meaning: 'prefix trivia cannot bypass strategy A',
    expected: 'reject',
    delegates: 0
  },
  LEX16: {
    sql: "select 'unterminated",
    characters: 'ordinary quote has no close',
    meaning: 'lexically incomplete input fails closed',
    expected: 'reject',
    delegates: 0
  },
  LEX17: {
    sql: String.raw`select E'unterminated\q`,
    characters: String.raw`escape string consumes \q but has no closing quote`,
    meaning: 'lexically incomplete input fails closed',
    expected: 'reject',
    delegates: 0
  },
  LEX18: {
    sql: 'select $tag$unterminated',
    characters: 'opening dollar tag has no exact closing tag',
    meaning: 'lexically incomplete input fails closed',
    expected: 'reject',
    delegates: 0
  },
  LEX19: {
    sql: 'select 1 /* outer /* nested */',
    characters: 'outer block comment remains open after nested close',
    meaning: 'nested comment depth is nonzero and fails closed',
    expected: 'reject',
    delegates: 0
  },
  LEX20: {
    sql: [
      String.raw`select U&'\0041'`,
      String.raw`select U&"d\0061t"`,
      String.raw`select U&'\0041' UESCAPE '\'`,
      "select B'1010'",
      "select X'CAFE'",
      "select N'national'"
    ],
    characters: 'Unicode, bit, hex, and national prefixed forms',
    meaning: 'forms not fully modeled by the five-file scanner fail closed',
    expected: 'reject',
    delegates: 0
  },
  LEX21: {
    sql: String.raw`select '\'; commit`,
    characters: 'strategy-A rejection on a healthy client',
    meaning: 'rollback succeeds and the client is released normally',
    expected: 'reject',
    delegates: 0
  },
  LEX22: {
    sql: String.raw`select '\'; rollback`,
    characters: 'rejected request followed by a legal request',
    meaning: 'the same healthy pool client can be reused',
    expected: 'reject-then-accept',
    delegates: 0
  },
  LEX23: {
    sql: String.raw`select '\'; commit -- synthetic-raw-password`,
    characters: 'unsafe SQL contains a secret-shaped sentinel',
    meaning: 'fixed public error contains no SQL, connection, or internal object',
    expected: 'reject',
    delegates: 0
  }
} as const;

async function acceptScriptedSql(
  sqlText: string
): Promise<ScriptedState> {
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    await local.execute((context) => executeInjectedSql(context, sqlText));
    expect(
      state.queryEvidence.filter((entry) => entry.text === sqlText)
    ).toHaveLength(1);
    return state;
  } finally {
    await scripted.destroy();
  }
}

it('LEX01: ordinary backslash before COMMIT rejects before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX01.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX02: ordinary backslash before ROLLBACK rejects before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX02.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX03: insert exploit has zero partial delegate side effects', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX03.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX04: commit keyword case variants all reject before delegate', async () => {
  for (const sqlText of lexicalCaseContract.LEX04.sql) {
    const evidence = await rejectScriptedSql(
      sqlText,
      'TRANSACTION_QUERY_UNSAFE'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('LEX05: legal commit text in an ordinary string is accepted', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX05.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX06: legal rollback text in an ordinary string is accepted', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX06.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX07: doubled ordinary quote is parsed without false positive', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX07.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX08: escaped quote keeps semicolon inside an E string', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX08.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX09: closed E string before COMMIT rejects before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX09.sql,
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX10: lowercase and uppercase E prefixes are equivalent', async () => {
  for (const sqlText of lexicalCaseContract.LEX10.sql) {
    const state = await acceptScriptedSql(sqlText);
    expect(state.normalReleaseIds).toEqual([1]);
  }
});

it('LEX11: identifier suffix e is not an escape prefix', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX11.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX12: matched dollar quote hides internal controls', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX12.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX13: statement after matched dollar quote is rejected', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX13.sql,
    'TRANSACTION_QUERY_MULTISTATEMENT'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX14: line and nested block comments preserve trailing semicolon', async () => {
  const state = await acceptScriptedSql(lexicalCaseContract.LEX14.sql);
  expect(state.normalReleaseIds).toEqual([1]);
});

it('LEX15: BOM CRLF and comments cannot hide ordinary backslash', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX15.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX16: unclosed ordinary string fails closed before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX16.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX17: unclosed escape string fails closed before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX17.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX18: unclosed dollar quote fails closed before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX18.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX19: unclosed nested block comment fails closed before delegate', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX19.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.queries).toEqual(['begin', 'rollback']);
});

it('LEX20: unsupported prefixed forms all fail closed before delegate', async () => {
  for (const sqlText of lexicalCaseContract.LEX20.sql) {
    const evidence = await rejectScriptedSql(
      sqlText,
      'TRANSACTION_QUERY_UNSAFE'
    );
    expect(evidence.state.queries).toEqual(['begin', 'rollback']);
  }
});

it('LEX21: strategy rejection uses healthy normal release', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX21.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expect(evidence.state.normalReleaseIds).toEqual([1]);
  expect(evidence.state.destroyReleaseIds).toEqual([]);
});

it('LEX22: legal execute after rejection reuses the healthy pool', async () => {
  const rejectedSql = lexicalCaseContract.LEX22.sql;
  const legalSql = 'select 1 as value';
  const state = createScriptedState();
  const scripted = createScriptedDatabase(state);
  try {
    const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
    const error = await local
      .execute((context) => executeInjectedSql(context, rejectedSql))
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'TRANSACTION_QUERY_UNSAFE' });
    expect(
      state.queryEvidence.filter((entry) => entry.text === rejectedSql)
    ).toHaveLength(0);
    await local.execute((context) => executeInjectedSql(context, legalSql));
    expect(
      state.queryEvidence.filter((entry) => entry.text === legalSql)
    ).toHaveLength(1);
    expect(state.acquiredClientIds).toEqual([1, 1]);
    expect(state.normalReleaseIds).toEqual([1, 1]);
  } finally {
    await scripted.destroy();
  }
});

it('LEX23: unsafe error leaks no SQL connection or internal object', async () => {
  const evidence = await rejectScriptedSql(
    lexicalCaseContract.LEX23.sql,
    'TRANSACTION_QUERY_UNSAFE'
  );
  expectUnitErrorContract(evidence.error, {
    code: 'TRANSACTION_QUERY_UNSAFE',
    outcome: 'ROLLED_BACK'
  });
  expectNoRawLeak(evidence.error);
});

type CallbackSqlPolicyExpectation = 'reject' | 'allow';
interface CallbackSqlPolicyCase {
  readonly id: `SQLPOL${string}`;
  readonly title: string;
  readonly sql: string;
  readonly companionSql?: readonly string[];
  readonly meaning: string;
  readonly expected: CallbackSqlPolicyExpectation;
  readonly expectedDelegateCalls: 0 | 1;
  readonly expectedRelease: 'normal';
  readonly expectNextLegalQuery: true;
}

const callbackSqlPolicyContract = [
  { id: 'SQLPOL01', title: 'SET transaction_read_only is rejected', sql: 'SET transaction_read_only = on', meaning: 'transaction_read_only changes the current transaction mode', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL02', title: 'mixed-case SET is rejected', sql: 'SeT transaction_read_only = on', meaning: 'unquoted keywords are case-insensitive', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL03', title: 'comment-separated SET is rejected', sql: 'SET/*x*/transaction_read_only=on', meaning: 'comments do not break the top-level SET token sequence', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL04', title: 'SET LOCAL transaction_read_only is rejected', sql: 'SET LOCAL transaction_read_only = on', meaning: 'SET LOCAL changes a transaction-scoped run-time parameter', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL05', title: 'SET SESSION transaction_read_only is rejected', sql: 'SET SESSION transaction_read_only = on', meaning: 'SET SESSION changes a session-scoped run-time parameter', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL06', title: 'SET transaction_isolation is rejected', sql: "SET transaction_isolation = 'serializable'", meaning: 'transaction_isolation is equivalent to SET TRANSACTION isolation', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL07', title: 'SET transaction_deferrable is rejected', sql: 'SET transaction_deferrable = on', meaning: 'transaction_deferrable is equivalent to SET TRANSACTION deferrability', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL08', title: 'RESET transaction_read_only is rejected', sql: 'RESET transaction_read_only', meaning: 'RESET changes the active run-time parameter value', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL09', title: 'SET ROLE is rejected', sql: 'SET ROLE application_admin', meaning: 'SET ROLE changes current_user and the privilege set', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL10', title: 'SET LOCAL ROLE is rejected', sql: 'SET LOCAL ROLE application_admin', meaning: 'LOCAL does not make role mutation safe for the callback channel', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL11', title: 'RESET ROLE is rejected', sql: 'RESET ROLE', meaning: 'RESET ROLE changes current_user to its connection-time state', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL12', title: 'SET SESSION AUTHORIZATION is rejected', sql: 'SET SESSION AUTHORIZATION DEFAULT', meaning: 'session authorization is a framework-owned identity boundary', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL13', title: 'set_config local transaction mode is rejected', sql: "SELECT set_config('transaction_read_only', 'on', true)", meaning: 'set_config with true is equivalent to transaction-local SET', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL14', title: 'set_config session transaction mode is rejected', sql: "SELECT set_config('transaction_read_only', 'on', false)", meaning: 'set_config with false is equivalent to session SET', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL15', title: 'qualified set_config is rejected', sql: "SELECT pg_catalog.set_config('standard_conforming_strings', 'off', false)", meaning: 'pg_catalog qualification still calls the run-time configuration function', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL16', title: 'qualified pg_settings update is rejected', sql: "UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only'", meaning: 'updating pg_settings.setting is equivalent to SET', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL17', title: 'repeatable-read transaction isolation is rejected', sql: "SET transaction_isolation = 'repeatable read'", meaning: 'all transaction_isolation mutations are framework-owned', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL18', title: 'qualified set_config transaction isolation is rejected', sql: "SELECT pg_catalog.set_config('transaction_isolation', 'serializable', true)", meaning: 'qualified set_config can mutate a transaction characteristic', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL19', title: 'unqualified pg_settings update is rejected', sql: "UPDATE pg_settings SET setting='on' WHERE name='transaction_read_only'", meaning: 'unqualified pg_settings resolves through the system catalog path', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL20', title: 'lowercase RESET ROLE is rejected', sql: 'reset role', meaning: 'unquoted RESET ROLE is case-insensitive', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL21', title: 'uppercase transaction SET is rejected', sql: 'SET TRANSACTION_READ_ONLY = ON', meaning: 'uppercase run-time parameter spelling is equivalent', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL22', title: 'BOM CRLF and comments cannot hide SET ROLE', sql: '\uFEFF\r\n/* guard */ SET/*x*/ROLE application_admin', meaning: 'ignorable lexical material cannot change the top-level statement family', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL23', title: 'DISCARD is rejected by the finite allowlist', sql: 'DISCARD ALL', meaning: 'DISCARD mutates session state and is not a business statement family', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL24', title: 'SET CONSTRAINTS is rejected by the finite allowlist', sql: 'SET CONSTRAINTS ALL DEFERRED', meaning: 'constraint timing is owned by the transaction framework', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL25', title: 'WITH cannot terminate in RESET ROLE', sql: 'WITH x AS (SELECT 1) RESET ROLE', meaning: 'WITH must terminate in an allowed business statement family', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL26', title: 'set_config text in an ordinary string is allowed', sql: "SELECT 'set_config('", meaning: 'ordinary string contents are not executable tokens', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL27', title: 'RESET ROLE text in an ordinary string is allowed', sql: "SELECT 'RESET ROLE'", meaning: 'role keywords inside a string are data', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL28', title: 'transaction SET text in a dollar quote is allowed', sql: 'SELECT $$SET transaction_read_only = on$$', meaning: 'matched dollar-quoted contents are data', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL29', title: 'SET ROLE text in a block comment is allowed', sql: 'SELECT 1 /* SET ROLE admin */', meaning: 'comment contents are not executable tokens', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL30', title: 'SET ROLE text in an escape string is allowed', sql: "SELECT E'SET ROLE application_admin'", meaning: 'closed escape-string contents are data', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL31', title: 'current_setting remains allowed', sql: "SELECT current_setting('transaction_read_only')", meaning: 'current_setting is a read-only inspection function', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL32', title: 'identifier containing set_config remains allowed', sql: 'SELECT my_set_config_value FROM configuration_snapshot', meaning: 'substring matches in ordinary identifiers are not function calls', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL33', title: 'SELECT family remains allowed', sql: 'SELECT 1 AS value', meaning: 'SELECT is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL34', title: 'INSERT family remains allowed', sql: 'INSERT INTO xht_policy_target(id) VALUES (1)', meaning: 'INSERT is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL35', title: 'UPDATE family remains allowed', sql: 'UPDATE xht_policy_target SET id = 2 WHERE id = 1', meaning: 'ordinary business UPDATE is allowed', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL36', title: 'DELETE family remains allowed', sql: 'DELETE FROM xht_policy_target WHERE id = 1', meaning: 'DELETE is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL37', title: 'MERGE family remains allowed', sql: 'MERGE INTO xht_policy_target AS t USING (VALUES (1)) AS s(id) ON t.id = s.id WHEN MATCHED THEN UPDATE SET id = s.id WHEN NOT MATCHED THEN INSERT (id) VALUES (s.id)', meaning: 'MERGE is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL38', title: 'VALUES family remains allowed', sql: 'VALUES (1)', meaning: 'VALUES is an allowed business statement family', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL39', title: 'WITH terminating in SELECT is allowed', sql: 'WITH x AS (SELECT 1 AS id) SELECT id FROM x', meaning: 'WITH is allowed when its final top-level family is SELECT', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL40', title: 'WITH terminating in INSERT is allowed', sql: 'WITH x AS (SELECT 1 AS id) INSERT INTO xht_policy_target(id) SELECT id FROM x', meaning: 'WITH may terminate in INSERT', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL41', title: 'WITH terminating in UPDATE is allowed', sql: 'WITH x AS (SELECT 1 AS id) UPDATE xht_policy_target SET id = x.id FROM x WHERE xht_policy_target.id = 1', meaning: 'WITH may terminate in an ordinary business UPDATE', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL42', title: 'WITH terminating in DELETE is allowed', sql: 'WITH x AS (SELECT 1 AS id) DELETE FROM xht_policy_target USING x WHERE xht_policy_target.id = x.id', meaning: 'WITH may terminate in DELETE', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL43', title: 'WITH terminating in MERGE is allowed', sql: 'WITH x AS (SELECT 1 AS id) MERGE INTO xht_policy_target AS t USING x ON t.id = x.id WHEN MATCHED THEN UPDATE SET id = x.id', meaning: 'WITH may terminate in MERGE', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL44', title: 'WITH terminating in VALUES is allowed', sql: 'WITH x AS (SELECT 1 AS id) VALUES (1)', meaning: 'WITH may terminate in VALUES', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL45', title: 'quoted pg_catalog pg_settings update is rejected', sql: "UPDATE \"pg_catalog\".\"pg_settings\" SET setting = 'on' WHERE name = 'transaction_read_only'", meaning: 'exact lower-case quoted system identifiers still name pg_catalog.pg_settings', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL46', title: 'quoted set_config call is rejected', sql: "SELECT \"set_config\"('transaction_read_only', 'on', true)", meaning: 'the exact quoted lower-case built-in name remains a function call token', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL47', title: 'WITH SELECT set_config call is rejected', sql: "WITH x AS (SELECT 1) SELECT set_config('transaction_read_only', 'on', true) FROM x", meaning: 'allowed outer family does not permit a nested configuration call', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL48', title: 'WITH UPDATE pg_settings is rejected', sql: "WITH x AS (SELECT 'on' AS setting) UPDATE pg_catalog.pg_settings SET setting = x.setting FROM x WHERE name = 'transaction_read_only'", meaning: 'WITH does not hide the final pg_settings update target', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL49', title: 'qualified identifier containing set_config is allowed', sql: 'SELECT configuration_snapshot.my_set_config_value FROM configuration_snapshot', meaning: 'qualified ordinary identifiers do not become set_config calls', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL50', title: 'different function containing set_config is allowed', sql: 'SELECT my_set_config_value(1)', meaning: 'only the exact set_config function identifier is denied', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL51', title: 'qualified pg_settings data-modifying CTE is rejected', sql: "WITH changed AS (UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1", meaning: 'a data-modifying CTE updates the qualified run-time settings view even when the primary statement is SELECT', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL52', title: 'unqualified pg_settings data-modifying CTE is rejected', sql: "WITH changed AS (UPDATE pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1", companionSql: ["WITH changed AS (UPDATE ONLY pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1"], meaning: 'an unqualified data-modifying CTE, including optional ONLY, can update the run-time settings view', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL53', title: 'quoted qualified pg_settings data-modifying CTE is rejected', sql: "WITH changed AS (UPDATE \"pg_catalog\".\"pg_settings\" SET setting='on' WHERE name='transaction_read_only') SELECT 1", companionSql: ["WITH changed AS (UPDATE ONLY \"pg_catalog\".\"pg_settings\" SET setting='on' WHERE name='transaction_read_only') SELECT 1"], meaning: 'exact lower-case quoted system identifiers, including optional ONLY, still target pg_catalog.pg_settings inside a CTE', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL54', title: 'pg_settings UPDATE in the second CTE is rejected', sql: "WITH safe AS (SELECT 1), changed AS (UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1", meaning: 'every executable CTE scope must be inspected rather than only the first CTE or primary statement', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL55', title: 'pg_settings UPDATE CTE with RETURNING is rejected', sql: "WITH changed AS (UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only' RETURNING name) SELECT name FROM changed", meaning: 'RETURNING makes CTE output visible but does not make the run-time setting update safe', expected: 'reject', expectedDelegateCalls: 0, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL56', title: 'ordinary business data-modifying CTE remains allowed', sql: 'WITH changed AS (UPDATE xht_policy_target SET id=2 WHERE id=1 RETURNING id) SELECT id FROM changed', meaning: 'a business-table UPDATE CTE remains in the finite allowed contract', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true },
  { id: 'SQLPOL57', title: 'read-only pg_settings CTE remains allowed', sql: "WITH settings AS (SELECT setting FROM pg_catalog.pg_settings WHERE name='transaction_read_only') SELECT setting FROM settings", meaning: 'reading pg_settings through a SELECT CTE does not mutate run-time configuration', expected: 'allow', expectedDelegateCalls: 1, expectedRelease: 'normal', expectNextLegalQuery: true }
] as const satisfies readonly CallbackSqlPolicyCase[];

const policyFollowupSql = 'SELECT 1 AS xht_policy_followup';
function utf8Hex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex').toUpperCase().match(/../gu)?.join(' ') ?? '';
}

for (const policyCase of callbackSqlPolicyContract) {
  it(`${policyCase.id}: ${policyCase.title}`, async () => {
    for (const [variantIndex, sql] of [
      policyCase.sql,
      ...('companionSql' in policyCase ? policyCase.companionSql : [])
    ].entries()) {
      const state = createScriptedState();
      const scripted = createScriptedDatabase(state);
      let actual: CallbackSqlPolicyExpectation = 'allow';
      let error: unknown;
      try {
        const local = (await loadUnitOfWorkModule()).createUnitOfWork(scripted);
        try {
          await local.execute((context) =>
            executeInjectedSql(context, sql)
          );
        } catch (failure: unknown) {
          actual = 'reject';
          error = failure;
        }
        const delegateCalls = state.queryEvidence.filter(
          (entry) => entry.text === sql
        ).length;
        const sensitiveHits = error === undefined ? 0 : rawLeakHitCount(error);
        expect(utf8Hex(sql)).not.toBe('');
        expect(delegateCalls).toBe(policyCase.expectedDelegateCalls);
        expect(actual).toBe(policyCase.expected);
        if (policyCase.expected === 'reject') {
          expect(error).toMatchObject({
            code: 'TRANSACTION_CONTROL_STATEMENT_REJECTED',
            outcome: 'ROLLED_BACK'
          });
          expectNoRawLeak(error);
        } else {
          expect(error).toBeUndefined();
        }
        expect(sensitiveHits).toBe(0);
        await local.execute((context) =>
          executeInjectedSql(context, policyFollowupSql)
        );
        expect(
          state.queryEvidence.filter(
            (entry) => entry.text === policyFollowupSql
          )
        ).toHaveLength(1);
        expect(state.normalReleaseIds).toEqual([1, 1]);
        expect(state.destroyReleaseIds).toEqual([]);
        expect(state.acquiredClientIds).toEqual([1, 1]);
        if (process.env['XHT_TASK4_POLICY_EVIDENCE'] === '1') {
          console.log('SQLPOL_EVIDENCE', JSON.stringify({
            id:
              variantIndex === 0
                ? policyCase.id
                : `${policyCase.id}.VARIANT${variantIndex}`,
            title: policyCase.title,
            sql,
            utf8Hex: utf8Hex(sql),
            meaning: policyCase.meaning,
            expected: policyCase.expected,
            actual,
            delegateCalls,
            sensitiveHits,
            release: 'normal',
            nextLegalQuery: true
          }));
        }
      } finally {
        await scripted.destroy();
      }
    }
  });
}

});

void assertContextTypeSurface;
