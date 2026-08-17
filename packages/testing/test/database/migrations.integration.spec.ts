import { appendFile, cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { Pool } from 'pg';
import { getContainerRuntimeClient } from 'testcontainers';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  FlywayRunnerError,
  LockedImageError,
  migrateAndValidate,
  readLockedImage,
  runFlywayCommand,
  startPostgresFixture,
  type PostgresFixture
} from '../../src/index.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const lockFilePath = resolve(projectRoot, 'toolchain-lock.json');
const temporaryDirectories: string[] = [];
const flywaySources = {
  projectRoot,
  configFile: 'database/flyway.toml',
  migrationsDirectory: 'database/migrations',
  callbacksDirectory: 'database/flyway-callbacks'
} as const;
let fixture: PostgresFixture;
let migrationEvidence: Awaited<ReturnType<typeof migrateAndValidate>>;

interface FakeRunnerRecords {
  readonly logOptions: Array<{ readonly abortSignal?: AbortSignal }>;
  readonly removedIds: string[];
  removeCalls: number;
  stopCalls: number;
  timerCount: number;
}

interface FakeRunnerOptions {
  readonly logs?: (
    options: { readonly abortSignal?: AbortSignal }
  ) =>
    | Buffer
    | NodeJS.ReadableStream
    | Promise<Buffer | NodeJS.ReadableStream>;
  readonly source?: Buffer | NodeJS.ReadableStream;
  readonly removeFails?: boolean;
  readonly ownerMismatch?: boolean;
  readonly useFakeTimers?: boolean;
}

interface FakeRunnerOutcome {
  readonly value?: {
    readonly exitCode: number;
    readonly passwordLeakCount: number;
  };
  readonly error?: {
    readonly code?: string;
    readonly cleanupEvidence?: readonly string[];
  };
  readonly records: FakeRunnerRecords;
}

function dockerFrame(
  streamType: number,
  payload: Buffer | string,
  reserved: readonly [number, number, number] = [0, 0, 0]
): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt8(reserved[0], 1);
  header.writeUInt8(reserved[1], 2);
  header.writeUInt8(reserved[2], 3);
  header.writeUInt32BE(body.byteLength, 4);
  return Buffer.concat([header, body]);
}

function observedError(
  outcome: FakeRunnerOutcome,
  code: string
): void {
  expect(outcome.value).toBeUndefined();
  expect(outcome.error).toEqual(expect.objectContaining({ code }));
}

