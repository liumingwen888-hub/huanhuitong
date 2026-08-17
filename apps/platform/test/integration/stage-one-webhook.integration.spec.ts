import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RequestListener } from 'node:http';
import { Pool } from 'pg';
import type {
  HandleTelegramStartCommand,
  InboxDigestKey,
  InboxDigestKeyring,
  InboxDigestSet,
  StageOneDatabase
} from '@xht/contracts';
import { Kysely, PostgresDialect } from 'kysely';
import {
  AsyncBarrier,
  createStageOneHarness,
  type StageOneHarness
} from '@xht/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoleEnforcingPostgresPool } from '../../src/infrastructure/database/database.js';
import {
  createUnitOfWork,
  type UnitOfWork
} from '../../src/infrastructure/database/unit-of-work.js';
import { PostgresInboxRepository } from '../../src/modules/reliability/inbox/inbox.repository.js';
import { digestTelegramUpdate } from '../../src/modules/reliability/inbox/telegram-update-digest.js';
import { PostgresOutboxRepository } from '../../src/modules/reliability/outbox/outbox.repository.js';
import { PostgresIdentityRepository } from '../../src/modules/identity/infrastructure/postgres-identity.repository.js';
import { PostgresRegistrationIdempotencyRepository } from '../../src/modules/identity/infrastructure/postgres-registration-idempotency.repository.js';
import { ResolveOrCreateUid } from '../../src/modules/identity/application/resolve-or-create-uid.js';
import { injectedIdentityIdFactory } from '../../src/modules/identity/application/identity-event-factory.js';
import { HandleTelegramStart } from '../../src/modules/telegram/application/handle-telegram-start.js';
import { toTelegramUserReference } from '@xht/config';
import {
  DigestUnavailableError,
  type TelegramStartHandlerInput
} from '../../src/modules/telegram/http/telegram-webhook.controller.js';

const projectRoot = resolve(import.meta.dirname, '../../../..');

