import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { StageOneDatabase } from '@xht/contracts';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import { Kysely, PostgresDialect } from 'kysely';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';
import { RoleEnforcingPostgresPool } from '../../src/infrastructure/database/database.js';
import {
  createUnitOfWork,
  type UnitOfWork
} from '../../src/infrastructure/database/unit-of-work.js';
import {
  totpCode
} from '../../src/modules/security/domain/totp.js';
import { base32Encode } from '../../src/modules/security/domain/totp.js';
import {
  FakeTotpSecretStore
} from '../../src/modules/admin/domain/fake-totp-secret.store.js';
import {
  PostgresAdminSessionRepository
} from '../../src/modules/admin/infrastructure/postgres-admin-session.repository.js';
import {
  AdminAuthService
} from '../../src/modules/admin/application/admin-auth.service.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const BOOTSTRAP_USERNAME = 'bootstrap-admin';
const BOOTSTRAP_PASSWORD = 'Bootstrap-Admin-2026!';
const BOOTSTRAP_TOTP_REF = 'vault:bootstrap-totp-v1';
const BOOTSTRAP_TOTP_SECRET = base32Encode(
  Buffer.from('0123456789abcdef0123', 'utf8')
);

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const sessions = new PostgresAdminSessionRepository();
let secrets: FakeTotpSecretStore;
let authService: AdminAuthService;

function currentTotp(): string {
  return totpCode(Buffer.from('0123456789abcdef0123', 'utf8'), Date.now());
}

async function login(
  overrides: Partial<{
    username: string;
    password: string;
    totpCode: string;
  }> = {}
): Promise<ReturnType<AdminAuthService['login']>> {
  return authService.login({
    username: overrides.username ?? BOOTSTRAP_USERNAME,
    password: overrides.password ?? BOOTSTRAP_PASSWORD,
    totpCode: overrides.totpCode ?? currentTotp()
  });
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot, startupTimeoutMillis: 120_000, stopTimeoutMillis: 10_000
  });
  const evidence = await migrateAndValidate(fixture, {
    projectRoot, configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  expect(evidence.firstMigrate.appliedVersions).toEqual(
    expect.arrayContaining([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
      '13', '14'
    ])
  );
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1, application_name: 'xht-s91-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4, application_name: 'xht-s91-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never, fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
}, 180_000);

