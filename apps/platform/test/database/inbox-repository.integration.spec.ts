import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type {
  InboxDigestKeyVersion,
  InboxDigestSet,
  InboxPayloadDigest,
  StageOneDatabase
} from '@xht/contracts';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import {
  Kysely,
  PostgresDialect,
  type PostgresCursor,
  type PostgresPool,
  type PostgresPoolClient,
  type PostgresQueryResult
} from 'kysely';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';
import { RoleEnforcingPostgresPool } from '../../src/infrastructure/database/database.js';
import type { TransactionContext } from '../../src/infrastructure/database/transaction-context.js';
import {
  createUnitOfWork,
  PublicUnitOfWorkError,
  type UnitOfWork
} from '../../src/infrastructure/database/unit-of-work.js';
import { PostgresInboxRepository } from '../../src/modules/reliability/inbox/inbox.repository.js';
import {
  isAuthenticInboxRepositoryError,
  type InboxClaimCommand,
  type InboxClaimLease
} from '../../src/modules/reliability/inbox/inbox.types.js';

interface ExtendedQueryConfig {
  readonly text: string;
  readonly values: ReadonlyArray<unknown>;
  readonly queryMode: 'extended';
}

interface DestroyablePoolClient extends PostgresPoolClient {
  query<R>(
    statement: string, parameters: ReadonlyArray<unknown>
  ): Promise<PostgresQueryResult<R>>;
  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(config: ExtendedQueryConfig): Promise<PostgresQueryResult<R>>;
  release(destroy?: boolean): void;
}

interface RuntimePool extends PostgresPool {
  readonly Client: NonNullable<PostgresPool['Client']>;
  connect(): Promise<DestroyablePoolClient>;
  query<R>(statement: string, parameters: ReadonlyArray<unknown>): Promise<{ readonly rows: R[] }>;
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
  readonly pid: number;
  readonly text: string;
  readonly values: ReadonlyArray<unknown>;
}

class ObservablePoolClient implements DestroyablePoolClient {
  constructor(
    readonly client: DestroyablePoolClient,
    readonly pid: number,
    readonly releaseEvidence: ReleaseEvidence[],
    readonly queryEvidence: QueryEvidence[]
  ) {}

  query<R>(statement: string, parameters: ReadonlyArray<unknown>): Promise<PostgresQueryResult<R>>;
  query<R>(config: ExtendedQueryConfig): Promise<PostgresQueryResult<R>>;
  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(
    input: string | PostgresCursor<R> | ExtendedQueryConfig,
    parameters: ReadonlyArray<unknown> = []
  ): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof input === 'string') {
      this.queryEvidence.push({ pid: this.pid, text: input, values: [...parameters] });
      return this.client.query<R>(input, parameters);
    }
    if ('text' in input) {
      this.queryEvidence.push({ pid: this.pid, text: input.text, values: [...input.values] });
      return this.client.query<R>(input);
    }
    return this.client.query(input);
  }

  release(destroy = false): void {
    this.releaseEvidence.push({ pid: this.pid, destroy });
    this.client.release(destroy);
  }
}

class ObservableRuntimePool implements PostgresPool {
  readonly Client: NonNullable<PostgresPool['Client']>;
  readonly options: object;

  constructor(
    readonly pool: RuntimePool,
    readonly releaseEvidence: ReleaseEvidence[],
    readonly queryEvidence: QueryEvidence[]
  ) {
    this.Client = pool.Client;
    this.options = pool.options;
  }

  async connect(): Promise<PostgresPoolClient> {
    const client = await this.pool.connect();
    const observed = await client.query<{ readonly pid: number }>(
      'select pg_backend_pid()::integer as pid', []
    );
    const pid = observed.rows[0]?.pid;
    if (pid === undefined) {
      client.release(true);
      throw new Error('OBSERVABLE_POOL_PID_MISSING');
    }
    return new ObservablePoolClient(
      client,
      pid,
      this.releaseEvidence,
      this.queryEvidence
    );
  }

  end(): Promise<void> {
    return this.pool.end();
  }
}
const projectRoot = resolve(import.meta.dirname, '../../../..');
const flywaySources = {
  projectRoot,
  configFile: 'database/flyway.toml',
  migrationsDirectory: 'database/migrations',
  callbacksDirectory: 'database/flyway-callbacks'
} as const;
const repository = new PostgresInboxRepository();
const baseTime = new Date('2026-07-31T12:00:00.000Z');

let fixture: PostgresFixture;
let rawPool: RuntimePool;
let database: Kysely<StageOneDatabase>;
let unitOfWork: UnitOfWork;
let cleanupPool: Pool;
const releaseEvidence: ReleaseEvidence[] = [];
const queryEvidence: QueryEvidence[] = [];

