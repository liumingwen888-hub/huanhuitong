import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { InboxDigestKey, InboxDigestKeyring, StageOneDatabase, Uid } from '@xht/contracts';
import {
  migrateAndValidate,
  startPostgresFixture,
  type PostgresFixture
} from '@xht/testing';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoleEnforcingPostgresPool } from '../../src/infrastructure/database/database.js';
import {
  createUnitOfWork,
  type UnitOfWork
} from '../../src/infrastructure/database/unit-of-work.js';
import { PostgresCredentialRepository } from '../../src/modules/security/infrastructure/postgres-credential.repository.js';
import { PostgresCredentialSessionRepository } from '../../src/modules/security/infrastructure/postgres-credential-session.repository.js';
import { VerifyPaymentCredential } from '../../src/modules/security/application/verify-payment-credential.js';
import { CredentialSessionService } from '../../src/modules/security/application/credential-session.service.js';
import { SecurityCommandHandler } from '../../src/modules/telegram/application/security-command.handler.js';
import { digestTelegramUpdate } from '../../src/modules/reliability/inbox/telegram-update-digest.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

function digestKey(
  version: string,
  secret: string,
  status: 'current' | 'retained' = 'current'
): InboxDigestKey & {
  withMaterial<T>(consumer: (material: Uint8Array) => T): T;
} {
  const material = Buffer.from(secret, 'utf8');
  return Object.freeze({
    version,
    status,
    activatedAt: '2026-08-01T00:00:00.000Z',
    ...(status === 'retained'
      ? {
          retainedAt: '2026-08-01T00:00:00.000Z',
          retireNotBefore: '2027-08-01T00:00:00.000Z'
        }
      : {}),
    withMaterial<T>(consumer: (bytes: Uint8Array) => T): T {
      const borrowed = Buffer.from(material);
      try {
        return consumer(borrowed);
      } finally {
        borrowed.fill(0);
      }
    },
    toJSON(): never {
      throw new Error('SERIALIZATION_FORBIDDEN');
    }
  });
}

const CURRENT_KEY = digestKey('v1', 's26-current-secret');

const keyring = (): InboxDigestKeyring =>
  Object.freeze({
    current: Object.freeze({ ...CURRENT_KEY }),
    retained: Object.freeze([]),
    dispose(): void {},
    toJSON(): never {
      throw new Error('SERIALIZATION_FORBIDDEN');
    }
  });

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const credentials = new PostgresCredentialRepository();
let handler: SecurityCommandHandler;

async function send(
  updateId: number,
  text: string,
  externalUserId = '8901'
): Promise<{ readonly reply: string; readonly claim: string }> {
  const rawUpdate = {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: Number(externalUserId), is_bot: false, first_name: 'S' },
      chat: { id: Number(externalUserId), type: 'private' },
      date: 1770000000,
      text
    }
  };
  const { classifySecurityUpdate } = await import(
    '../../src/modules/telegram/application/security-commands.js'
  );
  const security = classifySecurityUpdate(rawUpdate);
  if (security === null) throw new Error('UNCLASSIFIED');
  const result = await handler.execute({
    rawUpdate,
    digestSet: digestTelegramUpdate(rawUpdate, keyring()),
    command: security.command,
    externalUserId: security.externalUserId,
    updateId: String(updateId)
  });
  return { reply: result.reply, claim: result.claim };
}

async function seedUser(): Promise<Uid> {
  return unitOfWork.execute(async (context) => {
    const created = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    const uid = created.rows[0]!.uid as Uid;
    await context.executeSql(
      `INSERT INTO channel_bindings
         (channel_type, external_user_id, uid, status)
       VALUES ('TELEGRAM', '8901', $1::uuid, 'ACTIVE')`,
      [uid]
    );
    return uid;
  });
}