beforeEach(async () => {
  await cleanupPool.query(
    `UPDATE admin_credentials
        SET failed_attempts = 0, locked_until = NULL`
  );
  await cleanupPool.query(`DELETE FROM admin_sessions`);
  secrets = new FakeTotpSecretStore();
  secrets.setSecret(BOOTSTRAP_TOTP_REF, BOOTSTRAP_TOTP_SECRET);
  authService = new AdminAuthService(unitOfWork, sessions, secrets);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S9-1 admin authentication', () => {
  it('S9AM01: bootstrap login returns the raw token exactly once', async () => {
    const result = await login();
    expect(result.outcome).toBe('AUTHENTICATED');
    const authenticated = result as { token: string; expiresAt: string };
    expect(authenticated.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Date.parse(authenticated.expiresAt)).toBeGreaterThan(Date.now());
    const stored = await cleanupPool.query<{
      token_hash: string;
      n: number;
    }>(
      `SELECT (SELECT token_hash FROM admin_sessions LIMIT 1) AS token_hash,
              (SELECT count(*)::int FROM admin_sessions) AS n`
    );
    expect(stored.rows[0]?.n).toBe(1);
    expect(stored.rows[0]?.token_hash).not.toBe(authenticated.token);
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/u);
    const check = await authService.requireSession(
      authenticated.token, 'BASIC'
    );
    expect(check.outcome).toBe('VALID');
  });

  it('S9AM02: five failures lock the account for fifteen minutes', async () => {
    for (let i = 0; i < 5; i += 1) {
      const failed = await login({ password: 'wrong-password' });
      expect(failed.outcome).toBe('DENIED');
    }
    const locked = await login();
    expect(locked).toEqual({
      outcome: 'DENIED', reasonCode: 'ADMIN_AUTH_LOCKED'
    });
    const row = await cleanupPool.query<{ locked_until: Date | null }>(
      `SELECT locked_until FROM admin_credentials
        WHERE username = $1`,
      [BOOTSTRAP_USERNAME]
    );
    expect(row.rows[0]?.locked_until).not.toBeNull();
    expect(
      (row.rows[0]!.locked_until as Date).getTime()
    ).toBeGreaterThan(Date.now());
  });

  it('S9AM03: a wrong TOTP code is denied and counted', async () => {
    const denied = await login({ totpCode: '000000' });
    expect(denied).toEqual({
      outcome: 'DENIED', reasonCode: 'ADMIN_AUTH_MFA_REQUIRED'
    });
    const row = await cleanupPool.query<{ failed_attempts: number }>(
      `SELECT failed_attempts FROM admin_credentials
        WHERE username = $1`,
      [BOOTSTRAP_USERNAME]
    );
    expect(row.rows[0]?.failed_attempts).toBe(1);
  });

  it('S9AM04: session validation covers expiry and elevation windows', async () => {
    const result = (await login()) as { token: string };
    const elevated = await authService.requireSession(
      result.token, 'ELEVATED'
    );
    expect(elevated).toEqual({
      outcome: 'DENIED', reasonCode: 'ADMIN_ELEVATION_REQUIRED'
    });
    const raised = await authService.elevate({
      sessionToken: result.token,
      password: BOOTSTRAP_PASSWORD,
      totpCode: currentTotp()
    });
    expect(raised.outcome).toBe('VALID');
    await cleanupPool.query(
      `UPDATE admin_sessions SET elevated_until = clock_timestamp()
              - interval '1 second'`
    );
    const expiredWindow = await authService.requireSession(
      result.token, 'ELEVATED'
    );
    expect(expiredWindow).toEqual({
      outcome: 'DENIED', reasonCode: 'ADMIN_ELEVATION_REQUIRED'
    });
    await cleanupPool.query(
      `UPDATE admin_sessions
          SET created_at = clock_timestamp() - interval '2 hours',
              expires_at = clock_timestamp() - interval '1 second'`
    );
    const expired = await authService.requireSession(
      result.token, 'BASIC'
    );
    expect(expired).toEqual({
      outcome: 'DENIED', reasonCode: 'ADMIN_SESSION_EXPIRED'
    });
    const unknown = await authService.requireSession('no-such-token', 'BASIC');
    expect(unknown).toEqual({
      outcome: 'DENIED', reasonCode: 'ADMIN_SESSION_INVALID'
    });
  });

  it('S9AM05: logout revokes the session permanently', async () => {
    const result = (await login()) as { token: string };
    await authService.logout(result.token);
    const denied = await authService.requireSession(result.token, 'BASIC');
    expect(denied).toEqual({
      outcome: 'DENIED', reasonCode: 'ADMIN_SESSION_INVALID'
    });
  });

  it('S9AM06: the worker role has zero access to both tables', async () => {
    const workerClient = await new Pool({
      connectionString: fixture.workerLogin.connectionString, max: 1
    }).connect();
    try {
      await workerClient.query('SET ROLE xht_worker');
      await expect(
        workerClient.query(`SELECT count(*) FROM admin_credentials`)
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        workerClient.query(`SELECT count(*) FROM admin_sessions`)
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        workerClient.query(
          `INSERT INTO admin_sessions (admin_id, token_hash, expires_at)
           VALUES ('11111111-1111-4111-8111-111111111111', 'x', now())`
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      workerClient.release();
    }
    await expect(
      unitOfWork.execute(async (context) => {
        await context.executeSql(
          `INSERT INTO admin_credentials
             (admin_id, username, password_hash, totp_secret_ref)
           VALUES (gen_random_uuid(), 'rogue', 'h', 'vault:x')`
        );
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_CALLBACK_FAILED' });
  });

  it('S9AM07: no plaintext secrets live in either table', async () => {
    await login();
    const leaks = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_credentials
        WHERE password_hash ILIKE '%Bootstrap-Admin%'
           OR totp_secret_ref !~ '^vault:'`
    );
    expect(leaks.rows[0]?.n).toBe(0);
    const totpLeak = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_credentials c
        WHERE c.totp_secret_ref LIKE '%0123456789%'`
    );
    expect(totpLeak.rows[0]?.n).toBe(0);
  });
});
