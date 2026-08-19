import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  InboxDigestKey,
  InboxDigestKeyring,
  StageOneDatabase,
  Uid
} from '@xht/contracts';
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
import { RecoveryCaseService } from '../../src/modules/security/application/recovery-case.service.js';
import { SecurityCommandHandler } from '../../src/modules/telegram/application/security-command.handler.js';
import { classifySecurityUpdate } from '../../src/modules/telegram/application/security-commands.js';
import { CredentialEntryBuffer } from '../../src/modules/security/domain/credential-processor.js';
import { hashCredentialDigits } from '../../src/modules/security/domain/credential-hash.js';
import { generateTotpSecret, totpCode } from '../../src/modules/security/domain/totp.js';
import { digestTelegramUpdate } from '../../src/modules/reliability/inbox/telegram-update-digest.js';
import { createPlatformLogger } from '../../src/infrastructure/logging/create-platform-logger.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');
const SENTINEL = '919191';

function digestKey(
  version: string,
  secret: string
): InboxDigestKey & {
  withMaterial<T>(consumer: (material: Uint8Array) => T): T;
} {
  const material = Buffer.from(secret, 'utf8');
  return Object.freeze({
    version,
    status: 'current' as const,
    activatedAt: '2026-08-01T00:00:00.000Z',
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

const keyring = (): InboxDigestKeyring =>
  Object.freeze({
    current: Object.freeze({ ...digestKey('v1', 's2a-current') }),
    retained: Object.freeze([]),
    dispose(): void {},
    toJSON(): never {
      throw new Error('SERIALIZATION_FORBIDDEN');
    }
  });

function digitBytes(digits: string): Uint8Array {
  const bytes = new Uint8Array(digits.length);
  for (let index = 0; index < digits.length; index += 1) {
    bytes[index] = digits.charCodeAt(index);
  }
  return bytes;
}

async function bufferOf(digits: string): Promise<CredentialEntryBuffer> {
  const buffer = new CredentialEntryBuffer();
  for (const digit of digits) buffer.appendDigit(digit);
  return buffer;
}

let fixture: PostgresFixture;
let platformPool: Pool;
let cleanupPool: Pool;
let unitOfWork: UnitOfWork;
const credentials = new PostgresCredentialRepository();
let verifier: VerifyPaymentCredential;
let sessions: CredentialSessionService;
let recovery: RecoveryCaseService;
let securityHandler: SecurityCommandHandler;
let s2aUid: Uid;

async function seedUserWithCredential(digits: string): Promise<Uid> {
  const uid = await unitOfWork.execute(async (context) => {
    const user = await context.executeSql<{ uid: string }>(
      `INSERT INTO users (status) VALUES ('ACTIVE') RETURNING uid`,
      []
    );
    const uidValue = user.rows[0]!.uid as Uid;
    await context.executeSql(
      `INSERT INTO channel_bindings
         (channel_type, external_user_id, uid, status)
       VALUES ('TELEGRAM', '9101', $1::uuid, 'ACTIVE')`,
      [uidValue]
    );
    return uidValue;
  });
  const hashed = await hashCredentialDigits(digitBytes(digits));
  await unitOfWork.execute(async (context) => {
    await credentials.upsertActiveCredential(context, {
      uid,
      hashV1: hashed.hashV1,
      hashAlgorithm: 'scrypt' as never,
      hashParamVersion: hashed.paramVersion
    });
  });
  return uid;
}

async function securitySend(
  updateId: number,
  text: string
): Promise<{ readonly reply: string; readonly claim: string }> {
  const rawUpdate = {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 9101, is_bot: false, first_name: 'A' },
      chat: { id: 9101, type: 'private' },
      date: 1770000000,
      text
    }
  };
  const security = classifySecurityUpdate(rawUpdate);
  if (security === null) throw new Error('UNCLASSIFIED');
  const result = await securityHandler.execute({
    rawUpdate,
    digestSet: digestTelegramUpdate(rawUpdate, keyring()),
    command: security.command,
    externalUserId: security.externalUserId,
    updateId: String(updateId)
  });
  return { reply: result.reply, claim: result.claim };
}

async function scanAllTablesForSentinel(): Promise<string[]> {
  const hits: string[] = [];
  const checks: Array<[string, string]> = [
    ['payment_credentials', `hash_v1::text`],
    ['credential_sessions', `order_ref || ' ' || amount_summary || ' ' || asset_summary`],
    ['inbox_messages', `payload_digest`],
    ['outbox_messages', `payload::text`],
    ['audit_events', `event_type || ' ' || subject_ref`]
  ];
  for (const [table, expression] of checks) {
    const rows = await cleanupPool.query(
      `SELECT count(*)::int AS n FROM ${table}
        WHERE ${expression} LIKE '%' || $1 || '%'`,
      [SENTINEL]
    );
    if ((rows.rows[0]?.n ?? 0) > 0) hits.push(table);
  }
  return hits;
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
    application_name: 'xht-s2a-cleanup'
  });
  platformPool = new Pool({
    connectionString: fixture.platformLogin.connectionString,
    max: 4,
    application_name: 'xht-s2a-platform'
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
  verifier = new VerifyPaymentCredential(unitOfWork, credentials);
  sessions = new CredentialSessionService(
    unitOfWork,
    new PostgresCredentialSessionRepository(),
    credentials,
    verifier
  );
  recovery = new RecoveryCaseService(unitOfWork, credentials, verifier);
  securityHandler = new SecurityCommandHandler(unitOfWork, sessions);
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
  s2aUid = await seedUserWithCredential(SENTINEL);
});

