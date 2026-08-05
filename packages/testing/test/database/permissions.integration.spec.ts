import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';
import {
  createPlatformDatabase,
  type RoleBoundDatabase as PlatformDatabase
} from '../../../../apps/platform/src/infrastructure/database/database.js';
import {
  createWorkerDatabase,
  type RoleBoundDatabase as WorkerDatabase
} from '../../../../apps/worker/src/infrastructure/database/database.js';
import {
  LockedImageError,
  migrateAndValidate,
  readLockedImage,
  startPostgresFixture,
  type PostgresFixture
} from '../../src/index.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
let fixture: PostgresFixture;
let platform: PlatformDatabase;
let worker: WorkerDatabase;
const cleanupOrder: string[] = [];

async function expectPermissionDenied(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toEqual(
    expect.objectContaining({ code: '42501' })
  );
}

async function expectRelationUnavailable(
  promise: Promise<unknown>
): Promise<void> {
  await expect(promise).rejects.toEqual(
    expect.objectContaining({ code: '42P01' })
  );
}

async function withLogin<T>(
  connectionString: string,
  operation: (pool: Pool) => Promise<T>
): Promise<T> {
  const pool = new Pool({ connectionString, max: 2 });
  try {
    return await operation(pool);
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  fixture = await startPostgresFixture({
    projectRoot,
    startupTimeoutMillis: 120_000,
    stopTimeoutMillis: 10_000
  });
  await migrateAndValidate(fixture, {
    projectRoot,
    configFile: 'database/flyway.toml',
    migrationsDirectory: 'database/migrations',
    callbacksDirectory: 'database/flyway-callbacks'
  });
  platform = createPlatformDatabase({
    connectionString: fixture.platformLogin.connectionString,
    expectedSessionUser: fixture.platformLogin.username,
    maxConnections: 4,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    applicationName: 'xht-platform-permissions'
  });
  worker = createWorkerDatabase({
    connectionString: fixture.workerLogin.connectionString,
    expectedSessionUser: fixture.workerLogin.username,
    maxConnections: 4,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    applicationName: 'xht-worker-permissions'
  });
}, 180_000);

afterAll(async () => {
  if (worker !== undefined) {
    await worker.close();
    cleanupOrder.push('worker');
  }
  if (platform !== undefined) {
    await platform.close();
    cleanupOrder.push('platform');
  }
  if (fixture !== undefined) {
    await fixture.stop();
    cleanupOrder.push('fixture');
  }
  expect(cleanupOrder).toEqual(['worker', 'platform', 'fixture']);
}, 180_000);

