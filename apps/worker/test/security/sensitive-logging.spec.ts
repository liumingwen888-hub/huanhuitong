import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createWorkerLogger } from '../../src/infrastructure/logging/create-worker-logger.js';

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

describe('worker safe structured logging', () => {
  it('T11C11/12/13: accepted entries emit; every rejection writes zero bytes', () => {
    const { destination, output } = capture();
    const logger = createWorkerLogger(destination) as unknown as {
      warn(event: unknown, context: unknown): void;
    };
    logger.warn('telegram_webhook_rejected', {
      correlation_id: 'corr_worker_reject_1',
      update_id: '9301',
      route: 'telegram.start',
      outcome: 'rejected',
      error_category: 'telegram_update_invalid'
    });
    const accepted = output();
    expect(accepted).toContain('corr_worker_reject_1');
    expect(() =>
      logger.warn('telegram_webhook_rejected', {
        route: 'telegram.start',
        outcome: 'rejected',
        error_category: 'telegram_update_invalid'
      })
    ).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    expect(() =>
      logger.warn('telegram_webhook_rejected', {
        correlation_id: 'corr_worker_reject_2',
        update_id: '9302',
        route: 'telegram.start',
        outcome: 'rejected',
        error_category: new Error('synthetic-secret')
      })
    ).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    expect(() =>
      logger.warn('injection_attempt', {
        route: 'telegram.start',
        outcome: 'rejected',
        error_category: 'telegram_update_invalid'
      })
    ).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    expect(output()).toBe(accepted);
    expect(output()).not.toContain('synthetic-secret');
    expect(output().trim().split('\n')).toHaveLength(1);
  });

  it('unknown fields carrying secrets never reach the destination', () => {
    const { destination, output } = capture();
    const logger = createWorkerLogger(destination) as unknown as {
      info(event: unknown, context: unknown): void;
    };
    expect(() =>
      logger.info('telegram_webhook_processed', {
        update_id: '9303',
        route: 'telegram.start',
        outcome: 'processed',
        bot_token: 'synthetic-bot-token'
      })
    ).toThrowError(expect.objectContaining({ name: 'SafeLoggingError' }));
    expect(output()).toBe('');
  });
});