function payloadDigest(character: string): InboxPayloadDigest {
  return `hmac-sha256:${character.repeat(43)}` as InboxPayloadDigest;
}

function digests(
  currentCharacter = 'A',
  currentVersion: InboxDigestKeyVersion = 'v2',
  retained: readonly {
    readonly version: InboxDigestKeyVersion;
    readonly character: string;
  }[] = []
): InboxDigestSet {
  const current = Object.freeze({
    keyVersion: currentVersion,
    payloadDigest: payloadDigest(currentCharacter)
  });
  return Object.freeze({
    current,
    comparisonCandidates: Object.freeze([
      current,
      ...retained.map((entry) => Object.freeze({
        keyVersion: entry.version,
        payloadDigest: payloadDigest(entry.character)
      }))
    ])
  });
}

function command(
  externalMessageId: string,
  digestSet: InboxDigestSet = digests(),
  receivedAt: Date = baseTime,
  claimant = `claimant-${randomUUID()}`
): InboxClaimCommand {
  return {
    consumer: 'telegram-webhook-v1',
    externalMessageId,
    digests: digestSet,
    correlationId: randomUUID(),
    claimant,
    receivedAt
  };
}

async function claim(input: InboxClaimCommand) {
  return unitOfWork.execute((context) => repository.claim(context, input));
}

function claimedLease(result: Awaited<ReturnType<typeof claim>>): InboxClaimLease {
  expect(result.kind).toBe('claimed');
  if (result.kind !== 'claimed') throw new Error('EXPECTED_CLAIMED');
  return result.lease;
}

async function row(externalMessageId: string) {
  return database.selectFrom('inbox_messages')
    .selectAll()
    .where('consumer', '=', 'telegram-webhook-v1')
    .where('external_message_id', '=', externalMessageId)
    .executeTakeFirstOrThrow();
}

async function countInbox(): Promise<number> {
  const result = await database.selectFrom('inbox_messages')
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(result.count);
}

async function countAudit(): Promise<number> {
  const result = await database.selectFrom('audit_events')
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(result.count);
}

async function databaseNow(): Promise<Date> {
  return unitOfWork.execute(async (context) => {
    const result = await context.executeSql<{ readonly database_now: Date }>(
      'SELECT clock_timestamp() AS database_now'
    );
    return result.rows[0]?.database_now ?? new Date(Number.NaN);
  });
}

async function seedExpiredMicrosecondLease(
  externalMessageId: string
): Promise<string> {
  return unitOfWork.execute(async (context) => {
    const result = await context.executeSql<{ readonly precision: string }>(
      `UPDATE inbox_messages
          SET claimed_until =
                date_trunc('milliseconds', clock_timestamp())
                - interval '1 second'
                + interval '456 microseconds'
        WHERE consumer = $1 AND external_message_id = $2
      RETURNING to_char(claimed_until, 'US') AS precision`,
      ['telegram-webhook-v1', externalMessageId]
    );
    const precision = result.rows[0]?.precision;
    if (precision === undefined) throw new Error('MICROSECOND_SEED_MISSING');
    return precision;
  });
}

async function expireClaim(externalMessageId: string): Promise<void> {
  await unitOfWork.execute((context) => context.executeSql(
    `UPDATE inbox_messages
        SET claimed_until = clock_timestamp() - interval '1 second'
      WHERE consumer = $1 AND external_message_id = $2`,
    ['telegram-webhook-v1', externalMessageId]
  ));
}

function publicStrings(value: unknown, seen = new Set<object>()): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  const strings: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string') strings.push(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      strings.push(...publicStrings(descriptor.value, seen));
    }
  }
  return strings;
}

async function seedInbox(input: {
  readonly externalMessageId: string;
  readonly payloadDigest?: InboxPayloadDigest;
  readonly keyVersion?: InboxDigestKeyVersion;
  readonly status: 'RECEIVED' | 'CLAIMED' | 'PROCESSED' | 'CONFLICT' | 'FAILED';
  readonly claimant?: string | null;
  readonly generation?: number;
  readonly claimedUntil?: Date | null;
  readonly processedAt?: Date | null;
  readonly failureCode?: string | null;
}): Promise<void> {
  await database.insertInto('inbox_messages').values({
    consumer: 'telegram-webhook-v1',
    external_message_id: input.externalMessageId,
    payload_digest: input.payloadDigest ?? payloadDigest('A'),
    digest_key_version: input.keyVersion ?? 'v2',
    correlation_id: randomUUID(),
    status: input.status,
    received_at: baseTime,
    claimed_by: input.claimant ?? null,
    claim_generation: input.generation ?? 0,
    claimed_until: input.claimedUntil ?? null,
    processed_at: input.processedAt ?? null,
    failure_code: input.failureCode ?? null
  }).execute();
}