async function countPrompts(): Promise<number> {
  const rows = await cleanupPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outbox_messages
      WHERE topic='telegram.security-prompt.v1'`
  );
  return rows.rows[0]?.n ?? 0;
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
  cleanupPool = new Pool({
    connectionString: fixture.bootstrapLogin.connectionString,
    max: 1,
    application_name: 'xht-s26-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s26-platform'
  });
  const kysely = new Kysely<StageOneDatabase>({
    dialect: new PostgresDialect({
      pool: new RoleEnforcingPostgresPool(
        platformPool as never,
        fixture.platformLogin.username
      )
    })
  });
  unitOfWork = createUnitOfWork(kysely);
  const sessions = new CredentialSessionService(
    unitOfWork,
    new PostgresCredentialSessionRepository(),
    credentials,
    new VerifyPaymentCredential(unitOfWork, credentials)
  );
  handler = new SecurityCommandHandler(unitOfWork, sessions);
}, 180_000);

beforeEach(async () => {
  for (const table of [
    'outbox_messages',
    'inbox_messages',
    'credential_sessions',
    'security_locks',
    'recovery_cases',
    'payment_credentials',
    'channel_bindings',
    'identity_profiles',
    'memberships',
    'users'
  ]) {
    await cleanupPool.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('S2-6 security UX flow', () => {
  it('S6D01: full setup flow over the command handler ends ACTIVE', async () => {
    const uid = await seedUser();
    expect((await send(1001, '/setpassword')).reply).toBe('setupStarted');
    expect((await send(1002, '135790')).reply).toBe('setupStarted');
    expect((await send(1003, '/done')).reply).toBe('confirmPhase');
    expect((await send(1004, '135790')).reply).toBe('setupStarted');
    const final = await send(1005, '/done');
    expect(final.reply).toBe('setupSuccess');
    const credential = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(credential?.status).toBe('ACTIVE');
    const prompts = await countPrompts();
    expect(prompts).toBe(3);
  });

  it('S6D02: mismatched confirmation reports and fails the session', async () => {
    const uid = await seedUser();
    await send(1101, '/setpassword');
    await send(1102, '135790');
    await send(1103, '/done');
    await send(1104, '135791');
    const final = await send(1105, '/done');
    expect(final.reply).toBe('entriesMismatch');
    const credential = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(credential).toBeNull();
  });

  it('S6D03: digits without an open flow are a no-op reply', async () => {
    await seedUser();
    const outcome = await send(1201, '135790');
    expect(outcome.reply).toBe('notInSession');
    expect(await countPrompts()).toBe(0);
  });

  it('S6D04: replaying the identical update is idempotent', async () => {
    const uid = await seedUser();
    await send(1301, '/setpassword');
    await send(1302, '135790');
    const first = await send(1303, '/done');
    expect(first.reply).toBe('confirmPhase');
    const promptsBefore = await countPrompts();
    const replay = await send(1303, '/done');
    expect(replay.claim).toBe('duplicate_same_payload');
    expect(await countPrompts()).toBe(promptsBefore);
    const credential = await unitOfWork.execute((context) =>
      credentials.findCredential(context, uid)
    );
    expect(credential).toBeNull();
  });

  it('S6D05: cancel terminates the flow and the session', async () => {
    await seedUser();
    await send(1401, '/setpassword');
    await send(1402, '135');
    const cancelled = await send(1403, '/cancel');
    expect(cancelled.reply).toBe('cancelled');
    const rows = await cleanupPool.query<{ status: string }>(
      `SELECT status FROM credential_sessions`
    );
    expect(rows.rows[0]?.status).toBe('CANCELLED');
    const after = await send(1404, '7');
    expect(after.reply).toBe('notInSession');
  });

  it('S6D06: authorize flow issues success reply without proof material', async () => {
    const uid = await seedUser();
    await send(1501, '/setpassword');
    await send(1502, '135790');
    await send(1503, '/done');
    await send(1504, '135790');
    await send(1505, '/done');
    await send(1510, '/authorize order-9');
    await send(1511, '135790');
    const final = await send(1512, '/done');
    expect(final.reply).toBe('authorized');
    const prompts = await cleanupPool.query<{ payload: object }>(
      `SELECT payload FROM outbox_messages
        WHERE topic='telegram.security-prompt.v1'`
    );
    for (const row of prompts.rows) {
      const serialized = JSON.stringify(row.payload);
      expect(serialized).not.toContain('135790');
      expect(serialized).not.toContain('order-9');
    }
    void uid;
  });

  it('S6D07: inbox and prompt payloads never carry digit material', async () => {
    await seedUser();
    await send(1601, '/setpassword');
    await send(1602, '135790');
    const inbox = await cleanupPool.query<{ payload_digest: string }>(
      `SELECT payload_digest FROM inbox_messages
        WHERE consumer='telegram-security-v1'`
    );
    expect(inbox.rows.length).toBeGreaterThanOrEqual(2);
    const audit = await cleanupPool.query(
      `SELECT count(*)::int AS n FROM audit_events`
    );
    expect(audit.rows[0]?.n).toBe(0);
    const prompts = await cleanupPool.query<{ payload: object }>(
      `SELECT payload FROM outbox_messages
        WHERE topic='telegram.security-prompt.v1'`
    );
    for (const row of prompts.rows) {
      expect(JSON.stringify(row.payload)).not.toContain('135790');
    }
  });
});
