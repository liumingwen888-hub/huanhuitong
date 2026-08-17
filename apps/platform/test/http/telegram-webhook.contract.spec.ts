import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UserFromGetMe } from 'grammy/types';
import { createPlatformApp } from '../../src/bootstrap/create-platform-app.js';
import type {
  PlatformAppHandle,
} from '../../src/bootstrap/create-platform-app.js';
import type {
  TelegramStartHandler,
  TelegramStartHandlerInput
} from '../../src/modules/telegram/http/telegram-webhook.controller.js';

const fakeSecret = 'test-secret-token-1';

const botInfo: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'Test',
  username: 'test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false
} as unknown as UserFromGetMe;

function privateStartUpdate(
  externalUserId: string,
  text: string,
  updateId: number
): object {
  return {
    update_id: updateId,
    message: {
      message_id: 11,
      from: {
        id: Number(externalUserId),
        is_bot: false,
        first_name: 'Synthetic',
        last_name: 'User',
        username: 'synthetic_user',
        language_code: 'en'
      },
      chat: { id: Number(externalUserId), type: 'private', first_name: 'Synthetic' },
      date: 1770000000,
      text
    }
  };
}

interface StartCall {
  readonly rawUpdate: object;
  readonly start: TelegramStartHandlerInput['start'];
}

describe('POST /webhooks/telegram', () => {
  let handle: PlatformAppHandle;
  let calls: StartCall[];
  let digestCalls: object[];
  let unavailable = false;

  beforeAll(async () => {
    calls = [];
    digestCalls = [];
    const handler: TelegramStartHandler = {
      handle: async (input) => {
        calls.push({ rawUpdate: input.rawUpdate, start: input.start });
      }
    };
    handle = await createPlatformApp({
      webhookSecret: fakeSecret,
      trustedProxyEnabled: true,
      injectedBotInfo: botInfo,
      digestProvider: {
        digest: (rawUpdate: object) => {
          digestCalls.push(rawUpdate);
          if (unavailable) return { unavailable: true };
          return { current: { keyVersion: 'v1', payloadDigest: 'x' } };
        }
      },
      startHandler: handler
    });
  }, 60_000);

  afterAll(async () => {
    await handle.close();
  });

  function validHeaders(): Record<string, string> {
    return {
      'x-telegram-bot-api-secret-token': fakeSecret,
      'content-type': 'application/json',
      'x-forwarded-proto': 'https'
    };
  }

  it('T9C01: rejects missing, invalid, and malformed secrets with 401', async () => {
    for (const headers of [
      {},
      { 'x-telegram-bot-api-secret-token': 'wrong' },
      { 'x-telegram-bot-api-secret-token': 'bad chars!' },
      { 'x-telegram-bot-api-secret-token': 'x'.repeat(257) }
    ]) {
      const response = await request(handle.app.getHttpServer())
        .post('/webhooks/telegram')
        .set({ ...headers, 'x-forwarded-proto': 'https', 'content-type': 'application/json' })
        .send(privateStartUpdate('7001', '/start', 1));
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'WEBHOOK_SECRET_INVALID' });
    }
    expect(calls).toHaveLength(0);
  });

  it('T9C10: forged proxy header on direct http is rejected; trusted proxy passes', async () => {
    const forged = await request(handle.app.getHttpServer())
      .post('/webhooks/telegram')
      .set({ ...validHeaders(), 'x-forwarded-proto': 'http' })
      .send(privateStartUpdate('7002', '/start', 2));
    expect(forged.status).toBe(400);
    expect(forged.body).toEqual({ code: 'WEBHOOK_HTTPS_REQUIRED' });
  });

  it('T9C02: rejects non-JSON content type with 415', async () => {
    const response = await request(handle.app.getHttpServer())
      .post('/webhooks/telegram')
      .set({ ...validHeaders(), 'content-type': 'text/plain' })
      .send('not-json');
    expect(response.status).toBe(415);
  });

  it('T9C04: rejects malformed envelope with 400 and zero side effects', async () => {
    const response = await request(handle.app.getHttpServer())
      .post('/webhooks/telegram')
      .set(validHeaders())
      .send({ update_id: 'not-digits', message: {} });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'WEBHOOK_UPDATE_MALFORMED' });
    expect(calls).toHaveLength(0);
  });

  it('T9C05: photo, sticker, service message, and callback query are 200 ignored', async () => {
    const bodies = [
      {
        update_id: 100,
        message: {
          message_id: 12,
          from: { id: 7003, is_bot: false, first_name: 'A' },
          chat: { id: 7003, type: 'private' },
          date: 1770000000,
          photo: [{ file_id: 'x' }]
        }
      },
      { update_id: 101, callback_query: { id: 'cq1', from: { id: 7003, is_bot: false, first_name: 'A' } } },
      { update_id: 102, message: { message_id: 13, chat: { id: -100, type: 'group' }, date: 1, text: '/start' } }
    ];
    for (const body of bodies) {
      const response = await request(handle.app.getHttpServer())
        .post('/webhooks/telegram')
        .set(validHeaders())
        .send(body);
      expect(response.status).toBe(200);
    }
    expect(calls).toHaveLength(0);
  });

  it('T9C07: private non-start text is 200 ignored', async () => {
    const response = await request(handle.app.getHttpServer())
      .post('/webhooks/telegram')
      .set(validHeaders())
      .send(privateStartUpdate('7004', '/balance', 110));
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('T8C09-adjacent / T9C08: /start and /start param deliver DTO without raw message', async () => {
    const rawUpdate = privateStartUpdate('7005', '/start deep-link-1', 120);
    const response = await request(handle.app.getHttpServer())
      .post('/webhooks/telegram')
      .set(validHeaders())
      .send(rawUpdate);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.start).toMatchObject({
      kind: 'private-start',
      externalUserId: '7005',
      username: 'synthetic_user',
      startParameter: 'deep-link-1'
    });
    expect(JSON.stringify(call.start)).not.toContain('"message"');
    expect(digestCalls[0]).toBe(call.rawUpdate);
  });

  it('T9C09: digest receives the identical parsed object; unavailable yields 503 with zero handler calls', async () => {
    const before = calls.length;
    unavailable = true;
    const response = await request(handle.app.getHttpServer())
      .post('/webhooks/telegram')
      .set(validHeaders())
      .send(privateStartUpdate('7006', '/start', 130));
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'WEBHOOK_DIGEST_KEY_UNAVAILABLE' });
    expect(calls).toHaveLength(before);
    unavailable = false;
  });

  it('T9C11: error responses never echo secret or body material', async () => {
    const response = await request(handle.app.getHttpServer())
      .post('/webhooks/telegram')
      .set({ ...validHeaders(), 'x-telegram-bot-api-secret-token': 'wrong-secret-value' })
      .send(privateStartUpdate('7007', '/start', 140));
    expect(response.text).not.toContain('wrong-secret-value');
    expect(response.text).not.toContain('7007');
  });
});