afterAll(async () => {
  await platformPool.end();
  await cleanupPool.end();
  await fixture.stop();
}, 180_000);

describe.sequential('stage two acceptance (S2A01–S2A16)', () => {
  it('S2A01-03: no password material persists in any table after real flows', async () => {
    await verifier.execute(s2aUid, await bufferOf(SENTINEL));
    await verifier.execute(s2aUid, await bufferOf('000000'));
    const begun = await sessions.beginAuthorization({
      uid: s2aUid,
      operationType: 'withdrawal',
      orderRef: 'order-s2a',
      amountSummary: '5.00',
      assetSummary: 'USDT'
    });
    await sessions.cancel(begun.sessionId);
    expect(await scanAllTablesForSentinel()).toEqual([]);
  });

  it('S2A04: structured logging emits zero password material', async () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, done) {
        output += String(chunk);
        done();
      }
    });
    const logger = createPlatformLogger(destination);
    logger.warn('telegram_webhook_rejected', {
      correlation_id: 'corr_s2a_1',
      update_id: '9101',
      route: 'telegram.start',
      outcome: 'rejected',
      error_category: 'telegram_update_invalid'
    });
    expect(output).toContain('corr_s2a_1');
    expect(output).not.toContain(SENTINEL);
    const unsafe = logger as unknown as {
      info(event: string, context: Record<string, unknown>): void;
    };
    expect(() =>
      unsafe.info('telegram_webhook_processed', {
        update_id: '9101',
        route: 'telegram.start',
        outcome: 'processed',
        password: SENTINEL
      })
    ).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
  });

  it('S2A05: the telemetry surface exposes no attribute channel', async () => {
    const source = await readFile(
      resolve(
        projectRoot,
        'apps/platform/src/infrastructure/telemetry/create-platform-telemetry.ts'
      ),
      'utf8'
    );
    expect(source.match(/setAttribute|attributes\s*:/u) ?? []).toEqual([]);
  });

  it('S2A06-07: five failures lock, escalate, and short-circuit', async () => {
    for (let index = 0; index < 5; index += 1) {
      await verifier.execute(s2aUid, await bufferOf('000000'));
    }
    const first = await unitOfWork.execute((context) =>
      credentials.findCredential(context, s2aUid)
    );
    expect(first?.status).toBe('LOCKED');
    expect(
      await verifier.execute(s2aUid, await bufferOf(SENTINEL))
    ).toBe('locked');
    await cleanupPool.query(
      `UPDATE payment_credentials SET status='ACTIVE', locked_until=NULL,
          failed_attempts=0 WHERE uid=$1::uuid`,
      [s2aUid]
    );
    for (let index = 0; index < 10; index += 1) {
      await verifier.execute(s2aUid, await bufferOf('000000'));
    }
    const escalated = await cleanupPool.query<{ window: number }>(
      `SELECT EXTRACT(EPOCH FROM (locked_until - clock_timestamp()))::int AS window
         FROM payment_credentials WHERE uid=$1::uuid`,
      [s2aUid]
    );
    expect(escalated.rows[0]?.window ?? 0).toBeGreaterThan(900);
  });

  it('S2A08: replaying a session nonce has zero effect', async () => {
    const begun = await sessions.beginSetup(s2aUid);
    const nonce = randomUUID();
    sessions.appendDigit({
      sessionId: begun.sessionId,
      actionNonce: nonce,
      digit: '1',
      phase: 'primary'
    });
    expect(() =>
      sessions.appendDigit({
        sessionId: begun.sessionId,
        actionNonce: nonce,
        digit: '2',
        phase: 'primary'
      })
    ).toThrowError('SESSION_NONCE_REUSED');
    await sessions.cancel(begun.sessionId);
  });

  it('S2A09: replaying an identical security update is a duplicate', async () => {
    await securitySend(2001, '/setpassword');
    const replay = await securitySend(2001, '/setpassword');
    expect(replay.claim).toBe('duplicate_same_payload');
    const open = await cleanupPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM credential_sessions WHERE status='OPEN'`
    );
    expect(open.rows[0]?.n).toBe(1);
    await securitySend(2002, '/cancel');
  });

  it('S2A10: borrowed digit buffers are zeroed after use', async () => {
    const buffer = await bufferOf(SENTINEL);
    await buffer.withBytes((bytes) => bytes.length);
    expect(buffer.length).toBe(0);
  });

  it('S2A11: legacy parameter versions rehash transparently', async () => {
    await cleanupPool.query(
      `UPDATE payment_credentials SET hash_param_version=0 WHERE uid=$1::uuid`,
      [s2aUid]
    );
    expect(await verifier.execute(s2aUid, await bufferOf(SENTINEL))).toBe(
      'verified'
    );
    const row = await cleanupPool.query<{ v: number }>(
      `SELECT hash_param_version AS v FROM payment_credentials WHERE uid=$1::uuid`,
      [s2aUid]
    );
    expect(row.rows[0]?.v).toBe(1);
    expect(await verifier.execute(s2aUid, await bufferOf(SENTINEL))).toBe(
      'verified'
    );
  });

  it('S2A12-13: recovery approval cooldowns the credential and gates payment', async () => {
    const totpSecret = generateTotpSecret();
    const now = Date.now();
    const begun = await recovery.beginRecovery({
      uid: s2aUid,
      factorsRequired: 3,
      totpSecret
    });
    await recovery.achieveFactorMemory(begun.caseId, await bufferOf(SENTINEL));
    await recovery.achieveFactorTotp(
      begun.caseId,
      totpCode(totpSecret, now),
      now
    );
    await recovery.submitEvidenceForReview(begun.caseId, 'evidence-s2a');
    await recovery.approve(begun.caseId);
    const credential = await unitOfWork.execute((context) =>
      credentials.findCredential(context, s2aUid)
    );
    expect(credential?.status).toBe('COOLDOWN');
    expect(
      await verifier.execute(s2aUid, await bufferOf(SENTINEL))
    ).toBe('cooldown');
  });

  it('S2A14: approving an underfunded recovery case fails closed', async () => {
    const begun = await recovery.beginRecovery({ uid: s2aUid });
    await recovery.submitEvidenceForReview(begun.caseId, 'evidence-thin');
    await expect(recovery.approve(begun.caseId)).rejects.toThrowError(
      'FACTORS_INSUFFICIENT'
    );
  });

  it('S2A15: the bot UX chain completes setup then authorization', async () => {
    await securitySend(2101, '/cancel');
    await securitySend(2102, '/setpassword');
    await securitySend(2103, SENTINEL);
    await securitySend(2104, '/done');
    await securitySend(2105, SENTINEL);
    expect((await securitySend(2106, '/done')).reply).toBe('setupSuccess');
    await securitySend(2107, '/authorize order-s2a');
    await securitySend(2108, SENTINEL);
    expect((await securitySend(2109, '/done')).reply).toBe('authorized');
    expect(await scanAllTablesForSentinel()).toEqual([]);
  });

  it('S2A16: the security module stays channel-agnostic', async () => {
    const files = [
      'apps/platform/src/modules/security/domain/credential-processor.ts',
      'apps/platform/src/modules/security/domain/credential-hash.ts',
      'apps/platform/src/modules/security/application/verify-payment-credential.ts',
      'apps/platform/src/modules/security/application/recovery-case.service.ts'
    ];
    for (const file of files) {
      const source = await readFile(resolve(projectRoot, file), 'utf8');
      expect(source.match(/grammy|telegram/u) ?? []).toEqual([]);
    }
  });
});