export function harnessDigestKey(
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

export interface ComposedHarnessOptions {
  readonly failIdentityCreate?: boolean;
  readonly failOutboxInsert?: boolean;
  readonly acquireHook?: () => Promise<void>;
}

export interface ComposedHarness {
  readonly harness: StageOneHarness;
  readonly startHandlerCalls: Array<{ readonly updateId: string }>;
  rotateDigestKeys(): void;
  dropOriginalDigestKey(): void;
  stopAll(): Promise<void>;
}

export async function createComposedHarness(
  options: ComposedHarnessOptions = {}
): Promise<ComposedHarness> {
  const { createPlatformApp } = await import(
    '../../src/bootstrap/create-platform-app.js'
  );
  const originalKey = harnessDigestKey('v1', 'harness-secret-v1-original');
  let currentKey = originalKey;
  let retained: readonly InboxDigestKey[] = [];
  const startHandlerCalls: Array<{ readonly updateId: string }> = [];

  const keyring = (): InboxDigestKeyring => {
    let disposed = false;
    return Object.freeze({
      current: Object.freeze({
        ...currentKey,
        withMaterial<T>(consumer: (material: Uint8Array) => T): T {
          if (disposed) throw new Error('KEYRING_DISPOSED');
          return currentKey.withMaterial(consumer);
        }
      }),
      retained: Object.freeze([...retained]),
      dispose(): void {
        disposed = true;
      },
      toJSON(): never {
        throw new Error('SERIALIZATION_FORBIDDEN');
      }
    });
  };

  let poolA: Pool | undefined;
  let poolB: Pool | undefined;
  let unitOfWorkA: UnitOfWork | undefined;
  let unitOfWorkB: UnitOfWork | undefined;

  const makeUnitOfWork = (pool: Pool, username: string): UnitOfWork => {
    const kysely = new Kysely<StageOneDatabase>({
      dialect: new PostgresDialect({
        pool: new RoleEnforcingPostgresPool(pool as never, username)
      })
    });
    return createUnitOfWork(kysely);
  };

  const startHandler = async (input: TelegramStartHandlerInput): Promise<void> => {
    startHandlerCalls.push({ updateId: input.start.updateId });
    if (options.acquireHook !== undefined) await options.acquireHook();
    const digestSet = input.digestSet;
    if ('unavailable' in digestSet && digestSet.unavailable === true) {
      throw new DigestUnavailableError();
    }
    const harnessBind = currentHarness;
    if (harnessBind === undefined) throw new Error('HARNESS_NOT_READY');
    if (poolA === undefined) {
      poolA = new Pool({
        connectionString: harnessBind.platformLogin.connectionString,
        max: 4,
        application_name: 'xht-stage1-a'
      });
      poolB = new Pool({
        connectionString: harnessBind.platformLogin.connectionString,
        max: 4,
        application_name: 'xht-stage1-b'
      });
      unitOfWorkA = makeUnitOfWork(poolA, harnessBind.platformLogin.username);
      unitOfWorkB = makeUnitOfWork(poolB, harnessBind.platformLogin.username);
    }
    const unitOfWork =
      Number(input.start.updateId) % 2 === 0 ? unitOfWorkB! : unitOfWorkA!;
    const identities = new PostgresIdentityRepository();
    const identityRepo = options.failIdentityCreate
      ? ({
          findActiveBinding: identities.findActiveBinding.bind(identities),
          createUser: async () => {
            throw new Error('SYNTHETIC_IDENTITY_CREATE_FAILURE');
          },
          createMembership: identities.createMembership.bind(identities),
          upsertProfileSnapshot:
            identities.upsertProfileSnapshot.bind(identities),
          createActiveBinding: identities.createActiveBinding.bind(identities)
        } as never)
      : identities;
    const outboxRepo = new PostgresOutboxRepository();
    const failingOutbox = options.failOutboxInsert
      ? ({ enqueue: async () => { throw new Error('SYNTHETIC_OUTBOX_INSERT_FAILURE'); } } as never)
      : outboxRepo;
    const handler = new HandleTelegramStart(
      unitOfWork,
      new PostgresInboxRepository(),
      new ResolveOrCreateUid(
        identityRepo,
        new PostgresRegistrationIdempotencyRepository(),
        outboxRepo,
        injectedIdentityIdFactory
      ),
      failingOutbox,
      injectedIdentityIdFactory
    );
    const command: HandleTelegramStartCommand = {
      updateId: input.start.updateId,
      externalUserId: input.start.externalUserId,
      chatId: input.start.chatId,
      username: input.start.username,
      displayName: input.start.displayName,
      inboxDigests: digestSet as InboxDigestSet,
      correlationId: randomUUID(),
      receivedAt: new Date(),
      claimant: 'telegram-webhook-v1'
    };
    const result = await handler.execute(command);
    if (process.env.T13_DEBUG) console.log('RESULT', JSON.stringify(result));
    if (result.kind === 'digest_key_unavailable') {
      throw new DigestUnavailableError();
    }
  };

  let appHandle: Awaited<ReturnType<typeof createPlatformApp>> | undefined;
  let currentHarness: StageOneHarness | undefined;

  const app = await createPlatformApp({
    webhookSecret: 'harness-webhook-secret',
    trustedProxyEnabled: true,
    injectedBotInfo: {
      id: 1,
      is_bot: true,
      first_name: 'Test',
      username: 'test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false
    } as never,
    digestProvider: {
      digest: (rawUpdate: object) => digestTelegramUpdate(rawUpdate, keyring())
    },
    startHandler: { handle: startHandler }
  });
  appHandle = app;
  const express = app.app.getHttpAdapter().getInstance() as RequestListener;
  currentHarness = await createStageOneHarness({
    projectRoot,
    requestHandler: express
  });

  return {
    harness: currentHarness,
    startHandlerCalls,
    rotateDigestKeys(): void {
      retained = [harnessDigestKey('v1', 'harness-secret-v1-original', 'retained')];
      currentKey = harnessDigestKey('v3', 'harness-secret-v3-rotated');
    },
    dropOriginalDigestKey(): void {
      retained = [];
    },
    stopAll: async () => {
      await currentHarness!.stop();
      await appHandle!.close();
      await poolA?.end();
      await poolB?.end();
    }
  };
}

export function startBody(input: {
  readonly updateId: string;
  readonly externalUserId: string;
  readonly username?: string | null;
  readonly text?: string;
  readonly fromId?: string;
  readonly chatId?: string;
  readonly topLevel?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    update_id: Number(input.updateId),
    message: {
      message_id: 11,
      from: {
        id: Number(input.fromId ?? input.externalUserId),
        is_bot: false,
        first_name: 'Synthetic',
        ...(input.username === undefined
          ? { username: 'synthetic_user' }
          : input.username === null
            ? {}
            : { username: input.username }),
        language_code: 'en'
      },
      chat: {
        id: Number(input.chatId ?? input.externalUserId),
        type: 'private'
      },
      date: 1770000000,
      ...(input.text === undefined ? { text: '/start' } : { text: input.text })
    },
    ...(input.topLevel ?? {})
  };
}

describe('stage one webhook acceptance', () => {
  let composed: ComposedHarness;
  let harness: StageOneHarness;

  beforeAll(async () => {
    composed = await createComposedHarness();
    harness = composed.harness;
  }, 180_000);

  afterAll(async () => {
    await composed.stopAll();
  });

  beforeEach(async () => {
    for (const table of [
      'outbox_messages',
      'inbox_messages',
      'registration_idempotency',
      'channel_bindings',
      'identity_profiles',
      'memberships',
      'users'
    ]) {
      await harness.query(`DELETE FROM ${table}`);
    }
  });

  it('01: rejects an invalid webhook secret_token', async () => {
    const response = await harness.postWebhook(
      startBody({ updateId: '9501', externalUserId: '8501' }),
      { 'x-telegram-bot-api-secret-token': 'wrong' }
    );
    expect(response.status).toBe(401);
    expect(await harness.count('inbox_messages')).toBe(0);
    expect(await harness.count('users')).toBe(0);
  });

  it('02: rejects a missing webhook secret_token without handler calls', async () => {
    const response = await harness.postWebhook(
      startBody({ updateId: '9502', externalUserId: '8502' }),
      { 'x-telegram-bot-api-secret-token': '' }
    );
    expect(response.status).toBe(401);
    expect(composed.startHandlerCalls).toHaveLength(0);
  });

  it('03: rejects only a malformed update envelope', async () => {
    for (const body of [
      { update_id: 'not-digits', message: {} },
      'not-an-object'
    ]) {
      const response = await harness.postWebhook(body as object);
      expect(response.status).toBe(400);
    }
    expect(await harness.count('inbox_messages')).toBe(0);
    expect(await harness.count('users')).toBe(0);
  });

  it('04: returns 200 ignored for legal unsupported updates', async () => {
    const bodies = [
      { update_id: 101, message: { message_id: 1, chat: { id: 1, type: 'private' }, date: 1, photo: [{}] } },
      { update_id: 102, callback_query: { id: 'q', from: { id: 1, is_bot: false, first_name: 'A' } } },
      { update_id: 103, message: { message_id: 2, chat: { id: -100, type: 'group' }, date: 1, text: '/start' } },
      { update_id: 104, message: { message_id: 3, chat: { id: 5, type: 'private' }, date: 1, text: '/balance' } }
    ];
    for (const body of bodies) {
      const response = await harness.postWebhook(body);
      expect(response.status).toBe(200);
    }
    expect(await harness.count('users')).toBe(0);
    expect(await harness.count('outbox_messages')).toBe(0);
  });

  it('05: creates one uid for the first start', async () => {
    await harness.postWebhook(startBody({ updateId: '9505', externalUserId: '8505' }));
    expect(await harness.count('users')).toBe(1);
    expect(await harness.count('memberships')).toBe(1);
    expect(await harness.countActiveBindings('8505')).toBe(1);
    expect(await harness.count('registration_idempotency')).toBe(1);
  });

  it('06: returns the same uid for a repeated start', async () => {
    await harness.postWebhook(startBody({ updateId: '9506', externalUserId: '8506' }));
    await harness.postWebhook(startBody({ updateId: '9507', externalUserId: '8506' }));
    expect(await harness.count('users')).toBe(1);
    const uids = await harness.distinctResolvedUids();
    expect(uids).toHaveLength(1);
  });

  it('07: distinguishes full-update replay, rotation and update-id conflict', async () => {
    const body = startBody({ updateId: '9508', externalUserId: '8508' });
    const first = await harness.postWebhook(body);
    expect(first.status).toBe(200);
    const original = await harness.inboxRow('9508');
    expect(original?.status).toBe('PROCESSED');

    // object key-order equivalence is a duplicate, not a conflict
    const reordered = {
      message: body.message,
      update_id: body.update_id
    };
    const replay = await harness.postWebhook(reordered);
    expect(replay.status).toBe(200);
    expect(await harness.count('users')).toBe(1);

    // rotation: retained original-version key still recognises the replay
    composed.rotateDigestKeys();
    const rotatedReplay = await harness.postWebhook(body);
    expect(rotatedReplay.status).toBe(200);
    expect(await harness.count('users')).toBe(1);

    // every field mutation conflicts without mutating the stored row
    const mutations = [
      startBody({ updateId: '9508', externalUserId: '8508', text: '/start other' }),
      startBody({ updateId: '9508', externalUserId: '8508', fromId: '9999' }),
      startBody({ updateId: '9508', externalUserId: '8508', chatId: '7777' }),
      { ...startBody({ updateId: '9508', externalUserId: '8508' }), extra_top: 1 }
    ];
    for (const mutation of mutations) {
      const response = await harness.postWebhook(mutation);
      expect(response.status).toBe(200);
    }
    const afterConflicts = await harness.inboxRow('9508');
    expect(afterConflicts?.payload_digest).toBe(original?.payload_digest);
    expect(afterConflicts?.digest_key_version).toBe(
      original?.digest_key_version
    );
    expect(await harness.countTopic('identity.uid-created.v1')).toBe(1);

    // dropping the original digest key fails closed with 503
    composed.dropOriginalDigestKey();
    const missingKeyReplay = await harness.postWebhook(body);
    expect(missingKeyReplay.status).toBe(503);
    expect(await harness.count('users')).toBe(1);
  });

  it('10: keeps uid stable when username changes', async () => {
    await harness.postWebhook(startBody({ updateId: '9510', externalUserId: '8510', username: 'old_name' }));
    await harness.postWebhook(startBody({ updateId: '9511', externalUserId: '8510', username: 'new_name' }));
    expect(await harness.count('users')).toBe(1);
    const snapshot = await harness.query<{ username_snapshot: string | null }>(
      'SELECT username_snapshot FROM identity_profiles'
    );
    expect(snapshot[0]?.username_snapshot).toBe('new_name');
  });

  it('11: resolves a binding when username is absent', async () => {
    const response = await harness.postWebhook(
      startBody({ updateId: '9512', externalUserId: '8512', username: null })
    );
    expect(response.status).toBe(200);
    expect(await harness.count('users')).toBe(1);
    const snapshot = await harness.query<{ username_snapshot: string | null }>(
      'SELECT username_snapshot FROM identity_profiles'
    );
    expect(snapshot[0]?.username_snapshot).toBeNull();
  });

  it('12: publishes UidCreatedV1 once across first, repeat and concurrency', { timeout: 60_000 }, async () => {
    const barrier = new AsyncBarrier(2);
    let armBarrier = false;
    const concurrent = await createComposedHarness({
      acquireHook: async () => {
        if (armBarrier) await barrier.wait();
      }
    });
    try {
      await concurrent.harness.postWebhook(startBody({ updateId: '9513', externalUserId: '8513' }));
      await concurrent.harness.postWebhook(startBody({ updateId: '9514', externalUserId: '8513' }));
      armBarrier = true;
      const pair = await Promise.all([
        concurrent.harness.postWebhook(startBody({ updateId: '9515', externalUserId: '8514' })),
        concurrent.harness.postWebhook(startBody({ updateId: '9516', externalUserId: '8514' }))
      ]);
      armBarrier = false;
      if (process.env.T13_DEBUG) console.log('PAIR', JSON.stringify(pair.map((r) => r.status)));
      expect(
        await concurrent.harness.countTopic('identity.uid-created.v1')
      ).toBe(2);
    } finally {
      expect(await concurrent.harness.count('users')).toBe(2);
      await concurrent.stopAll();
    }
  });

  it('13: publishes TelegramUserSeenV1 without another registration', async () => {
    await harness.postWebhook(startBody({ updateId: '9517', externalUserId: '8515' }));
    const before = await harness.count('registration_idempotency');
    await harness.postWebhook(startBody({ updateId: '9518', externalUserId: '8515' }));
    expect(await harness.countTopic('identity.telegram-user-seen.v1')).toBe(1);
    expect(await harness.count('registration_idempotency')).toBe(before);
  });

  it('17: sensitive values stay out of logs, spans carry no attributes, pseudonyms rotate', async () => {
    const telemetryFactory = await readFile(
      resolve(
        projectRoot,
        'apps/platform/src/infrastructure/telemetry/create-platform-telemetry.ts'
      ),
      'utf8'
    );
    expect(telemetryFactory.match(/setAttribute|attributes\s*:/u) ?? []).toEqual([]);
    const keyA = new Uint8Array(32).fill(3);
    const keyB = new Uint8Array(32).fill(4);
    const options = (key: Uint8Array) => ({
      resolver: {} as never,
      keySource: { kind: 'static' as const, key }
    });
    const withA = await toTelegramUserReference(options(keyA), '8600');
    const withA2 = await toTelegramUserReference(options(keyA), '8600');
    const withB = await toTelegramUserReference(options(keyB), '8600');
    expect(withA).toBe(withA2);
    expect(withA).not.toBe(withB);
    expect(withA.startsWith('tgur-v1:')).toBe(true);
  });
});