async function executeFakeRunner(
  options: FakeRunnerOptions = {}
): Promise<FakeRunnerOutcome> {
  const records: FakeRunnerRecords = {
    logOptions: [],
    removedIds: [],
    removeCalls: 0,
    stopCalls: 0,
    timerCount: 0
  };
  let labels: Readonly<Record<string, string>> = {};
  let runtimeReady!: () => void;
  const runtimeReadyPromise = new Promise<void>((resolvePromise) => {
    runtimeReady = resolvePromise;
  });
  const started = {
    getId: () => 'fake-flyway-container',
    getLabels: () =>
      options.ownerMismatch
        ? { 'com.xht.task3.flyway-owner': 'different-owner' }
        : labels
  };
  const runtimeContainer = { id: 'fake-flyway-container' };
  const logs =
    options.logs ??
    (() => options.source ?? Buffer.alloc(0));
  const runtime = {
    container: {
      dockerode: {
        getContainer: () => ({
          logs: (
            requestOptions: { readonly abortSignal?: AbortSignal }
          ) => {
            records.logOptions.push(requestOptions);
            return logs(requestOptions);
          }
        }),
        listContainers: async () => []
      },
      getById: () => runtimeContainer,
      inspect: async () => ({
        State: {
          Running: false,
          ExitCode: 0,
          Status: 'exited'
        }
      }),
      stop: async () => {
        records.stopCalls += 1;
      },
      remove: async (container: { readonly id: string }) => {
        records.removeCalls += 1;
        records.removedIds.push(container.id);
        if (options.removeFails) {
          throw new Error('synthetic-secret-remove');
        }
      }
    }
  };

  class FakeGenericContainer {
    withPlatform(): this { return this; }
    withNetwork(): this { return this; }
    withLabels(value: Readonly<Record<string, string>>): this {
      labels = value;
      return this;
    }
    withAutoCleanup(): this { return this; }
    withAutoRemove(): this { return this; }
    withWaitStrategy(): this { return this; }
    withStartupTimeout(): this { return this; }
    withEnvironment(): this { return this; }
    withCopyFilesToContainer(): this { return this; }
    withCopyDirectoriesToContainer(): this { return this; }
    withCommand(): this { return this; }
    async start(): Promise<typeof started> { return started; }
  }

  vi.resetModules();
  vi.doMock('testcontainers', () => ({
    GenericContainer: FakeGenericContainer,
    StartupCheckStrategy: class {},
    getContainerRuntimeClient: async () => {
      if (options.useFakeTimers) vi.useFakeTimers();
      runtimeReady();
      return runtime;
    }
  }));
  try {
    const runnerModulePath = '../../src/flyway-runner.js';
    const runner = await import(runnerModulePath) as {
      readonly runFlywayCommand: typeof runFlywayCommand;
    };
    const fakeFixture = {
      databaseName: 'xht_test',
      hostAlias: 'postgres',
      network: {},
      bootstrapLogin: {
        username: 'bootstrap',
        password: 'unused',
        connectionString: 'postgresql://unused'
      },
      flywayLogin: {
        username: 'xht_flyway_test_login',
        password: 'synthetic-secret',
        connectionString: 'postgresql://unused'
      },
      platformLogin: {
        username: 'platform',
        password: 'unused',
        connectionString: 'postgresql://unused'
      },
      workerLogin: {
        username: 'worker',
        password: 'unused',
        connectionString: 'postgresql://unused'
      },
      flywayEnvironment: {
        FLYWAY_URL:
          'jdbc:postgresql://postgres:5432/xht_test' +
          '?options=-c%20role%3Dxht_flyway',
        FLYWAY_USER: 'xht_flyway_test_login',
        FLYWAY_PASSWORD: 'synthetic-secret',
        REDGATE_DISABLE_TELEMETRY: 'true'
      },
      tableNames: async () => [],
      appliedMigrations: async () => [{
        installedRank: 1,
        version: '1',
        description: 'stage 1 identity reliability',
        checksum: 1,
        success: true
      }],
      stop: async () => undefined
    } as unknown as PostgresFixture;
    const observed = runner.runFlywayCommand(
      fakeFixture,
      'validate',
      flywaySources
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({
        error: error as FakeRunnerOutcome['error']
      })
    );

    if (options.useFakeTimers) {
      await runtimeReadyPromise;
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(6_000);
    }
    const outcome = await observed;
    if (options.useFakeTimers) {
      records.timerCount = vi.getTimerCount();
    }
    return { ...outcome, records };
  } finally {
    if (options.useFakeTimers) vi.useRealTimers();
    vi.doUnmock('testcontainers');
    vi.resetModules();
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  migrationEvidence = await migrateAndValidate(fixture, flywaySources);
}, 180_000);

afterAll(async () => {
  if (fixture !== undefined) await fixture.stop();
}, 180_000);