async function insertSyntheticAudit(
  context: TransactionContext,
  subject: string
): Promise<void> {
  await context.database.insertInto('audit_events').values({
    audit_event_id: randomUUID(),
    event_type: 'synthetic.task5.effect',
    actor_type: 'SYSTEM',
    actor_ref: 'task5-test',
    subject_ref: subject,
    outcome: 'SYNTHETIC',
    correlation_id: randomUUID(),
    occurred_at: baseTime
  }).execute();
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, flywaySources);
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: false,
    application_name: 'xht-task5-inbox-cleanup'
  });
  rawPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 20,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: false,
    application_name: 'xht-task5-inbox'
  });
  const observablePool = new ObservableRuntimePool(
    rawPool,
    releaseEvidence,
    queryEvidence
  );
  database = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        observablePool as never,
        fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(database);
}, 180_000);

beforeEach(async () => {
  await cleanupPool.query('DELETE FROM audit_events');
  await cleanupPool.query('DELETE FROM inbox_messages');
  releaseEvidence.length = 0;
  queryEvidence.length = 0;
});

afterAll(async () => {
  await database.destroy();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('Task 5 Inbox repository', () => {
  it('T5C25: new message is claimed with current digest and generation one', async () => {
    const result = await claim(command('9001'));
    const lease = claimedLease(result);
    expect(result).toMatchObject({ kind: 'claimed', reclaimed: false });
    expect(lease.generation).toBe(1);
    expect(await row('9001')).toMatchObject({
      payload_digest: payloadDigest('A'),
      digest_key_version: 'v2',
      status: 'CLAIMED',
      claim_generation: 1
    });
  });

  it('T5C26: same payload replay is duplicate and remains one row', async () => {
    const first = await claim(command('9002'));
    const second = await claim(command('9002'));
    expect(first.kind).toBe('claimed');
    expect(second).toMatchObject({ kind: 'duplicate_same_payload', status: 'CLAIMED' });
    expect(await countInbox()).toBe(1);
  });

  it('T5C27: different payload conflicts without mutating the original row', async () => {
    await claim(command('9003'));
    const before = await row('9003');
    expect(await claim(command('9003', digests('B')))).toMatchObject({ kind: 'conflict' });
    expect(await row('9003')).toEqual(before);
  });

  it('T5C28: missing historical key fails closed without writes', async () => {
    await seedInbox({
      externalMessageId: '9004',
      status: 'CLAIMED',
      keyVersion: 'v1',
      claimant: 'old',
      generation: 1,
      claimedUntil: new Date(baseTime.getTime() + 30_000)
    });
    const before = await row('9004');
    expect(await claim(command('9004', digests('B', 'v2')))).toMatchObject({
      kind: 'digest_key_unavailable',
      requiredKeyVersion: 'v1'
    });
    expect(await row('9004')).toEqual(before);
  });

  it('T5C29: retained key identifies an old row replay', async () => {
    await seedInbox({
      externalMessageId: '9005',
      status: 'PROCESSED',
      keyVersion: 'v1',
      processedAt: baseTime
    });
    expect(await claim(command('9005', digests('B', 'v2', [
      { version: 'v1', character: 'A' }
    ])))).toMatchObject({ kind: 'duplicate_same_payload', status: 'PROCESSED' });
  });

  it('T5C30: new row after rotation writes only the current version', async () => {
    await claim(command('9006', digests('B', 'v2', [
      { version: 'v1', character: 'A' }
    ])));
    expect(await row('9006')).toMatchObject({
      payload_digest: payloadDigest('B'),
      digest_key_version: 'v2'
    });
  });

  it('T5C31: concurrent same payload yields one claim and one duplicate', async () => {
    const results = await Promise.all([
      claim(command('9007')),
      claim(command('9007'))
    ]);
    expect(results.map((value) => value.kind).sort())
      .toEqual(['claimed', 'duplicate_same_payload']);
    expect(await countInbox()).toBe(1);
  });

  it('T5C32: concurrent different payload yields one claim and one conflict', async () => {
    const results = await Promise.all([
      claim(command('9008', digests('A'))),
      claim(command('9008', digests('B')))
    ]);
    expect(results.map((value) => value.kind).sort())
      .toEqual(['claimed', 'conflict']);
    expect(await countInbox()).toBe(1);
  });

  it('T5C33: sixteen concurrent replays yield one claim and fifteen duplicates', async () => {
    const results = await Promise.all(
      Array.from({ length: 16 }, () => claim(command('9009')))
    );
    expect(results.filter((value) => value.kind === 'claimed')).toHaveLength(1);
    expect(results.filter((value) => value.kind === 'duplicate_same_payload')).toHaveLength(15);
    expect(await countInbox()).toBe(1);
  });

  it('T5C34: received row is claimed and generation advances', async () => {
    await seedInbox({ externalMessageId: '9010', status: 'RECEIVED' });
    const result = await claim(command('9010'));
    expect(result).toMatchObject({ kind: 'claimed', reclaimed: false });
    expect(claimedLease(result).generation).toBe(1);
  });

  it('T5C35: forged future receivedAt cannot steal an active database-time lease', async () => {
    const first = await claim(command('9011'));
    const before = await row('9011');
    expect(await claim(command('9011', digests(), new Date('2099-01-01T00:00:00.000Z'))))
      .toMatchObject({ kind: 'duplicate_same_payload' });
    expect(await row('9011')).toEqual(before);
    expect(first.kind).toBe('claimed');
  });

  it('T5C36: a database microsecond lease reclaims without Date round-trip CAS', async () => {
    await seedInbox({
      externalMessageId: '9012',
      status: 'CLAIMED',
      claimant: 'old-claimant',
      generation: 3,
      claimedUntil: baseTime
    });
    const precision = await seedExpiredMicrosecondLease('9012');
    expect(Number(precision) % 1_000).toBe(456);
    const result = await claim(command(
      '9012', digests(), new Date('2000-01-01T00:00:00.000Z'), 'new-claimant'
    ));
    expect(result).toMatchObject({ kind: 'claimed', reclaimed: true });
    expect(claimedLease(result).generation).toBe(4);
  });

  it('T5C37: SQL <= contract and concurrent reclaim produce one new generation', async () => {
    await claim(command('9013'));
    await seedExpiredMicrosecondLease('9013');
    const queryStart = queryEvidence.length;
    const results = await Promise.all([
      claim(command('9013', digests(), new Date('2099-01-01T00:00:00.000Z'), 'new-a')),
      claim(command('9013', digests(), new Date('2000-01-01T00:00:00.000Z'), 'new-b'))
    ]);
    expect(results.map((value) => value.kind).sort())
      .toEqual(['claimed', 'duplicate_same_payload']);
    expect((await row('9013')).claim_generation).toBe(2);
    const reclaimSql = queryEvidence.slice(queryStart)
      .map((value) => value.text.replace(/\s+/gu, ' ').trim())
      .filter((value) => value.includes('UPDATE inbox_messages AS inbox'));
    expect(reclaimSql.length).toBeGreaterThanOrEqual(1);
    for (const text of reclaimSql) {
      expect(text).toContain('inbox.claimed_until <= database_time.value');
      expect(text).not.toMatch(/inbox\.claimed_until\s*<(?![=])\s*database_time\.value/gu);
      expect(text).not.toContain('claimed_until = $');
    }
  });

  it('T5C38: claimant, generation and inbox CAS predicates fail independently', async () => {
    await seedInbox({
      externalMessageId: '9014',
      status: 'CLAIMED',
      claimant: 'old-claimant',
      generation: 3,
      claimedUntil: baseTime
    });
    await seedExpiredMicrosecondLease('9014');
    const current = claimedLease(await claim(command(
      '9014', digests(), baseTime, 'new-claimant'
    )));
    const invalidLeases: readonly InboxClaimLease[] = [
      { ...current, claimant: 'wrong-claimant' },
      { ...current, generation: current.generation - 1 },
      { ...current, claimant: 'old-claimant', generation: current.generation - 1 },
      { ...current, inboxId: randomUUID() }
    ];
    for (const invalidLease of invalidLeases) {
      const before = await row('9014');
      expect(await unitOfWork.execute((context) =>
        repository.markProcessed(context, { lease: invalidLease })
      )).toBe(false);
      expect(await row('9014')).toEqual(before);
      expect(await countAudit()).toBe(0);
    }
  });
  it('T5C39: fake processedAt cannot bypass expiry and database time completes current lease', async () => {
    const expired = claimedLease(await claim(command('9015-expired')));
    await expireClaim('9015-expired');
    const forged = { lease: expired, processedAt: new Date('2000-01-01T00:00:00.000Z') };
    expect(await unitOfWork.execute((context) =>
      repository.markProcessed(context, forged)
    )).toBe(false);
    const current = claimedLease(await claim(command('9015-current')));
    const before = await databaseNow();
    expect(await unitOfWork.execute((context) =>
      repository.markProcessed(context, { lease: current })
    )).toBe(true);
    const after = await databaseNow();
    const completed = await row('9015-current');
    expect(completed).toMatchObject({
      status: 'PROCESSED',
      claimed_by: null,
      claimed_until: null
    });
    expect(completed.processed_at).toBeInstanceOf(Date);
    expect(completed.processed_at?.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(completed.processed_at?.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('T5C40: repeated mark processed returns false without mutation', async () => {
    const lease = claimedLease(await claim(command('9016')));
    await unitOfWork.execute((context) => repository.markProcessed(context, { lease }));
    const before = await row('9016');
    expect(await unitOfWork.execute((context) => repository.markProcessed(context, { lease })))
      .toBe(false);
    expect(await row('9016')).toEqual(before);
  });

  it('T5C41: processed same payload remains duplicate', async () => {
    const lease = claimedLease(await claim(command('9017')));
    await unitOfWork.execute((context) => repository.markProcessed(context, { lease }));
    expect(await claim(command('9017'))).toMatchObject({
      kind: 'duplicate_same_payload',
      status: 'PROCESSED'
    });
  });

  it('T5C42: processed conflict leaves processed evidence unchanged', async () => {
    const lease = claimedLease(await claim(command('9018')));
    await unitOfWork.execute((context) => repository.markProcessed(context, { lease }));
    const before = await row('9018');
    expect(await claim(command('9018', digests('B')))).toMatchObject({ kind: 'conflict' });
    expect(await row('9018')).toEqual(before);
  });

  it('T5C43: synthetic business effect and processed state commit together', async () => {
    await unitOfWork.execute(async (context) => {
      const result = await repository.claim(context, command('9019'));
      const lease = claimedLease(result);
      await insertSyntheticAudit(context, '9019');
      if (!await repository.markProcessed(context, { lease })) {
        throw new PublicUnitOfWorkError('APPLICATION_INBOX_CLAIM_LOST');
      }
    });
    expect(await countAudit()).toBe(1);
    expect((await row('9019')).status).toBe('PROCESSED');
  });

  it('T5C44: callback throw rolls back business effect and processed state', async () => {
    await expect(unitOfWork.execute(async (context) => {
      const result = await repository.claim(context, command('9020'));
      const lease = claimedLease(result);
      await insertSyntheticAudit(context, '9020');
      await repository.markProcessed(context, { lease });
      throw new PublicUnitOfWorkError('APPLICATION_SYNTHETIC_ROLLBACK');
    })).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    expect(await countAudit()).toBe(0);
    expect(await countInbox()).toBe(0);
  });

  it('T5C45: stale CAS error rolls back a preceding business effect', async () => {
    const oldLease = claimedLease(await claim(command('9021')));
    await expireClaim('9021');
    await claim(command('9021', digests(), baseTime, 'new-claimant'));
    await expect(unitOfWork.execute(async (context) => {
      await insertSyntheticAudit(context, '9021');
      if (!await repository.markProcessed(context, { lease: oldLease })) {
        throw new PublicUnitOfWorkError('APPLICATION_INBOX_CLAIM_LOST');
      }
    })).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
    expect(await countAudit()).toBe(0);
    expect((await row('9021')).status).toBe('CLAIMED');
  });

  it('T5C46: malformed accessors and proxies fail before every context touch', async () => {
    const sensitive = 'RAW_T5C46_SECRET_VALUE';
    const accessorReturn = 'T5C46_ACCESSOR_RETURN_SENTINEL';
    const methodReturn = 'T5C46_METHOD_RETURN_SENTINEL';
    const proxyTrap = 'T5C46_PROXY_TRAP_SENTINEL';
    let getterCalls = 0;
    let methodCalls = 0;
    let trapCalls = 0;

    function trappedProxy<T extends object>(target: T): T {
      const trap = (): never => {
        trapCalls += 1;
        throw new Error(proxyTrap);
      };
      return new Proxy(target, {
        get: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
        has: trap
      });
    }

    const accessorCandidates: unknown[] = [];
    Object.defineProperty(accessorCandidates, '0', {
      enumerable: true,
      configurable: true,
      get(): unknown {
        getterCalls += 1;
        return { keyVersion: 'v2', payloadDigest: accessorReturn };
      }
    });
    const sparseCandidates = new Array<unknown>(1);
    const extraCandidates: unknown[] = [digests().current];
    Object.defineProperty(extraCandidates, 'extra', {
      value: sensitive,
      enumerable: true
    });
    const symbolCandidates: unknown[] = [digests().current];
    Object.defineProperty(symbolCandidates, Symbol('t5c46'), {
      value: sensitive,
      enumerable: true
    });
    function dateWithGetTimeAccessor(): Date {
      const value = new Date(baseTime.getTime());
      Object.defineProperty(value, 'getTime', {
        configurable: true,
        get(): () => number {
          getterCalls += 1;
          return () => {
            methodCalls += 1;
            throw new Error(accessorReturn);
          };
        }
      });
      return value;
    }
    function dateWithGetTimeMethod(): Date {
      const value = new Date(baseTime.getTime());
      Object.defineProperty(value, 'getTime', {
        configurable: true,
        value(): number {
          methodCalls += 1;
          throw new Error(methodReturn);
        }
      });
      return value;
    }
    class DateSubclass extends Date {}

    interface MalformedCase {
      readonly kind: 'claim' | 'mark';
      readonly value: unknown;
    }
    const malformed: readonly MalformedCase[] = [
      { kind: 'claim', value: null },
      { kind: 'claim', value: undefined },
      { kind: 'claim', value: 7 },
      { kind: 'claim', value: sensitive },
      { kind: 'claim', value: {} },
      { kind: 'claim', value: { ...command('9022-a'), digests: null } },
      {
        kind: 'claim',
        value: { ...command('9022-b'), digests: { ...digests(), comparisonCandidates: null } }
      },
      {
        kind: 'claim',
        value: { ...command('9022-c'), digests: { ...digests(), comparisonCandidates: [null] } }
      },
      { kind: 'claim', value: { ...command('9022-d'), receivedAt: new Date(Number.NaN) } },
      { kind: 'claim', value: trappedProxy(command('9022-proxy-root')) },
      { kind: 'claim', value: { ...command('9022-proxy-digests'), digests: trappedProxy(digests()) } },
      {
        kind: 'claim',
        value: {
          ...command('9022-proxy-array'),
          digests: {
            ...digests(),
            comparisonCandidates: trappedProxy([digests().current])
          }
        }
      },
      {
        kind: 'claim',
        value: {
          ...command('9022-accessor'),
          digests: { ...digests(), comparisonCandidates: accessorCandidates }
        }
      },
      {
        kind: 'claim',
        value: {
          ...command('9022-proxy-candidate'),
          digests: {
            ...digests(),
            comparisonCandidates: [trappedProxy(digests().current)]
          }
        }
      },
      { kind: 'claim', value: { ...command('9022-proxy-date'), receivedAt: trappedProxy(baseTime) } },
      { kind: 'claim', value: { ...command('9022-date-accessor'), receivedAt: dateWithGetTimeAccessor() } },
      { kind: 'claim', value: { ...command('9022-date-method'), receivedAt: dateWithGetTimeMethod() } },
      { kind: 'claim', value: {
        ...command('9022-date-subclass'), receivedAt: new DateSubclass(baseTime.getTime())
      } },
      {
        kind: 'claim',
        value: { ...command('9022-sparse'), digests: { ...digests(), comparisonCandidates: sparseCandidates } }
      },
      {
        kind: 'claim',
        value: { ...command('9022-extra'), digests: { ...digests(), comparisonCandidates: extraCandidates } }
      },
      {
        kind: 'claim',
        value: { ...command('9022-symbol'), digests: { ...digests(), comparisonCandidates: symbolCandidates } }
      },
      { kind: 'mark', value: null },
      { kind: 'mark', value: {} },
      { kind: 'mark', value: { lease: null } },
      {
        kind: 'mark',
        value: { lease: { inboxId: sensitive, claimant: 'x', generation: 1, claimedUntil: baseTime } }
      },
      {
        kind: 'mark',
        value: { lease: { inboxId: randomUUID(), claimant: 'x', generation: 0, claimedUntil: baseTime } }
      },
      {
        kind: 'mark',
        value: { lease: { inboxId: randomUUID(), claimant: 'x', generation: 1, claimedUntil: null } }
      },
      { kind: 'mark', value: { lease: trappedProxy({
        inboxId: randomUUID(), claimant: 'x', generation: 1, claimedUntil: baseTime
      }) } },
      { kind: 'mark', value: { lease: {
        inboxId: randomUUID(), claimant: 'x', generation: 1, claimedUntil: trappedProxy(baseTime)
      } } },
      { kind: 'mark', value: { lease: {
        inboxId: randomUUID(), claimant: 'x', generation: 1,
        claimedUntil: dateWithGetTimeAccessor()
      } } },
      { kind: 'mark', value: { lease: {
        inboxId: randomUUID(), claimant: 'x', generation: 1,
        claimedUntil: dateWithGetTimeMethod()
      } } },
      { kind: 'mark', value: { lease: {
        inboxId: randomUUID(), claimant: 'x', generation: 1,
        claimedUntil: new DateSubclass(baseTime.getTime())
      } } }
    ];

    let contextTouches = 0;
    const untouchedContext = Object.defineProperties({}, {
      database: { get: () => { contextTouches += 1; throw new Error('CONTEXT_TOUCHED'); } },
      executeSql: { get: () => { contextTouches += 1; throw new Error('CONTEXT_TOUCHED'); } }
    }) as unknown as TransactionContext;
    const invoke = async (entry: MalformedCase): Promise<unknown> => {
      if (entry.kind === 'claim') {
        return repository.claim(untouchedContext, entry.value as InboxClaimCommand);
      }
      return repository.markProcessed(untouchedContext, entry.value as never);
    };

    for (const entry of malformed) {
      const beforeTouches = contextTouches;
      const beforeGetter = getterCalls;
      const beforeMethod = methodCalls;
      const beforeTraps = trapCalls;
      const direct = await invoke(entry).catch((value: unknown) => value);
      expect(isAuthenticInboxRepositoryError(direct)).toBe(true);
      expect(direct).toMatchObject({ code: 'INBOX_COMMAND_INVALID', retryable: false });
      expect(contextTouches).toBe(beforeTouches);
      expect(getterCalls).toBe(beforeGetter);
      expect(methodCalls).toBe(beforeMethod);
      expect(trapCalls).toBe(beforeTraps);
      for (const secret of [sensitive, accessorReturn, methodReturn, proxyTrap]) {
        expect(publicStrings(direct).join('|')).not.toContain(secret);
      }

      const wrapped = await unitOfWork.execute(() => invoke(entry))
        .catch((value: unknown) => value);
      expect(wrapped).toMatchObject({
        code: 'TRANSACTION_CALLBACK_FAILED',
        outcome: 'ROLLED_BACK',
        retryable: false,
        primaryCategory: 'CALLBACK',
        cleanupCategory: undefined
      });
      expect(wrapped).not.toHaveProperty('cause');
      expect(contextTouches).toBe(beforeTouches);
      expect(getterCalls).toBe(beforeGetter);
      expect(methodCalls).toBe(beforeMethod);
      expect(trapCalls).toBe(beforeTraps);
      for (const secret of [sensitive, accessorReturn, methodReturn, proxyTrap]) {
        expect(publicStrings(wrapped).join('|')).not.toContain(secret);
      }
    }
    expect(contextTouches).toBe(0);
    expect(getterCalls).toBe(0);
    expect(methodCalls).toBe(0);
    expect(trapCalls).toBe(0);
    expect(await countInbox()).toBe(0);
  });

  it('T5C47: escaped context rejects repository use after callback settle', async () => {
    let escaped: TransactionContext | undefined;
    await unitOfWork.execute((context) => { escaped = context; });
    if (escaped === undefined) throw new Error('MISSING_ESCAPED_CONTEXT');
    await expect(repository.claim(escaped, command('9023')))
      .rejects.toMatchObject({ code: 'TRANSACTION_CONTEXT_CLOSED' });
    expect(await countInbox()).toBe(0);
  });

  it('T5C48: terminated backend error exposes only the stable allowlist and destroys once', async () => {
    const adminPool = new Pool({
      connectionString: fixture.bootstrapLogin.connectionString,
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: false,
      application_name: 'xht-task5-admin'
    });
    const externalMessageId = `T5C48_EXTERNAL_${randomUUID()}`;
    const consumer = `T5C48_CONSUMER_${randomUUID()}`;
    const claimant = `T5C48_CLAIMANT_${randomUUID()}`;
    const rawUpdate = `T5C48_RAW_UPDATE_${randomUUID()}`;
    const callbackData = `T5C48_CALLBACK_${randomUUID()}`;
    const sqlSentinel = `T5C48_SQL_${randomUUID()}`;
    const tableSentinel = `T5C48_TABLE_${randomUUID()}`;
    const sqlParameter = `T5C48_PARAMETER_${randomUUID()}`;
    const failureDigests = digests('Q');
    const platformUrl = new URL(fixture.platformLogin.connectionString);
    const bootstrapUrl = new URL(fixture.bootstrapLogin.connectionString);
    const runtimeSentinels = [...new Set([
      externalMessageId,
      consumer,
      claimant,
      failureDigests.current.payloadDigest,
      rawUpdate,
      callbackData,
      sqlSentinel,
      tableSentinel,
      sqlParameter,
      fixture.platformLogin.connectionString,
      fixture.bootstrapLogin.connectionString,
      fixture.platformLogin.username,
      fixture.bootstrapLogin.username,
      platformUrl.username,
      bootstrapUrl.username,
      decodeURIComponent(platformUrl.password),
      decodeURIComponent(bootstrapUrl.password)
    ].filter((value) => value.length > 0))];
    const failureCommand = {
      ...command(externalMessageId, failureDigests, baseTime, claimant),
      consumer,
      rawUpdate: { extra: rawUpdate },
      callbackData: { extra: callbackData }
    } as InboxClaimCommand;
    let failedPid = 0;
    const evidenceStart = releaseEvidence.length;
    try {
      const observed = unitOfWork.execute(async (context) => {
        const pidResult = await context.executeSql<{ readonly pid: number }>(
          `SELECT pg_backend_pid() AS pid
            WHERE $1::text IS NOT NULL
            /* ${sqlSentinel} ${tableSentinel} */`,
          [sqlParameter]
        );
        failedPid = pidResult.rows[0]?.pid ?? 0;
        if (failedPid === 0) throw new PublicUnitOfWorkError('APPLICATION_PID_MISSING');
        await adminPool.query('SELECT pg_terminate_backend($1)', [failedPid]);
        return repository.claim(context, failureCommand);
      });
      const error = await observed.catch((value: unknown) => value);
      expect(error).toMatchObject({
        code: 'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        outcome: 'NOT_COMMITTED',
        retryable: false,
        primaryCategory: 'CALLBACK',
        cleanupCategory: 'ROLLBACK'
      });
      expect(error).not.toHaveProperty('cause');
      const errorStrings = publicStrings(error);
      for (const sentinel of runtimeSentinels) {
        expect(errorStrings.filter((value) => value.includes(sentinel))).toHaveLength(0);
      }
      const approvedStrings = new Set([
        'stack',
        'message',
        'name',
        'code',
        'outcome',
        'retryable',
        'primaryCategory',
        'cleanupCategory',
        'UnitOfWorkError',
        'TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        'UnitOfWorkError: TRANSACTION_CALLBACK_AND_ROLLBACK_FAILED',
        'NOT_COMMITTED',
        'CALLBACK',
        'ROLLBACK'
      ]);
      expect(errorStrings.every((value) => approvedStrings.has(value))).toBe(true);
      expect(releaseEvidence.slice(evidenceStart).filter((value) => value.pid === failedPid))
        .toEqual([{ pid: failedPid, destroy: true }]);

      let healthyPid = 0;
      const healthyEvidenceStart = releaseEvidence.length;
      const healthy = await unitOfWork.execute(async (context) => {
        const pidResult = await context.executeSql<{ readonly pid: number }>(
          'SELECT pg_backend_pid() AS pid'
        );
        healthyPid = pidResult.rows[0]?.pid ?? 0;
        return repository.claim(context, command('9024-healthy'));
      });
      expect(healthy.kind).toBe('claimed');
      expect(healthyPid).not.toBe(failedPid);
      expect(releaseEvidence.slice(healthyEvidenceStart).filter((value) => value.pid === healthyPid))
        .toEqual([{ pid: healthyPid, destroy: false }]);
    } finally {
      await adminPool.end();
    }
  });
  it('T5C49: schema has unique key and no raw payload columns', async () => {
    const evidence = await unitOfWork.execute((context) => context.executeSql<{
      readonly column_name: string;
    }>(`SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inbox_messages'
        ORDER BY column_name`));
    const names = evidence.rows.map((value) => value.column_name);
    for (const forbidden of [
      'raw_update', 'payload', 'body', 'text',
      'callback_data', 'canonical_json', 'canonical_bytes'
    ]) expect(names).not.toContain(forbidden);
    const constraints = await unitOfWork.execute((context) => context.executeSql<{
      readonly constraint_name: string;
    }>(`SELECT constraint_name
         FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'inbox_messages'`));
    expect(constraints.rows.map((value) => value.constraint_name))
      .toContain('uq_inbox_consumer_external');
  });

  it('T5C50: platform role is active and worker gains no inbox access', async () => {
    const role = await unitOfWork.execute((context) => context.executeSql<{
      readonly session_user: string;
      readonly current_user: string;
    }>('SELECT session_user, current_user'));
    expect(role.rows[0]).toEqual({
      session_user: fixture.platformLogin.username,
      current_user: 'xht_platform'
    });
    const workerPool = new Pool({
      connectionString: fixture.workerLogin.connectionString,
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: false,
      application_name: 'xht-task5-worker-negative'
    });
    const client = await workerPool.connect();
    try {
      await client.query('SET ROLE xht_worker', []);
      await expect(client.query('SELECT inbox_id FROM inbox_messages LIMIT 1', []))
        .rejects.toBeInstanceOf(Error);
    } finally {
      client.release();
      await workerPool.end();
    }
  });
});
