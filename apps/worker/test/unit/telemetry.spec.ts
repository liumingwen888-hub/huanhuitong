import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OtlpExporterFactory, OtlpExporterRegistration } from '@xht/contracts';
import { createWorkerTelemetry } from '../../src/infrastructure/telemetry/create-worker-telemetry.js';

const require = createRequire(import.meta.url);
const http = require('node:http') as typeof import('node:http');
const https = require('node:https') as typeof import('node:https');
const net = require('node:net') as typeof import('node:net');
const dns = require('node:dns') as typeof import('node:dns');

function installNetworkGuards() {
  const forbidden = (..._arguments: unknown[]): never => { throw new Error('NETWORK_FORBIDDEN'); };
  const spies = [
    vi.spyOn(globalThis, 'fetch').mockImplementation(forbidden as typeof fetch),
    vi.spyOn(http, 'request').mockImplementation(forbidden as typeof http.request),
    vi.spyOn(https, 'request').mockImplementation(forbidden as typeof https.request),
    vi.spyOn(net, 'connect').mockImplementation(forbidden as typeof net.connect),
    vi.spyOn(dns, 'lookup').mockImplementation(forbidden as typeof dns.lookup)
  ];
  return { calls: () => spies.reduce((total, spy) => total + spy.mock.calls.length, 0) };
}

afterEach(() => vi.restoreAllMocks());

describe('createWorkerTelemetry', () => {
  it('keeps disabled mode no-op without factory registration or network', async () => {
    const network = installNetworkGuards();
    const registration: OtlpExporterRegistration = { shutdown: vi.fn(async () => undefined) };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    const telemetry = await createWorkerTelemetry({ mode: 'disabled' }, factory);
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.serviceName).toBe('xht-worker');
    telemetry.startSpan('telemetry.initialize').end();
    await telemetry.shutdown();
    expect(factory.register).not.toHaveBeenCalled();
    expect(registration.shutdown).not.toHaveBeenCalled();
    expect(network.calls()).toBe(0);
  });

  it('shares one pending shutdown result, closes spans immediately, and shuts down once', async () => {
    const network = installNetworkGuards();
    let releaseShutdown!: () => void;
    const shutdownGate = new Promise<void>(resolve => { releaseShutdown = resolve; });
    const registration: OtlpExporterRegistration = { shutdown: vi.fn(() => shutdownGate) };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    const telemetry = await createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, factory);
    expect(factory.register).toHaveBeenCalledWith({
      serviceName: 'xht-worker', endpoint: 'https://collector.example/v1/traces'
    });
    const first = telemetry.shutdown();
    const second = telemetry.shutdown();
    expect(second).toBe(first);
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
    );
    releaseShutdown();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(telemetry.shutdown()).toBe(first);
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
    expect(network.calls()).toBe(0);
  });

  it('shares one shutdown promise when the exporter synchronously reenters shutdown', async () => {
    let telemetry!: Awaited<ReturnType<typeof createWorkerTelemetry>>;
    let reentrantPromise!: Promise<void>;
    let reentered = false;
    const registration: OtlpExporterRegistration = {
      shutdown: vi.fn(() => {
        if (!reentered) {
          reentered = true;
          reentrantPromise = telemetry.shutdown();
        }
        return Promise.resolve();
      })
    };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    telemetry = await createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, factory);

    const first = telemetry.shutdown();
    expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
    );
    await Promise.resolve();
    const later = telemetry.shutdown();

    expect(reentrantPromise).toBe(first);
    expect(later).toBe(first);
    await expect(first).resolves.toBeUndefined();
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
  });

  it('rejects otlp without an injected factory', async () => {
    await expect(createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    })).rejects.toMatchObject({ code: 'EXPORTER_FACTORY_REQUIRED' });
  });

  it('maps exporter registration failures without leaking their body', async () => {
    const registrationFailure: OtlpExporterFactory = {
      register: vi.fn(async () => { throw new Error('synthetic-secret registration endpoint'); })
    };
    let thrown: unknown;
    try {
      await createWorkerTelemetry({
        mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
      }, registrationFailure);
    } catch (error: unknown) { thrown = error; }
    expect(thrown).toMatchObject({ code: 'EXPORTER_REGISTRATION_FAILED' });
    expect(String(thrown)).not.toContain('synthetic-secret');
  });

  it('shares one sticky shutdown failure without leaking its body or retrying', async () => {
    let rejectShutdown!: () => void;
    const shutdownGate = new Promise<void>((_resolve, reject) => {
      rejectShutdown = () => reject(new Error('synthetic-secret authorization header'));
    });
    const registration: OtlpExporterRegistration = { shutdown: vi.fn(() => shutdownGate) };
    const shutdownFailure: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    const telemetry = await createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, shutdownFailure);
    const first = telemetry.shutdown();
    const second = telemetry.shutdown();
    expect(second).toBe(first);
    const concurrent = Promise.allSettled([first, second]);
    rejectShutdown();
    const results = await concurrent;
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'EXPORTER_SHUTDOWN_FAILED' });
        expect(String(result.reason)).not.toContain('synthetic-secret');
      }
    }
    const third = telemetry.shutdown();
    expect(third).toBe(first);
    await expect(third).rejects.toMatchObject({ code: 'EXPORTER_SHUTDOWN_FAILED' });
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
  });

  it('shares one sticky failure when the exporter synchronously reenters shutdown', async () => {
    let telemetry!: Awaited<ReturnType<typeof createWorkerTelemetry>>;
    let reentrantPromise!: Promise<void>;
    let reentered = false;
    const registration: OtlpExporterRegistration = {
      shutdown: vi.fn(() => {
        if (!reentered) {
          reentered = true;
          reentrantPromise = telemetry.shutdown();
          void reentrantPromise.catch(() => undefined);
        }
        return Promise.reject(new Error('synthetic-secret authorization header'));
      })
    };
    const factory: OtlpExporterFactory = { register: vi.fn(async () => registration) };
    telemetry = await createWorkerTelemetry({
      mode: 'otlp', endpoint: 'https://collector.example/v1/traces'
    }, factory);

    const first = telemetry.shutdown();
    void first.catch(() => undefined);
    expect(() => telemetry.startSpan('telemetry.initialize')).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_CLOSED' })
    );
    await Promise.resolve();
    const later = telemetry.shutdown();

    expect(reentrantPromise).toBe(first);
    expect(later).toBe(first);
    const results = await Promise.allSettled([first, reentrantPromise, later]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'EXPORTER_SHUTDOWN_FAILED' });
        expect(String(result.reason)).not.toContain('synthetic-secret');
      }
    }
    expect(registration.shutdown).toHaveBeenCalledTimes(1);
  });
});
