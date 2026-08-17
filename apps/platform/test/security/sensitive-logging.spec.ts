import { Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPlatformLogger } from '../../src/infrastructure/logging/create-platform-logger.js';
import { toTelegramUserReference } from '@xht/config';

function capture(): { destination: Writable; output(): string } {
  let buffer = '';
  const destination = new Writable({
    write(chunk, _encoding, done) {
      buffer += String(chunk);
      done();
    }
  });
  return { destination, output: () => buffer };
}

const staticKey = new Uint8Array(32).fill(7);
const otherKey = new Uint8Array(32).fill(9);

describe('platform safe structured logging', () => {
  it('T11C01: emits only approved fields as a single JSON line', () => {
    const { destination, output } = capture();
    const logger = createPlatformLogger(destination);
    logger.info('telegram_webhook_processed', {
      correlation_id: 'corr_log_1',
      update_id: '9300',
      route: 'telegram.start',
      outcome: 'processed'
    });
    const unsafe = logger as unknown as {
      info(event: string, context: Record<string, unknown>): void;
    };
    expect(() =>
      unsafe.info('injection_attempt', {
        secret_token: 'fake-secret-value',
        bot_token: 'fake-bot-token',
        update: { message: { text: 'private-message-body' } },
        callback_query: 'raw-callback'
      })
    ).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    expect(output()).toContain('corr_log_1');
    for (const forbidden of [
      'fake-secret-value',
      'fake-bot-token',
      'private-message-body',
      'raw-callback'
    ]) {
      expect(output()).not.toContain(forbidden);
    }
    expect(output().trim().split('\n')).toHaveLength(1);
  });

  it('T11C02: unknown event/field yields zero new bytes', () => {
    const { destination, output } = capture();
    const logger = createPlatformLogger(destination);
    const unsafe = logger as unknown as {
      info(event: string, context: Record<string, unknown>): void;
    };
    logger.info('telegram_webhook_processed', {
      update_id: '9301',
      route: 'telegram.start',
      outcome: 'processed'
    });
    const accepted = output();
    expect(() =>
      unsafe.info('telegram_webhook_processed', {
        update_id: '9302',
        route: 'telegram.start',
        outcome: 'processed',
        bot_token: 'leak'
      })
    ).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    expect(output()).toBe(accepted);
  });

  it('T11C03: raw update material is rejected in every shape', () => {
    const { destination, output } = capture();
    const logger = createPlatformLogger(destination);
    const unsafe = logger as unknown as {
      info(event: string, context: Record<string, unknown>): void;
    };
    for (const context of [
      { update_id: JSON.stringify({ message: { text: 'body' } }) },
      { telegram_user_ref: 'x'.repeat(44) }
    ]) {
      expect(() =>
        unsafe.info('telegram_webhook_processed', {
          update_id: '9303',
          route: 'telegram.start',
          outcome: 'processed',
          ...context
        })
      ).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    }
    expect(output()).toBe('');
  });

  it('T11C04/05: nested, error objects, control characters and length fail closed', () => {
    const { destination, output } = capture();
    const logger = createPlatformLogger(destination);
    const unsafe = logger as unknown as {
      info(event: string, context: Record<string, unknown>): void;
    };
    const attempts: Array<Record<string, unknown>> = [
      { update_id: '9304', uid: { nested: true } },
      { update_id: '9304', uid: [1, 2] },
      { update_id: '9304', duration_ms: 'nope' as unknown as number },
      { update_id: '9\t004' },
      { update_id: '9304', inbox_id: 'not-a-uuid' },
      { update_id: '9304', retry_count: -1 },
      { update_id: '9304', telegram_user_ref: 'tgur-v1:short' }
    ];
    for (const extra of attempts) {
      expect(() =>
        unsafe.info('telegram_webhook_processed', {
          route: 'telegram.start',
          outcome: 'processed',
          ...extra
        })
      ).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    }
    expect(output()).toBe('');
  });

  it('T11C06: event-route/outcome mismatch fails closed', () => {
    const { destination, output } = capture();
    const logger = createPlatformLogger(destination);
    expect(() =>
      logger.info('telegram_webhook_processed', {
        update_id: '9305',
        route: 'bootstrap',
        outcome: 'processed'
      })
    ).toThrowError(/EVENT_POLICY_MISMATCH/);
    expect(output()).toBe('');
  });

  it('T11C14/15: pseudonym is deterministic, distinct per user and key-separated', async () => {
    const options = {
      resolver: {} as never,
      keySource: { kind: 'static' as const, key: staticKey }
    };
    const first = await toTelegramUserReference(options, '9001');
    const second = await toTelegramUserReference(options, '9001');
    const otherUser = await toTelegramUserReference(options, '9002');
    const otherKeyResult = await toTelegramUserReference(
      { ...options, keySource: { kind: 'static' as const, key: otherKey } },
      '9001'
    );
    expect(first).toBe(second);
    expect(first).not.toBe(otherUser);
    expect(first).not.toBe(otherKeyResult);
    expect(first).toMatch(/^tgur-v1:[A-Za-z0-9_-]{43}$/);
    const manual = `${'tgur-v1'}:${createHmac('sha256', staticKey)
      .update('9001')
      .digest('base64url')}`;
    expect(first).toBe(manual);
    expect(() =>
      toTelegramUserReference(options, 'not-a-number')
    ).rejects.toThrowError(/TELEGRAM_USER_ID_INVALID/);
  });

  it('T11C16: production sources contain no logging of sensitive identifiers', async () => {
    const projectRoot = resolve(import.meta.dirname, '../..');
    const files = [
      'src/infrastructure/logging/create-platform-logger.ts',
      'src/modules/telegram/http/telegram-webhook.controller.ts',
      'src/modules/telegram/application/handle-telegram-start.ts'
    ];
    for (const file of files) {
      const raw = await readFile(resolve(projectRoot, file), 'utf8');
      // The logger's own Pino redact path list legitimately names the
      // forbidden keys; strip it before asserting no other reference exists.
      const content = raw.replace(/redact:\s*\{[\s\S]*?\},?/u, '');
      expect(content.match(/bot_token|secret_token|canonicalBytes/u) ?? []).toEqual([]);
    }
  });
});