describe('stage one migrations', () => {
  it('M01 resolves the locked linux/amd64 child digests', () => {
    expect(readLockedImage('postgres', lockFilePath)).toEqual({
      reference: 'postgres:18.4-alpine3.23',
      platform: 'linux/amd64',
      manifestListDigest:
        'sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e',
      digest:
        'sha256:2342268e5cf8851c327dcf10fc124283448428059f9b756692b7e3302940d769',
      immutableReference:
        'postgres:18.4-alpine3.23@sha256:2342268e5cf8851c327dcf10fc124283448428059f9b756692b7e3302940d769'
    });
    expect(readLockedImage('flyway', lockFilePath)).toEqual({
      reference: 'flyway/flyway:12.11.0-alpine',
      platform: 'linux/amd64',
      manifestListDigest:
        'sha256:6bf3a713f52c4d803a88501f8409dda2191e9ccba1454358a6de2c4cc65f71b0',
      digest:
        'sha256:bd93084ddaf1448d2598feaac75a1c2e7087c529566746724f65b05b481f9704',
      immutableReference:
        'flyway/flyway:12.11.0-alpine@sha256:bd93084ddaf1448d2598feaac75a1c2e7087c529566746724f65b05b481f9704'
    });
  });

  it('M02 rejects a manifest-list digest used as a child digest', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'xht-task3-lock-'));
    temporaryDirectories.push(directory);
    const invalidLock = resolve(directory, 'toolchain-lock.json');
    await writeFile(
      invalidLock,
      JSON.stringify({
        schemaVersion: 1,
        images: {
          postgres: {
            reference: 'postgres:18.4-alpine3.23',
            platform: 'linux/amd64',
            manifestListDigest:
              'sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e',
            digest:
              'sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e',
            status: 'VERIFIED'
          }
        }
      }),
      'utf8'
    );

    expect(() => readLockedImage('postgres', invalidLock)).toThrowError(
      expect.objectContaining<Partial<LockedImageError>>({
        code: 'IMAGE_REFERENCE_MISMATCH'
      })
    );
  });

  it('M03 migrates an empty database through all versions', () => {
    expect(migrationEvidence.firstMigrate.appliedVersions).toEqual(['1', '2']);
    expect(migrationEvidence.firstMigrate.exitCode).toBe(0);
  });

  it('M04 applies no new version on the second migrate', () => {
    expect(migrationEvidence.secondMigrate.appliedVersions).toEqual(['1', '2']);
    expect(migrationEvidence.secondMigrate.exitCode).toBe(0);
  });

  it('M05 validates the original migration', () => {
    expect(migrationEvidence.validate.validationSuccessful).toBe(true);
    expect(migrationEvidence.validate.exitCode).toBe(0);
  });

  it('M06 rejects checksum drift and cleans the failed Flyway container', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'xht-task3-checksum-'));
    temporaryDirectories.push(directory);
    const databaseDirectory = resolve(directory, 'database');
    await cp(resolve(projectRoot, 'database'), databaseDirectory, {
      recursive: true
    });
    await appendFile(
      resolve(
        databaseDirectory,
        'migrations/V1__stage_1_identity_reliability.sql'
      ),
      '\nSELECT 1;\n',
      'utf8'
    );
    const observed = runFlywayCommand(fixture, 'validate', {
      projectRoot: directory,
      configFile: 'database/flyway.toml',
      migrationsDirectory: 'database/migrations',
      callbacksDirectory: 'database/flyway-callbacks'
    }).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(await observed).toEqual(
      expect.objectContaining<Partial<FlywayRunnerError>>({
        code: 'FLYWAY_VALIDATE_FAILED',
        cleanupEvidence: []
      })
    );
  });

  it('M07 creates exactly the fourteen stage one and two tables', async () => {
    expect(await fixture.tableNames()).toEqual([
      'audit_events',
      'channel_bindings',
      'credential_policies',
      'credential_sessions',
      'durable_jobs',
      'identity_profiles',
      'inbox_messages',
      'memberships',
      'outbox_messages',
      'payment_credentials',
      'recovery_cases',
      'registration_idempotency',
      'security_locks',
      'users'
    ]);
  });

  it('M08 records successful Flyway history rows with checksums', async () => {
    expect(await fixture.appliedMigrations()).toEqual([
      expect.objectContaining({
        version: '1',
        success: true,
        checksum: expect.any(Number)
      }),
      expect.objectContaining({
        version: '2',
        success: true,
        checksum: expect.any(Number)
      })
    ]);
    const pool = new Pool({
      connectionString: fixture.bootstrapLogin.connectionString,
      max: 1
    });
    try {
      const owners = await pool.query<{
        readonly tablename: string;
        readonly tableowner: string;
      }>(
        `select tablename, tableowner
           from pg_tables
          where schemaname = 'public'
          order by tablename`
      );
      expect(new Set(owners.rows.map((row) => row.tableowner))).toEqual(
        new Set(['xht_flyway'])
      );
      expect(owners.rows.map((row) => row.tablename)).toContain(
        'flyway_schema_history'
      );
    } finally {
      await pool.end();
    }
  });

  it('M09 creates the named foreign-key, unique and CHECK constraints', async () => {
    const pool = new Pool({
      connectionString: fixture.bootstrapLogin.connectionString,
      max: 1
    });
    try {
      const result = await pool.query<{
        readonly conname: string;
        readonly definition: string;
      }>(
        `select conname, pg_get_constraintdef(oid) as definition
           from pg_constraint
          where connamespace = 'public'::regnamespace
          order by conname`
      );
      const names = result.rows.map((row) => row.conname);
      const definitions = new Map(
        result.rows.map((row) => [row.conname, row.definition])
      );
      expect(names).toEqual(
        expect.arrayContaining([
          'fk_memberships_uid',
          'fk_identity_profiles_uid',
          'fk_channel_bindings_uid',
          'fk_registration_idempotency_uid',
          'uq_memberships_uid',
          'uq_registration_channel_external',
          'uq_inbox_consumer_external',
          'uq_outbox_topic_event_key',
          'uq_durable_job_business_key'
        ])
      );
      expect(names.filter((name) => name.startsWith('ck_')).length).toBeGreaterThan(8);
      expect(definitions.get('fk_memberships_uid')).toContain(
        'FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT'
      );
      expect(definitions.get('fk_identity_profiles_uid')).toContain(
        'FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT'
      );
      expect(definitions.get('fk_channel_bindings_uid')).toContain(
        'FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT'
      );
      expect(definitions.get('fk_registration_idempotency_uid')).toContain(
        'FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT'
      );
      expect(
        definitions.get('ck_registration_outcome')?.match(/uid IS NULL/gu)
      ).toHaveLength(3);
      expect(definitions.get('ck_inbox_payload_digest')).toContain(
        "payload_digest ~ '^hmac-sha256:[A-Za-z0-9_-]{43}$'"
      );
      expect(definitions.get('ck_inbox_digest_key_version')).toContain(
        "digest_key_version ~ '^v[1-9][0-9]{0,8}$'"
      );

      const indexes = await pool.query<{ readonly indexname: string }>(
        `select indexname
           from pg_indexes
          where schemaname = 'public'
            and indexname = any($1::text[])
          order by indexname`,
        [[
          'uq_channel_bindings_active_external',
          'ix_channel_bindings_uid',
          'ix_registration_uid',
          'ix_inbox_claimable',
          'ix_outbox_claimable',
          'ix_durable_jobs_claimable'
        ]]
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        'ix_channel_bindings_uid',
        'ix_durable_jobs_claimable',
        'ix_inbox_claimable',
        'ix_outbox_claimable',
        'ix_registration_uid',
        'uq_channel_bindings_active_external'
      ]);
    } finally {
      await pool.end();
    }
  });

  it('M10 uses timestamptz for every stage-one time point', async () => {
    const pool = new Pool({
      connectionString: fixture.bootstrapLogin.connectionString,
      max: 1
    });
    try {
      const result = await pool.query<{
        readonly column_name: string;
        readonly data_type: string;
      }>(
        `select column_name, data_type
           from information_schema.columns
          where table_schema = 'public'
            and column_name = any($1::text[])`,
        [[
          'created_at', 'updated_at', 'received_at', 'available_at',
          'claimed_until', 'processed_at', 'succeeded_at', 'occurred_at',
          'failed_at', 'conflicted_at', 'completed_at', 'revoked_at',
          'locked_until'
        ]]
      );
      expect(result.rows.length).toBeGreaterThan(0);
      expect(new Set(result.rows.map((row) => row.data_type))).toEqual(
        new Set(['timestamp with time zone'])
      );
    } finally {
      await pool.end();
    }
  });

  it('M11 stores only the versioned Inbox digest fields', async () => {
    const pool = new Pool({
      connectionString: fixture.bootstrapLogin.connectionString,
      max: 1
    });
    try {
      const result = await pool.query<{ readonly column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'public' and table_name = 'inbox_messages'`
      );
      const columns = result.rows.map((row) => row.column_name);
      expect(columns).toEqual(
        expect.arrayContaining(['payload_digest', 'digest_key_version'])
      );
    } finally {
      await pool.end();
    }
  });

  it('M12 creates no raw Telegram content column', async () => {
    const forbidden = [
      'payload_hash', 'payload', 'body', 'raw_update', 'update_json',
      'message_text', 'callback_data', 'start_parameter', 'payment_password'
    ];
    const pool = new Pool({
      connectionString: fixture.bootstrapLogin.connectionString,
      max: 1
    });
    try {
      const result = await pool.query<{ readonly count: string }>(
        `select count(*)::text as count
         from information_schema.columns
          where table_schema = 'public'
            and table_name = 'inbox_messages'
            and column_name = any($1::text[])`,
        [forbidden]
      );
      expect(result.rows[0]?.count).toBe('0');
    } finally {
      await pool.end();
    }
  });

  it('M13 creates no money, wallet, chain or market column', async () => {
    const forbidden = [
      'asset_id', 'ledger_account_id', 'balance', 'available_balance',
      'frozen_balance', 'wallet_id', 'address', 'network_id', 'chain_id',
      'market', 'market_id', 'amount'
    ];
    const pool = new Pool({
      connectionString: fixture.bootstrapLogin.connectionString,
      max: 1
    });
    try {
      const result = await pool.query<{ readonly count: string }>(
        `select count(*)::text as count
           from information_schema.columns
          where table_schema = 'public' and column_name = any($1::text[])`,
        [forbidden]
      );
      expect(result.rows[0]?.count).toBe('0');
    } finally {
      await pool.end();
    }
  });

  it('M14 migrates from Windows source paths without a bind mount', () => {
    expect(projectRoot).toMatch(/^[A-Za-z]:\\/u);
    expect(migrationEvidence.firstMigrate.exitCode).toBe(0);
  });

  it('M15 returns only zero password-leak evidence with telemetry disabled', () => {
    expect([
      migrationEvidence.firstMigrate.passwordLeakCount,
      migrationEvidence.secondMigrate.passwordLeakCount,
      migrationEvidence.validate.passwordLeakCount
    ]).toEqual([0, 0, 0]);
    expect(fixture.flywayEnvironment.REDGATE_DISABLE_TELEMETRY).toBe('true');
    expect(fixture.flywayEnvironment.FLYWAY_URL).toMatch(
      /\?options=-c%20role%3Dxht_flyway$/u
    );
  });

  describe('M15 raw Flyway log integrity and secret boundaries', () => {
    it('scenario 01 accepts a legal zero-frame Buffer', async () => {
      const outcome = await executeFakeRunner({ source: Buffer.alloc(0) });
      expect(outcome.value).toEqual(
        expect.objectContaining({ exitCode: 0, passwordLeakCount: 0 })
      );
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 02 parses legal interleaved stdout and stderr frames', async () => {
      const outcome = await executeFakeRunner({
        source: Buffer.concat([
          dockerFrame(1, 'out-1'),
          dockerFrame(2, 'err-1'),
          dockerFrame(1, 'out-2'),
          dockerFrame(2, 'err-2')
        ])
      });
      expect(outcome.value?.exitCode).toBe(0);
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 03 parses a legal readable multiplex stream', async () => {
      const source = Readable.from([
        dockerFrame(1, 'out'),
        dockerFrame(2, 'err')
      ]);
      const outcome = await executeFakeRunner({ source });
      expect(outcome.value?.exitCode).toBe(0);
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 04 rejects a complete password on stdout', async () => {
      const outcome = await executeFakeRunner({
        source: dockerFrame(1, 'synthetic-secret')
      });
      observedError(outcome, 'FLYWAY_SECRET_LEAK');
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 05 rejects a complete password on stderr', async () => {
      const outcome = await executeFakeRunner({
        source: dockerFrame(2, 'synthetic-secret')
      });
      observedError(outcome, 'FLYWAY_SECRET_LEAK');
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 06 detects a stdout password split by a stderr frame', async () => {
      const outcome = await executeFakeRunner({
        source: Buffer.concat([
          dockerFrame(1, 'synthetic-'),
          dockerFrame(2, 'interleaved'),
          dockerFrame(1, 'secret')
        ])
      });
      observedError(outcome, 'FLYWAY_SECRET_LEAK');
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 07 detects a stderr password split by a stdout frame', async () => {
      const outcome = await executeFakeRunner({
        source: Buffer.concat([
          dockerFrame(2, 'synthetic-'),
          dockerFrame(1, 'interleaved'),
          dockerFrame(2, 'secret')
        ])
      });
      observedError(outcome, 'FLYWAY_SECRET_LEAK');
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 08 rejects every 1-7 byte incomplete header', async () => {
      for (let byteCount = 1; byteCount <= 7; byteCount += 1) {
        const outcome = await executeFakeRunner({
          source: Buffer.alloc(byteCount)
        });
        observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
        expect(outcome.records.removeCalls).toBe(1);
      }
    });

    it('scenario 09 rejects a truncated declared payload', async () => {
      const header = Buffer.alloc(8);
      header.writeUInt8(1, 0);
      header.writeUInt32BE(2, 4);
      const outcome = await executeFakeRunner({
        source: Buffer.concat([header, Buffer.from('x')])
      });
      observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 10 rejects every 1-7 byte trailing fragment', async () => {
      for (let byteCount = 1; byteCount <= 7; byteCount += 1) {
        const outcome = await executeFakeRunner({
          source: Buffer.concat([
            dockerFrame(1, 'valid'),
            Buffer.alloc(byteCount)
          ])
        });
        observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
        expect(outcome.records.removeCalls).toBe(1);
      }
    });

    it('scenario 11 rejects raw stream types 0, 3 and 255', async () => {
      for (const streamType of [0, 3, 255]) {
        const outcome = await executeFakeRunner({
          source: dockerFrame(streamType, 'invalid')
        });
        observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
        expect(outcome.records.removeCalls).toBe(1);
      }
    });

    it('scenario 12 rejects each non-zero reserved header byte', async () => {
      for (const reserved of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ] as const) {
        const outcome = await executeFakeRunner({
          source: dockerFrame(1, 'invalid', reserved)
        });
        observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
        expect(outcome.records.removeCalls).toBe(1);
      }
    });

    it('scenario 13 covers sync, async, success, abort and late request settlement', async () => {
      const syncThrow = await executeFakeRunner({
        logs: () => {
          throw new Error('synthetic-secret-sync');
        }
      });
      observedError(syncThrow, 'FLYWAY_LOG_READ_FAILED');

      const asyncReject = await executeFakeRunner({
        logs: () => Promise.reject(new Error('synthetic-secret-async'))
      });
      observedError(asyncReject, 'FLYWAY_LOG_READ_FAILED');

      const bufferSuccess = await executeFakeRunner({
        logs: () => Promise.resolve(Buffer.alloc(0))
      });
      expect(bufferSuccess.value?.exitCode).toBe(0);

      const streamSuccess = await executeFakeRunner({
        logs: () => Promise.resolve(Readable.from([dockerFrame(1, 'ok')]))
      });
      expect(streamSuccess.value?.exitCode).toBe(0);

      let abortRespondingSignal: AbortSignal | undefined;
      const abortResponding = await executeFakeRunner({
        useFakeTimers: true,
        logs: (requestOptions) =>
          new Promise((_resolve, reject) => {
            abortRespondingSignal = requestOptions.abortSignal;
            requestOptions.abortSignal?.addEventListener(
              'abort',
              () => reject(new Error('synthetic-secret-abort')),
              { once: true }
            );
          })
      });
      observedError(abortResponding, 'FLYWAY_LOG_READ_FAILED');
      expect(abortRespondingSignal?.aborted).toBe(true);
      expect(abortResponding.records.timerCount).toBe(0);

      let ignoredAbortSignal: AbortSignal | undefined;
      const ignoredAbort = await executeFakeRunner({
        useFakeTimers: true,
        logs: (requestOptions) => {
          ignoredAbortSignal = requestOptions.abortSignal;
          return new Promise(() => undefined);
        }
      });
      observedError(ignoredAbort, 'FLYWAY_LOG_READ_FAILED');
      expect(ignoredAbortSignal?.aborted).toBe(true);
      expect(ignoredAbort.records.timerCount).toBe(0);

      const lateResolve = await executeFakeRunner({
        useFakeTimers: true,
        logs: () =>
          new Promise((resolvePromise) => {
            setTimeout(() => resolvePromise(Buffer.alloc(0)), 5_500);
          })
      });
      observedError(lateResolve, 'FLYWAY_LOG_READ_FAILED');
      expect(lateResolve.records.timerCount).toBe(0);

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);
      try {
        const lateReject = await executeFakeRunner({
          useFakeTimers: true,
          logs: () =>
            new Promise((_resolve, reject) => {
              setTimeout(
                () => reject(new Error('synthetic-secret-late')),
                5_500
              );
            })
        });
        observedError(lateReject, 'FLYWAY_LOG_READ_FAILED');
        expect(lateReject.records.timerCount).toBe(0);
      } finally {
        process.removeListener('unhandledRejection', onUnhandled);
      }
      expect(unhandled).toEqual([]);

      for (const outcome of [
        syncThrow,
        asyncReject,
        bufferSuccess,
        streamSuccess,
        abortResponding,
        ignoredAbort,
        lateResolve
      ]) {
        expect(outcome.records.removeCalls).toBe(1);
      }
    });

    it('scenario 14 rejects and tears down a stream error', async () => {
      let stream!: PassThrough;
      const outcome = await executeFakeRunner({
        logs: () => {
          stream = new PassThrough();
          setImmediate(() => {
            stream.write(dockerFrame(1, 'partial'));
            stream.emit('error', new Error('synthetic-secret-stream'));
          });
          return stream;
        }
      });
      observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
      expect(stream.destroyed).toBe(true);
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 15 rejects close without end or error', async () => {
      const outcome = await executeFakeRunner({
        logs: () => {
          const stream = new PassThrough();
          setImmediate(() => stream.emit('close'));
          return stream;
        }
      });
      observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 16 bounds a stream that never settles', async () => {
      const stream = new PassThrough();
      const outcome = await executeFakeRunner({
        source: stream,
        useFakeTimers: true
      });
      observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
      expect(stream.destroyed).toBe(true);
      expect(outcome.records.timerCount).toBe(0);
      expect(outcome.records.removeCalls).toBe(1);
    });

    it('scenario 17 enforces the exact raw-wire byte boundary', async () => {
      const frames = Array.from(
        { length: 4_096 },
        () => dockerFrame(1, Buffer.alloc(256))
      );
      const exact = Buffer.concat(frames);
      expect(exact.byteLength).toBe(1_081_344);
      const accepted = await executeFakeRunner({ source: exact });
      expect(accepted.value?.exitCode).toBe(0);
      expect(accepted.records.removeCalls).toBe(1);

      const rejected = await executeFakeRunner({
        source: Buffer.concat([exact, Buffer.alloc(1)])
      });
      observedError(rejected, 'FLYWAY_LOG_READ_FAILED');
      expect(rejected.records.removeCalls).toBe(1);
    });

    it('scenario 18 enforces the exact decoded-payload byte boundary', async () => {
      const exact = await executeFakeRunner({
        source: dockerFrame(1, Buffer.alloc(1_048_576))
      });
      expect(exact.value?.exitCode).toBe(0);
      expect(exact.records.removeCalls).toBe(1);

      const rejected = await executeFakeRunner({
        source: dockerFrame(1, Buffer.alloc(1_048_577))
      });
      observedError(rejected, 'FLYWAY_LOG_READ_FAILED');
      expect(rejected.records.removeCalls).toBe(1);
    });

    it('scenario 19 enforces the exact frame-count boundary including zero frames', async () => {
      const exactFrames = Buffer.concat(
        Array.from({ length: 4_096 }, () => dockerFrame(1, Buffer.alloc(0)))
      );
      const exact = await executeFakeRunner({ source: exactFrames });
      expect(exact.value?.exitCode).toBe(0);
      expect(exact.records.removeCalls).toBe(1);

      const rejected = await executeFakeRunner({
        source: Buffer.concat([exactFrames, dockerFrame(1, Buffer.alloc(0))])
      });
      observedError(rejected, 'FLYWAY_LOG_READ_FAILED');
      expect(rejected.records.removeCalls).toBe(1);
    });

    it('scenario 20 sanitizes a synchronous parser exception', async () => {
      const outcome = await executeFakeRunner({
        source: dockerFrame(255, 'synthetic-secret')
      });
      observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
      expect(JSON.stringify(outcome.error)).not.toContain('synthetic-secret');
      expect(outcome.records.removeCalls).toBe(1);
    });
  });

  it('M16 leaves no Task 3 Flyway owner container after success or failure', async () => {
    const runtime = await getContainerRuntimeClient();
    await vi.waitFor(async () => {
      const listed = await runtime.container.dockerode.listContainers({
        all: true,
        filters: { label: ['com.xht.task3.flyway-owner'] }
      });
      expect(listed).toEqual([]);
    }, {
      timeout: 5_000,
      interval: 50
    });
  });

  describe('M16 unique-owner cleanup and sanitized failure evidence', () => {
    it('scenario 21 removes every started owner after representative log failures', async () => {
      const failures = [
        Buffer.alloc(1),
        Buffer.concat([dockerFrame(1, 'ok'), Buffer.alloc(1)]),
        dockerFrame(0, 'bad'),
        dockerFrame(1, 'bad', [1, 0, 0]),
        dockerFrame(1, Buffer.alloc(1_048_577))
      ];
      for (const source of failures) {
        const outcome = await executeFakeRunner({ source });
        observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
        expect(outcome.records.removeCalls).toBe(1);
        expect(outcome.records.removedIds).toEqual([
          'fake-flyway-container'
        ]);
      }

      const requestTimeout = await executeFakeRunner({
        useFakeTimers: true,
        logs: () => new Promise(() => undefined)
      });
      observedError(requestTimeout, 'FLYWAY_LOG_READ_FAILED');
      expect(requestTimeout.records.removeCalls).toBe(1);
    });

    it('scenario 22 preserves a log failure when owner removal also fails', async () => {
      const malformed = await executeFakeRunner({
        source: Buffer.alloc(1),
        removeFails: true
      });
      observedError(malformed, 'FLYWAY_LOG_READ_FAILED');
      expect(malformed.error?.cleanupEvidence).toEqual([
        'FLYWAY_CLEANUP_REMOVE_FAILED'
      ]);

      const requestTimeout = await executeFakeRunner({
        useFakeTimers: true,
        logs: () => new Promise(() => undefined),
        removeFails: true
      });
      observedError(requestTimeout, 'FLYWAY_LOG_READ_FAILED');
      expect(requestTimeout.error?.cleanupEvidence).toEqual([
        'FLYWAY_CLEANUP_REMOVE_FAILED'
      ]);
    });

    it('scenario 23 has no duplicate, omitted or cross-owner cleanup', async () => {
      const owned = await executeFakeRunner({ source: Buffer.alloc(0) });
      expect(owned.value?.exitCode).toBe(0);
      expect(owned.records.removeCalls).toBe(1);
      expect(owned.records.stopCalls).toBe(0);

      const foreign = await executeFakeRunner({
        source: Buffer.alloc(0),
        ownerMismatch: true
      });
      observedError(foreign, 'FLYWAY_CLEANUP_FAILED');
      expect(foreign.error?.cleanupEvidence).toEqual([
        'FLYWAY_CLEANUP_OWNER_MISMATCH'
      ]);
      expect(foreign.records.removeCalls).toBe(0);
    });

    it('scenario 24 exposes no synthetic secret on any public failure surface', async () => {
      const outcome = await executeFakeRunner({
        logs: () => {
          throw new Error('synthetic-secret-log');
        },
        removeFails: true
      });
      observedError(outcome, 'FLYWAY_LOG_READ_FAILED');
      expect(outcome.error?.cleanupEvidence).toEqual([
        'FLYWAY_CLEANUP_REMOVE_FAILED'
      ]);
      const publicSurface = [
        outcome.error?.code,
        outcome.error?.cleanupEvidence,
        (outcome.error as unknown as Error | undefined)?.message,
        (outcome.error as unknown as Error | undefined)?.cause,
        (outcome.error as unknown as Error | undefined)?.stack,
        JSON.stringify(outcome.error)
      ].join('\n');
      expect(publicSurface).not.toContain('synthetic-secret');
    });
  });

  it('M17 starts and stops a second fresh fixture without fixed-name conflicts', async () => {
    const second = await startPostgresFixture({
      projectRoot,
      startupTimeoutMillis: 120_000,
      stopTimeoutMillis: 10_000
    });
    try {
      expect(second.bootstrapLogin.connectionString).not.toBe(
        fixture.bootstrapLogin.connectionString
      );
    } finally {
      await second.stop();
    }
  }, 180_000);
});