describe('stage one database permissions', () => {
  it('rejects an unverified image before creating a container', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'xht-task3-image-'));
    const invalidLock = resolve(directory, 'toolchain-lock.json');
    try {
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
                'sha256:2342268e5cf8851c327dcf10fc124283448428059f9b756692b7e3302940d769',
              status: 'UNVERIFIED'
            }
          }
        }),
        'utf8'
      );

      expect(() => readLockedImage('postgres', invalidLock)).toThrowError(
        expect.objectContaining<Partial<LockedImageError>>({
          code: 'IMAGE_NOT_VERIFIED'
        })
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('P01 bootstrap creates the isolated roles and logins', async () => {
    const roles = await withLogin(
      fixture.bootstrapLogin.connectionString,
      async (pool) =>
        pool.query<{ readonly rolname: string }>(
          `select rolname from pg_roles
            where rolname = any($1::text[])
            order by rolname`,
          [[
            'xht_flyway', 'xht_platform', 'xht_worker',
            fixture.flywayLogin.username,
            fixture.platformLogin.username,
            fixture.workerLogin.username
          ]]
        )
    );
    expect(roles.rows).toHaveLength(6);
  });

  it('P02 test logins have only LOGIN and no elevated role attributes', async () => {
    const result = await withLogin(
      fixture.bootstrapLogin.connectionString,
      async (pool) =>
        pool.query<{
          readonly rolcanlogin: boolean;
          readonly rolsuper: boolean;
          readonly rolcreatedb: boolean;
          readonly rolcreaterole: boolean;
        }>(
          `select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
             from pg_roles
            where rolname = any($1::text[])
            order by rolname`,
          [[
            fixture.flywayLogin.username,
            fixture.platformLogin.username,
            fixture.workerLogin.username
          ]]
        )
    );
    expect(result.rows).toEqual([
      { rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false },
      { rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false },
      { rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false }
    ]);
  });

  it('P03 application permission roles are NOLOGIN', async () => {
    const result = await withLogin(
      fixture.bootstrapLogin.connectionString,
      async (pool) =>
        pool.query<{ readonly rolcanlogin: boolean }>(
          `select rolcanlogin from pg_roles
            where rolname = any($1::text[])
            order by rolname`,
          [['xht_flyway', 'xht_platform', 'xht_worker']]
        )
    );
    expect(result.rows).toEqual([
      { rolcanlogin: false },
      { rolcanlogin: false },
      { rolcanlogin: false }
    ]);
  });

  it('P04 each test LOGIN has one SET-only non-inherited membership', async () => {
    const result = await withLogin(
      fixture.bootstrapLogin.connectionString,
      async (pool) =>
        pool.query<{
          readonly member_name: string;
          readonly role_name: string;
          readonly admin_option: boolean;
          readonly inherit_option: boolean;
          readonly set_option: boolean;
        }>(
          `select member.rolname as member_name,
                  target.rolname as role_name,
                  membership.admin_option,
                  membership.inherit_option,
                  membership.set_option
             from pg_auth_members membership
             join pg_roles member on member.oid = membership.member
             join pg_roles target on target.oid = membership.roleid
            where member.rolname = any($1::text[])
            order by member.rolname`,
          [[
            fixture.flywayLogin.username,
            fixture.platformLogin.username,
            fixture.workerLogin.username
          ]]
        )
    );
    expect(result.rows).toEqual([
      {
        member_name: fixture.flywayLogin.username,
        role_name: 'xht_flyway',
        admin_option: false,
        inherit_option: false,
        set_option: true
      },
      {
        member_name: fixture.platformLogin.username,
        role_name: 'xht_platform',
        admin_option: false,
        inherit_option: false,
        set_option: true
      },
      {
        member_name: fixture.workerLogin.username,
        role_name: 'xht_worker',
        admin_option: false,
        inherit_option: false,
        set_option: true
      }
    ]);
  });

  it('P05 platform LOGIN cannot read users before SET ROLE', async () => {
    await withLogin(fixture.platformLogin.connectionString, async (pool) =>
      expectRelationUnavailable(pool.query('select * from users'))
    );
  });

  it('P06 worker LOGIN cannot read outbox before SET ROLE', async () => {
    await withLogin(fixture.workerLogin.connectionString, async (pool) =>
      expectRelationUnavailable(pool.query('select * from outbox_messages'))
    );
  });

  it('P07 Flyway LOGIN can SET ROLE xht_flyway', async () => {
    const currentUser = await withLogin(
      fixture.flywayLogin.connectionString,
      async (pool) => {
        await pool.query('SET ROLE xht_flyway');
        return pool.query<{ readonly current_user: string }>('select current_user');
      }
    );
    expect(currentUser.rows[0]?.current_user).toBe('xht_flyway');
  });

  it('P08 platform factory proves session_user and current_user', async () => {
    expect(await platform.verifyRole()).toEqual({
      sessionUser: fixture.platformLogin.username,
      currentUser: 'xht_platform'
    });
  });

  it('P09 worker factory proves session_user and current_user', async () => {
    expect(await worker.verifyRole()).toEqual({
      sessionUser: fixture.workerLogin.username,
      currentUser: 'xht_worker'
    });
  });

  it('P10 platform can select, insert and update identity and Inbox tables', async () => {
    const user = await platform.db
      .insertInto('users')
      .values({ status: 'ACTIVE' })
      .returning('uid')
      .executeTakeFirstOrThrow();
    await platform.db
      .insertInto('memberships')
      .values({ uid: user.uid, status: 'ACTIVE' })
      .execute();
    await platform.db
      .insertInto('identity_profiles')
      .values({
        uid: user.uid,
        username_snapshot: null,
        display_name_snapshot: null
      })
      .execute();
    await platform.db
      .insertInto('channel_bindings')
      .values({
        channel_type: 'TELEGRAM',
        external_user_id: `synthetic-${randomUUID()}`,
        uid: user.uid,
        status: 'ACTIVE',
        revoked_at: null
      })
      .execute();
    await platform.db
      .insertInto('registration_idempotency')
      .values({
        registration_key: randomUUID(),
        channel_type: 'TELEGRAM',
        external_user_id: `synthetic-${randomUUID()}`,
        uid: null,
        status: 'PROCESSING',
        completed_at: null,
        failure_code: null,
        failed_at: null,
        conflicted_at: null
      })
      .execute();
    await platform.db
      .insertInto('inbox_messages')
      .values({
        consumer: 'platform',
        external_message_id: randomUUID(),
        payload_digest: `hmac-sha256:${'A'.repeat(43)}`,
        digest_key_version: 'v1',
        correlation_id: randomUUID(),
        status: 'RECEIVED',
        received_at: new Date(),
        claimed_by: null,
        claimed_until: null,
        processed_at: null,
        failure_code: null
      })
      .execute();
    expect(
      await platform.db.selectFrom('users').select('uid').where('uid', '=', user.uid).execute()
    ).toHaveLength(1);
    await platform.db
      .updateTable('identity_profiles')
      .set({ username_snapshot: 'synthetic' })
      .where('uid', '=', user.uid)
      .execute();
  });

  it('P11 platform can select and insert Outbox rows', async () => {
    const outboxId = randomUUID();
    await platform.db
      .insertInto('outbox_messages')
      .values({
        outbox_id: outboxId,
        topic: 'identity',
        event_key: randomUUID(),
        version: 1,
        payload: { uid: 'synthetic' },
        correlation_id: randomUUID(),
        status: 'READY',
        available_at: new Date(),
        locked_by: null,
        lease_token: null,
        locked_until: null,
        succeeded_at: null
      })
      .execute();
    expect(
      await platform.db
        .selectFrom('outbox_messages')
        .select('outbox_id')
        .where('outbox_id', '=', outboxId)
        .execute()
    ).toHaveLength(1);
  });

  it('P12 platform cannot access durable_jobs', async () => {
    await expectPermissionDenied(
      platform.db.selectFrom('durable_jobs').selectAll().execute()
    );
  });

  it('P13 platform cannot DELETE, run DDL or access Flyway history', async () => {
    await expectPermissionDenied(platform.db.deleteFrom('users').execute());
    await withLogin(fixture.platformLogin.connectionString, async (pool) => {
      await pool.query('SET ROLE xht_platform');
      await expectPermissionDenied(
        pool.query('CREATE TABLE xht_platform_forbidden_ddl (id integer)')
      );
    });
    await expectPermissionDenied(
      platform.db.selectFrom('flyway_schema_history' as never).selectAll().execute()
    );
  });

  it('P14 worker can select channel_bindings', async () => {
    await expect(worker.db.selectFrom('channel_bindings').selectAll().execute()).resolves.toBeDefined();
  });

  it('P15 worker can select/update Outbox and select/insert/update durable jobs', async () => {
    const outboxId = randomUUID();
    await withLogin(fixture.bootstrapLogin.connectionString, async (pool) => {
      await pool.query(
        `insert into outbox_messages
          (outbox_id, topic, event_key, version, payload, correlation_id, status, available_at)
         values ($1, 'identity', $2, 1, '{}'::jsonb, $3, 'READY', clock_timestamp())`,
        [outboxId, randomUUID(), randomUUID()]
      );
    });
    await worker.db
      .updateTable('outbox_messages')
      .set({ attempt_count: 1 })
      .where('outbox_id', '=', outboxId)
      .execute();
    const job = await worker.db
      .insertInto('durable_jobs')
      .values({
        job_type: 'synthetic',
        business_key: randomUUID(),
        payload: {},
        status: 'READY',
        available_at: new Date(),
        locked_by: null,
        lease_token: null,
        locked_until: null,
        succeeded_at: null
      })
      .returning('job_id')
      .executeTakeFirstOrThrow();
    await worker.db
      .updateTable('durable_jobs')
      .set({ attempt_count: 1 })
      .where('job_id', '=', job.job_id)
      .execute();
    expect(await worker.db.selectFrom('durable_jobs').selectAll().execute()).toBeDefined();
  });

  it('P16 worker cannot write identity, registration or Inbox tables', async () => {
    await expectPermissionDenied(
      worker.db.insertInto('users').values({ status: 'ACTIVE' }).execute()
    );
    await expectPermissionDenied(
      worker.db
        .updateTable('registration_idempotency')
        .set({ failure_code: 'DENIED' })
        .execute()
    );
    await expectPermissionDenied(
      worker.db
        .updateTable('inbox_messages')
        .set({ failure_code: 'DENIED' })
        .execute()
    );
  });

  it('P17 worker cannot DELETE, run DDL or access Flyway history', async () => {
    await expectPermissionDenied(worker.db.deleteFrom('outbox_messages').execute());
    await expectPermissionDenied(worker.db.deleteFrom('durable_jobs').execute());
    await withLogin(fixture.workerLogin.connectionString, async (pool) => {
      await pool.query('SET ROLE xht_worker');
      await expectPermissionDenied(
        pool.query('CREATE TABLE xht_worker_forbidden_ddl (id integer)')
      );
    });
    await expectPermissionDenied(
      worker.db.selectFrom('flyway_schema_history' as never).selectAll().execute()
    );
  });

  it('P18 platform and worker can insert and select audit events', async () => {
    for (const database of [platform.db, worker.db]) {
      const id = await database
        .insertInto('audit_events')
        .values({
          event_type: 'synthetic',
          actor_type: 'test',
          actor_ref: randomUUID(),
          subject_ref: randomUUID(),
          outcome: 'SUCCESS',
          correlation_id: randomUUID(),
          occurred_at: new Date()
        })
        .returning('audit_event_id')
        .executeTakeFirstOrThrow();
      expect(
        await database
          .selectFrom('audit_events')
          .select('audit_event_id')
          .where('audit_event_id', '=', id.audit_event_id)
          .execute()
      ).toHaveLength(1);
    }
  });

  it('P19 platform and worker cannot update or delete audit events', async () => {
    for (const database of [platform.db, worker.db]) {
      await expectPermissionDenied(
        database.updateTable('audit_events').set({ outcome: 'DENIED' }).execute()
      );
      await expectPermissionDenied(database.deleteFrom('audit_events').execute());
    }
  });

  it('P20 platform LOGIN cannot SET ROLE xht_worker', async () => {
    await withLogin(fixture.platformLogin.connectionString, async (pool) =>
      expectPermissionDenied(pool.query('SET ROLE xht_worker'))
    );
  });

  it('P21 worker LOGIN cannot SET ROLE platform or Flyway', async () => {
    await withLogin(fixture.workerLogin.connectionString, async (pool) => {
      await expectPermissionDenied(pool.query('SET ROLE xht_platform'));
      await expectPermissionDenied(pool.query('SET ROLE xht_flyway'));
    });
  });

  it('P22 app factories never expose the bootstrap session user', async () => {
    const evidence = await Promise.all([platform.verifyRole(), worker.verifyRole()]);
    expect(evidence.map((item) => item.sessionUser)).not.toContain(
      fixture.bootstrapLogin.username
    );
  });

  it('P23 concurrent connections all retain their unique application role', async () => {
    const [platformEvidence, workerEvidence] = await Promise.all([
      Promise.all([platform.verifyRole(), platform.verifyRole()]),
      Promise.all([worker.verifyRole(), worker.verifyRole()])
    ]);
    expect(new Set(platformEvidence.map((item) => item.currentUser))).toEqual(
      new Set(['xht_platform'])
    );
    expect(new Set(workerEvidence.map((item) => item.currentUser))).toEqual(
      new Set(['xht_worker'])
    );
  });
});
