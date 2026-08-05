import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { QueryResult, QueryResultRow } from 'pg';
import {
  Network,
  type StartedNetwork,
  type StartedTestContainer
} from 'testcontainers';
import { readLockedImage } from './locked-images.js';
import {
  bootstrapTestRoles,
  type EphemeralLogin,
  type PostgresRoleBootstrap
} from './postgres-role-bootstrap.js';

export interface FlywayEnvironment {
  readonly FLYWAY_URL: string;
  readonly FLYWAY_USER: string;
  readonly FLYWAY_PASSWORD: string;
  readonly REDGATE_DISABLE_TELEMETRY: 'true';
}

export interface PostgresFixture {
  readonly databaseName: 'xht_test';
  readonly hostAlias: 'postgres';
  /**
   * Borrowed by runFlywayCommand only for withNetwork(); callers must not stop it.
   */
  readonly network: StartedNetwork;
  readonly bootstrapLogin: EphemeralLogin;
  readonly flywayLogin: EphemeralLogin;
  readonly platformLogin: EphemeralLogin;
  readonly workerLogin: EphemeralLogin;
  readonly flywayEnvironment: FlywayEnvironment;
  readonly tableNames: () => Promise<readonly string[]>;
  readonly appliedMigrations: () => Promise<readonly AppliedMigration[]>;
  readonly stop: () => Promise<void>;
}

export interface AppliedMigration {
  readonly installedRank: number;
  readonly version: string;
  readonly description: string;
  readonly checksum: number;
  readonly success: boolean;
}

export interface PostgresFixtureOptions {
  readonly projectRoot: string;
  readonly startupTimeoutMillis: 120000;
  readonly stopTimeoutMillis: 10000;
}

export class PostgresFixtureError extends Error {
  readonly code:
    | 'POSTGRES_START_FAILED'
    | 'POSTGRES_NOT_READY'
    | 'POSTGRES_FIXTURE_CLOSED'
    | 'POSTGRES_CLEANUP_FAILED';

  constructor(code: PostgresFixtureError['code']) {
    super(code);
    this.name = 'PostgresFixtureError';
    this.code = code;
  }
}

interface BootstrapQuery {
  readonly query: <R extends QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ) => Promise<QueryResult<R>>;
}

interface TableNameRow extends QueryResultRow {
  readonly table_name: string;
}

interface AppliedMigrationRow extends QueryResultRow {
  readonly installed_rank: number;
  readonly version: string;
  readonly description: string;
  readonly checksum: number;
  readonly success: boolean;
}

function createBootstrapLogin(
  connectionString: string,
  username: string,
  password: string
): EphemeralLogin {
  return { username, password, connectionString };
}

function assertOptions(options: PostgresFixtureOptions): void {
  if (
    options.projectRoot.length === 0 ||
    options.startupTimeoutMillis !== 120_000 ||
    options.stopTimeoutMillis !== 10_000
  ) {
    throw new PostgresFixtureError('POSTGRES_START_FAILED');
  }
}

