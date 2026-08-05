import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createWorkerLogger } from '../../src/infrastructure/logging/create-worker-logger.js';

function capture() {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, done) { output += String(chunk); done(); }
  });
  return { destination, read: () => output };
}

describe('createWorkerLogger', () => {
  it('writes the worker service name and approved fields only', () => {
    const sink = capture();
    const logger = createWorkerLogger(sink.destination);
    logger.warn('telemetry_disabled', {
      correlation_id: 'corr_worker_1', route: 'telemetry', outcome: 'disabled'
    });
    expect(JSON.parse(sink.read())).toMatchObject({
      service: 'xht-worker', event: 'telemetry_disabled',
      correlation_id: 'corr_worker_1', route: 'telemetry', outcome: 'disabled'
    });
  });

  it('rejects an Error, byte array, and secret-shaped unknown field before Pino', () => {
    const sink = capture();
    const logger = createWorkerLogger(sink.destination) as unknown as {
      error(inputEvent: unknown, inputContext: unknown): void;
    };
    for (const context of [
      { error_category: new Error('synthetic-secret') },
      { correlation_id: new Uint8Array([1, 2, 3]) },
      { secret_token: 'synthetic-secret' }
    ]) {
      expect(() => logger.error('app_configuration_rejected', context)).toThrowError(
        expect.objectContaining({ name: 'SafeLoggingError' })
      );
    }
    expect(sink.read()).toBe('');
  });

  it.each([
    ['telemetry_configured', { outcome: 'configured' }],
    ['telemetry_configured', { route: 'configuration', outcome: 'configured' }],
    ['app_configuration_loaded', { route: 'configuration', outcome: 'rejected' }],
    ['app_configuration_rejected', {
      route: 'configuration', outcome: 'rejected', error_category: 'invalid_log_entry',
      duration_ms: 1
    }]
  ])('throws for missing or mismatched event policy without writing: %s', (event, context) => {
    const sink = capture();
    const logger = createWorkerLogger(sink.destination) as unknown as {
      info(inputEvent: unknown, inputContext: unknown): void;
    };
    expect(() => logger.info(event, context)).toThrowError(
      expect.objectContaining({ name: 'SafeLoggingError' })
    );
    expect(sink.read()).toBe('');
  });
});
