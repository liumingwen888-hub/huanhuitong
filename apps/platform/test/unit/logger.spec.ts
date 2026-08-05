import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createPlatformLogger } from '../../src/infrastructure/logging/create-platform-logger.js';

function capture() {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, done) { output += String(chunk); done(); }
  });
  return { destination, read: () => output };
}

describe('createPlatformLogger', () => {
  it('writes one flat allowlisted JSON record to the injected destination', () => {
    const sink = capture();
    const logger = createPlatformLogger(sink.destination);
    logger.info('app_configuration_loaded', {
      correlation_id: 'corr_platform_1', route: 'configuration',
      outcome: 'success', duration_ms: 12
    });
    const record = JSON.parse(sink.read()) as Record<string, unknown>;
    expect(record).toMatchObject({
      service: 'xht-platform', event: 'app_configuration_loaded',
      correlation_id: 'corr_platform_1', route: 'configuration', outcome: 'success', duration_ms: 12
    });
  });

  it.each([
    ['unknown_event', {}],
    ['toString', {}],
    ['process_started', { unknown_key: 'value' }],
    ['process_started', { [Symbol('secret')]: 'synthetic-secret' }],
    ['process_started', Object.defineProperty({}, 'route', {
      enumerable: true,
      get(): never { throw new Error('SECRET_GETTER_EXECUTED'); }
    })],
    ['process_started', { route: { nested: true } }],
    ['process_started', { route: ['bootstrap'] }],
    ['process_started', { route: 'bootstrap\nsecret' }],
    ['process_started', { correlation_id: `corr_${'x'.repeat(129)}` }],
    ['process_started', { duration_ms: Number.NaN }],
    ['process_started', { route: 'bootstrap' }],
    ['process_started', { route: 'telemetry', outcome: 'success' }],
    ['telemetry_disabled', { route: 'telemetry', outcome: 'configured' }],
    ['process_stopped', { route: 'bootstrap', outcome: 'success' }],
    ['app_configuration_rejected', { route: 'configuration', outcome: 'rejected' }]
  ])('rejects invalid runtime input without writing: %s', (event, context) => {
    const sink = capture();
    const logger = createPlatformLogger(sink.destination) as unknown as {
      info(inputEvent: unknown, inputContext: unknown): void;
    };
    expect(() => logger.info(event, context)).toThrowError(
      expect.objectContaining({ name: 'SafeLoggingError' })
    );
    expect(sink.read()).toBe('');
  });
});