export async function startPostgresFixture(
  options: PostgresFixtureOptions
): Promise<PostgresFixture> {
  assertOptions(options);
  const locked = readLockedImage(
    'postgres',
    resolve(options.projectRoot, 'toolchain-lock.json')
  );
  const databaseName = 'xht_test' as const;
  const hostAlias = 'postgres' as const;
  const bootstrapUsername = 'xht_bootstrap_test_login';
  const bootstrapPassword = randomBytes(32).toString('base64url');
  let network: StartedNetwork | undefined;
  let startedPostgres: StartedTestContainer | undefined;
  let roleBootstrap: PostgresRoleBootstrap | undefined;

  try {
    network = await new Network().start();
    const postgresContainer = new PostgreSqlContainer(
      locked.immutableReference
    )
      .withPlatform(locked.platform)
      .withNetwork(network)
      .withNetworkAliases(hostAlias)
      .withDatabase(databaseName)
      .withUsername(bootstrapUsername)
      .withPassword(bootstrapPassword)
      .withStartupTimeout(options.startupTimeoutMillis);
    startedPostgres = await postgresContainer.start();

    const started = startedPostgres as StartedTestContainer & {
      readonly getConnectionUri: () => string;
    };
    const bootstrapLogin = createBootstrapLogin(
      started.getConnectionUri(),
      bootstrapUsername,
      bootstrapPassword
    );
    roleBootstrap = await bootstrapTestRoles({
      bootstrapConnectionString: bootstrapLogin.connectionString,
      databaseName
    });
    const bootstrapQuery = roleBootstrap as PostgresRoleBootstrap &
      BootstrapQuery;
    let closed = false;
    let stopPromise: Promise<void> | undefined;

    async function tableNames(): Promise<readonly string[]> {
      if (closed) {
        throw new PostgresFixtureError('POSTGRES_FIXTURE_CLOSED');
      }
      try {
        const result = await bootstrapQuery.query<TableNameRow>(
          `SELECT table_name
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
              AND table_name <> 'flyway_schema_history'
            ORDER BY table_name`
        );
        return result.rows.map((row) => row.table_name);
      } catch {
        throw new PostgresFixtureError('POSTGRES_NOT_READY');
      }
    }

    async function appliedMigrations(): Promise<readonly AppliedMigration[]> {
      if (closed) {
        throw new PostgresFixtureError('POSTGRES_FIXTURE_CLOSED');
      }
      try {
        const result = await bootstrapQuery.query<AppliedMigrationRow>(
          `SELECT installed_rank, version, description, checksum, success
             FROM flyway_schema_history
            WHERE version IS NOT NULL
            ORDER BY installed_rank`
        );
        return result.rows.map((row) => ({
          installedRank: row.installed_rank,
          version: row.version,
          description: row.description,
          checksum: row.checksum,
          success: row.success
        }));
      } catch {
        throw new PostgresFixtureError('POSTGRES_NOT_READY');
      }
    }

    function stop(): Promise<void> {
      if (stopPromise !== undefined) return stopPromise;
      closed = true;
      stopPromise = (async () => {
        let failed = false;
        try {
          await roleBootstrap?.close();
        } catch {
          failed = true;
        }
        try {
          await startedPostgres?.stop({
            timeout: options.stopTimeoutMillis
          });
        } catch {
          failed = true;
        }
        try {
          await network?.stop();
        } catch {
          failed = true;
        }
        if (failed) {
          throw new PostgresFixtureError('POSTGRES_CLEANUP_FAILED');
        }
      })();
      return stopPromise;
    }

    return {
      databaseName,
      hostAlias,
      network,
      bootstrapLogin,
      flywayLogin: roleBootstrap.flywayLogin,
      platformLogin: roleBootstrap.platformLogin,
      workerLogin: roleBootstrap.workerLogin,
      flywayEnvironment: {
        FLYWAY_URL:
          `jdbc:postgresql://${hostAlias}:5432/${databaseName}` +
          '?options=-c%20role%3Dxht_flyway',
        FLYWAY_USER: roleBootstrap.flywayLogin.username,
        FLYWAY_PASSWORD: roleBootstrap.flywayLogin.password,
        REDGATE_DISABLE_TELEMETRY: 'true'
      },
      tableNames,
      appliedMigrations,
      stop
    };
  } catch {
    let cleanupFailed = false;
    try {
      await roleBootstrap?.close();
    } catch {
      cleanupFailed = true;
    }
    try {
      await startedPostgres?.stop({ timeout: options.stopTimeoutMillis });
    } catch {
      cleanupFailed = true;
    }
    try {
      await network?.stop();
    } catch {
      cleanupFailed = true;
    }
    throw new PostgresFixtureError(
      cleanupFailed ? 'POSTGRES_CLEANUP_FAILED' : 'POSTGRES_START_FAILED'
    );
  }
}
