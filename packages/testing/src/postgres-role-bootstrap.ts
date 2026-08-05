import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';

const DATABASE_NAME = 'xht_test' as const;
const LOGIN_BINDINGS = Object.freeze([
  {
    username: 'xht_flyway_test_login',
    role: 'xht_flyway'
  },
  {
    username: 'xht_platform_test_login',
    role: 'xht_platform'
  },
  {
    username: 'xht_worker_test_login',
    role: 'xht_worker'
  }
] as const);
const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;

export interface EphemeralLogin {
  readonly username: string;
  readonly password: string;
  readonly connectionString: string;
}

export interface PostgresRoleBootstrapOptions {
  readonly bootstrapConnectionString: string;
  readonly databaseName: 'xht_test';
}

export interface PostgresRoleBootstrap {
  readonly flywayLogin: EphemeralLogin;
  readonly platformLogin: EphemeralLogin;
  readonly workerLogin: EphemeralLogin;
  readonly close: () => Promise<void>;
}

export class PostgresRoleBootstrapError extends Error {
  readonly code:
    | 'ROLE_BOOTSTRAP_FAILED'
    | 'ROLE_MEMBERSHIP_MISMATCH'
    | 'ROLE_BOOTSTRAP_CLOSED';

  constructor(code: PostgresRoleBootstrapError['code']) {
    super(code);
    this.name = 'PostgresRoleBootstrapError';
    this.code = code;
  }
}

interface RoleEvidenceRow extends QueryResultRow {
  readonly member_name: string;
  readonly role_name: string;
  readonly rolcanlogin: boolean;
  readonly rolsuper: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolinherit: boolean;
  readonly rolreplication: boolean;
  readonly rolbypassrls: boolean;
  readonly admin_option: boolean;
  readonly inherit_option: boolean;
  readonly set_option: boolean;
}

interface InternalPostgresRoleBootstrap extends PostgresRoleBootstrap {
  readonly query: <R extends QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ) => Promise<QueryResult<R>>;
}

function quoteIdentifier(value: string): string {
  if (!POSTGRES_IDENTIFIER.test(value)) {
    throw new PostgresRoleBootstrapError('ROLE_BOOTSTRAP_FAILED');
  }
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function connectionStringFor(
  bootstrapConnectionString: string,
  username: string,
  password: string,
  databaseName: string
): string {
  const connectionUrl = new URL(bootstrapConnectionString);
  connectionUrl.username = username;
  connectionUrl.password = password;
  connectionUrl.pathname = `/${databaseName}`;
  return connectionUrl.toString();
}

function createLogin(
  bootstrapConnectionString: string,
  databaseName: string,
  username: string
): EphemeralLogin {
  const password = randomBytes(32).toString('base64url');
  return {
    username,
    password,
    connectionString: connectionStringFor(
      bootstrapConnectionString,
      username,
      password,
      databaseName
    )
  };
}

function membershipMatches(
  evidence: readonly RoleEvidenceRow[]
): boolean {
  return (
    evidence.length === LOGIN_BINDINGS.length &&
    LOGIN_BINDINGS.every((binding) => {
      const row = evidence.find(
        (candidate) => candidate.member_name === binding.username
      );
      return (
        row?.role_name === binding.role &&
        row.rolcanlogin &&
        !row.rolsuper &&
        !row.rolcreatedb &&
        !row.rolcreaterole &&
        !row.rolinherit &&
        !row.rolreplication &&
        !row.rolbypassrls &&
        !row.admin_option &&
        !row.inherit_option &&
        row.set_option
      );
    })
  );
}

export async function bootstrapTestRoles(
  options: PostgresRoleBootstrapOptions
): Promise<PostgresRoleBootstrap> {
  if (
    options.databaseName !== DATABASE_NAME ||
    options.bootstrapConnectionString.length === 0
  ) {
    throw new PostgresRoleBootstrapError('ROLE_BOOTSTRAP_FAILED');
  }

  const pool = new Pool({
    connectionString: options.bootstrapConnectionString,
    max: 1,
    allowExitOnIdle: false
  });
  let closed = false;
  let closePromise: Promise<void> | undefined;

  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    closePromise = Promise.resolve()
      .then(() => pool.end())
      .catch(() => {
        throw new PostgresRoleBootstrapError('ROLE_BOOTSTRAP_FAILED');
      });
    return closePromise;
  }

  function query<R extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<R>> {
    if (closed) {
      return Promise.reject(
        new PostgresRoleBootstrapError('ROLE_BOOTSTRAP_CLOSED')
      );
    }
    return pool.query<R>(text, [...values]);
  }

  try {
    const projectRoot = resolve(import.meta.dirname, '../../..');
    const [rolesSql, databaseSql] = await Promise.all([
      readFile(resolve(projectRoot, 'database/bootstrap/roles.sql'), 'utf8'),
      readFile(resolve(projectRoot, 'database/bootstrap/database.sql'), 'utf8')
    ]);
    await query(rolesSql);
    await query(databaseSql);

    const [flywayLogin, platformLogin, workerLogin] = LOGIN_BINDINGS.map(
      (binding) =>
        createLogin(
          options.bootstrapConnectionString,
          options.databaseName,
          binding.username
        )
    ) as [EphemeralLogin, EphemeralLogin, EphemeralLogin];
    const logins = [flywayLogin, platformLogin, workerLogin] as const;

    for (const [index, binding] of LOGIN_BINDINGS.entries()) {
      const login = logins[index];
      if (login === undefined) {
        throw new PostgresRoleBootstrapError('ROLE_BOOTSTRAP_FAILED');
      }
      await query(
        `CREATE ROLE ${quoteIdentifier(binding.username)}
           LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOINHERIT NOREPLICATION NOBYPASSRLS
           PASSWORD ${quoteLiteral(login.password)}`
      );
      await query(
        `GRANT ${quoteIdentifier(binding.role)}
             TO ${quoteIdentifier(binding.username)}
           WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
      );
      await query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(options.databaseName)}
             TO ${quoteIdentifier(binding.username)}`
      );
    }

    const evidence = await query<RoleEvidenceRow>(
      `SELECT member.rolname AS member_name,
              target.rolname AS role_name,
              member.rolcanlogin,
              member.rolsuper,
              member.rolcreatedb,
              member.rolcreaterole,
              member.rolinherit,
              member.rolreplication,
              member.rolbypassrls,
              membership.admin_option,
              membership.inherit_option,
              membership.set_option
         FROM pg_auth_members membership
         JOIN pg_roles member ON member.oid = membership.member
         JOIN pg_roles target ON target.oid = membership.roleid
        WHERE member.rolname = ANY($1::text[])
        ORDER BY member.rolname`,
      [LOGIN_BINDINGS.map((binding) => binding.username)]
    );
    if (!membershipMatches(evidence.rows)) {
      throw new PostgresRoleBootstrapError('ROLE_MEMBERSHIP_MISMATCH');
    }

    const result: InternalPostgresRoleBootstrap = {
      flywayLogin,
      platformLogin,
      workerLogin,
      close,
      query
    };
    return result;
  } catch (error: unknown) {
    try {
      await close();
    } catch {
      // Cleanup must not expose a lower-level connection or SQL error.
    }
    if (error instanceof PostgresRoleBootstrapError) throw error;
    throw new PostgresRoleBootstrapError('ROLE_BOOTSTRAP_FAILED');
  }
}
