import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  SecretReferenceError,
  SecretResolutionError,
  createSecretResolver,
  parseEnvironment,
  parseSecretReference,
  withResolvedSecret
} from '../src/index.js';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL_REF: 'env://XHT_TEST_DATABASE_URL',
  TELEGRAM_WEBHOOK_SECRET_REF: 'env://XHT_TEST_TELEGRAM_WEBHOOK_SECRET',
  INBOX_DIGEST_KEYRING_REF: 'file:///run/secrets/xht/inbox-keyring.json',
  INBOX_RETENTION_SECONDS: '2592000',
  TELEGRAM_RETRY_WINDOW_SECONDS: '86400',
  OTEL_EXPORTER: 'disabled'
} as const;

const syntheticRoot = path.resolve('synthetic-secret-root');

describe('parseEnvironment', () => {
  it('projects known keys before strict parsing and preserves branded references', () => {
    const parsed = parseEnvironment({ ...validEnvironment, PATH: 'ignored', SYSTEMROOT: 'ignored' });
    expect(parsed.nodeEnv).toBe('test');
    expect(parsed.databaseUrlRef).toBe('env://XHT_TEST_DATABASE_URL');
    expect(parsed.telegramWebhookSecretRef).toBe('env://XHT_TEST_TELEGRAM_WEBHOOK_SECRET');
    expect(parsed.inboxDigestKeyringRef).toBe('file:///run/secrets/xht/inbox-keyring.json');
    expect(parsed.otel).toEqual({ mode: 'disabled' });
  });

  it.each([
    [{ ...validEnvironment, DATABASE_URL_REF: undefined }, 'configuration_invalid'],
    [{ ...validEnvironment, DATABASE_URL_REF: 'postgresql://db.example.invalid/xht' }, 'configuration_invalid'],
    [{ ...validEnvironment, INBOX_RETENTION_SECONDS: '3.14' }, 'configuration_invalid'],
    [{ ...validEnvironment, INBOX_RETENTION_SECONDS: '86399' }, 'configuration_invalid'],
    [{ ...validEnvironment, INBOX_RETENTION_SECONDS: '7776001' }, 'configuration_invalid'],
    [{ ...validEnvironment, TELEGRAM_RETRY_WINDOW_SECONDS: '0' }, 'configuration_invalid'],
    [{ ...validEnvironment, TELEGRAM_RETRY_WINDOW_SECONDS: '604801' }, 'configuration_invalid'],
    [{ ...validEnvironment, OTEL_EXPORTER: 'disabled', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.invalid' }, 'configuration_invalid'],
    [{ ...validEnvironment, OTEL_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_ENDPOINT: undefined }, 'configuration_invalid'],
    [{ ...validEnvironment, OTEL_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example' }, 'configuration_invalid']
  ])('rejects missing, literal, malformed, or out-of-range application values', (input, code) => {
    expect(() => parseEnvironment(input)).toThrowError(expect.objectContaining({ code }));
  });

  it('accepts an injected OTLP boundary without opening a connection', () => {
    expect(parseEnvironment({
      ...validEnvironment,
      OTEL_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/v1/traces'
    }).otel).toEqual({ mode: 'otlp', endpoint: 'https://collector.example/v1/traces' });
  });
});

describe('SecretReference', () => {
  it.each([
    'env://XHT_DATABASE_URL',
    'file:///run/secrets/xht/database-url',
    'file:///C:/ProgramData/HuanHuiTong/secrets/key'
  ])('accepts a canonical reference: %s', value => {
    expect(parseSecretReference(value)).toBe(value);
  });

  it.each([
    'literal-secret',
    'env://lowercase',
    'env://9INVALID',
    'file://server/share/secret',
    'file:///run/secrets/../private',
    'file:///run/secrets/./private',
    'file:///run//secrets/private',
    'file:///run/secrets/%2e%2e/private',
    'file:///run\\secrets\\private',
    'file:///run/secrets/private?version=1',
    'file:///run/secrets/private#fragment',
    'file:///C:',
    'file:///1:/ProgramData/HuanHuiTong/secrets/key',
    'file:///CC:/ProgramData/HuanHuiTong/secrets/key',
    'file:///C::/ProgramData/HuanHuiTong/secrets/key',
    'file:///C|/ProgramData/HuanHuiTong/secrets/key',
    'https://example.invalid/secret'
  ])('rejects a literal or illegal reference without echoing it: %s', value => {
    let thrown: unknown;
    try { parseSecretReference(value); } catch (error: unknown) { thrown = error; }
    expect(thrown).toBeInstanceOf(SecretReferenceError);
    expect(String(thrown)).not.toContain(value);
  });
});

describe('SecretResolver', () => {
  it('resolves env bytes for one bounded lifetime and clears them on dispose', async () => {
    const resolver = createSecretResolver({
      environment: { XHT_TEST_SECRET: 'synthetic-value' },
      allowedFileRoots: [syntheticRoot]
    });
    const reference = parseSecretReference('env://XHT_TEST_SECRET');
    let borrowed: Uint8Array | undefined;
    const value = await withResolvedSecret(resolver, reference, bytes => {
      borrowed = bytes;
      return new TextDecoder().decode(bytes);
    });
    expect(value).toBe('synthetic-value');
    expect(borrowed === undefined ? [] : [...borrowed]).toEqual(new Array(15).fill(0));
    resolver.dispose();
    await expect(resolver.resolve(reference)).rejects.toMatchObject({ code: 'RESOLVER_CLOSED' });
  });

  it.each([
    ['synchronous throw', (bytes: Uint8Array): never => {
      throw new Error(`synthetic-consumer-failure-${bytes.byteLength}`);
    }],
    ['asynchronous rejection', async (bytes: Uint8Array): Promise<never> => {
      await Promise.resolve(bytes.byteLength);
      throw new Error('synthetic-async-consumer-failure');
    }]
  ])('clears resolved bytes after a %s', async (_caseName, consumer) => {
    const resolver = createSecretResolver({
      environment: { XHT_TEST_SECRET: 'synthetic-value' },
      allowedFileRoots: [syntheticRoot]
    });
    const reference = parseSecretReference('env://XHT_TEST_SECRET');
    let borrowed: Uint8Array | undefined;
    await expect(withResolvedSecret(resolver, reference, bytes => {
      borrowed = bytes;
      return consumer(bytes);
    })).rejects.toThrow();
    expect(borrowed === undefined ? [] : [...borrowed]).toEqual(new Array(15).fill(0));
  });

  it('allows injected POSIX and Windows canonical files and rejects a symlink escape', async () => {
    const reads: string[] = [];
    const allowedRoot = path.resolve(syntheticRoot, 'allowed');
    const posixPath = path.join(allowedRoot, 'database-url');
    const windowsPath = path.join(allowedRoot, 'windows-key');
    const resolver = createSecretResolver({
      environment: {},
      allowedFileRoots: [allowedRoot],
      fileUrlToPath: input => {
        const value = String(input);
        if (value === 'file:///run/secrets/xht/database-url') return posixPath;
        if (value === 'file:///C:/ProgramData/HuanHuiTong/secrets/key') return windowsPath;
        if (value === 'file:///run/secrets/xht/escape') return path.join(allowedRoot, 'escape');
        throw new Error('UNEXPECTED_TEST_FILE_URL');
      },
      realpath: async input => input.endsWith('escape')
        ? path.resolve(allowedRoot, '..', '..', 'outside-secret')
        : input,
      readFile: async input => { reads.push(input); return new TextEncoder().encode('file-secret'); }
    });
    const posixValue = await withResolvedSecret(
      resolver,
      parseSecretReference('file:///run/secrets/xht/database-url'),
      bytes => new TextDecoder().decode(bytes)
    );
    const windowsValue = await withResolvedSecret(
      resolver,
      parseSecretReference('file:///C:/ProgramData/HuanHuiTong/secrets/key'),
      bytes => new TextDecoder().decode(bytes)
    );
    expect(posixValue).toBe('file-secret');
    expect(windowsValue).toBe('file-secret');
    expect(reads).toEqual([posixPath, windowsPath]);
    await expect(resolver.resolve(
      parseSecretReference('file:///run/secrets/xht/escape')
    )).rejects.toMatchObject({ code: 'FILE_PATH_FORBIDDEN' });
  });

  it('classifies missing, empty, and oversized secrets without including secret data', async () => {
    const missing = createSecretResolver({ environment: {}, allowedFileRoots: [syntheticRoot] });
    await expect(missing.resolve(parseSecretReference('env://XHT_MISSING')))
      .rejects.toMatchObject({ code: 'ENV_NOT_FOUND' });
    const empty = createSecretResolver({ environment: { XHT_EMPTY: '' }, allowedFileRoots: [syntheticRoot] });
    await expect(empty.resolve(parseSecretReference('env://XHT_EMPTY')))
      .rejects.toMatchObject({ code: 'EMPTY_SECRET' });
    const large = createSecretResolver({
      environment: { XHT_LARGE: 'x'.repeat(65_537) }, allowedFileRoots: [syntheticRoot]
    });
    await expect(large.resolve(parseSecretReference('env://XHT_LARGE')))
      .rejects.toMatchObject({ code: 'SECRET_TOO_LARGE' });
    expect(String(new SecretResolutionError('ENV_NOT_FOUND'))).toBe('SecretResolutionError: ENV_NOT_FOUND');
  });
});
