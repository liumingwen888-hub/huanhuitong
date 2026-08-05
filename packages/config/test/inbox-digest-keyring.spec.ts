import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ResolvedSecret,
  type SecretResolver,
  InboxDigestKeyringError,
  parseSecretReference,
  resolveInboxDigestKeyring
} from '../src/index.js';

const currentMaterial = Buffer.alloc(32, 2).toString('base64url');
const retainedMaterial = Buffer.alloc(32, 1).toString('base64url');
const reference = parseSecretReference('env://XHT_TEST_INBOX_DIGEST_KEYRING');
const now = new Date('2026-07-21T12:00:00.000Z');

afterEach(() => vi.restoreAllMocks());

function validPayload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    keys: [
      {
        version: 'v2', status: 'current', material: currentMaterial,
        activatedAt: '2026-07-21T00:00:00.000Z'
      },
      {
        version: 'v1', status: 'retained', material: retainedMaterial,
        activatedAt: '2026-06-01T00:00:00.000Z',
        retainedAt: '2026-07-21T00:00:00.000Z',
        retireNotBefore: '2026-08-21T00:00:00.000Z'
      }
    ]
  };
}

function resolverForRaw(raw: Uint8Array, evidence?: { raw?: Uint8Array; disposed?: boolean }): SecretResolver {
  return {
    async resolve(): Promise<ResolvedSecret> {
      if (evidence !== undefined) evidence.raw = raw;
      return {
        async withBytes<T>(consumer: (bytes: Uint8Array) => T | Promise<T>): Promise<T> {
          return consumer(raw);
        },
        dispose(): void {
          raw.fill(0);
          if (evidence !== undefined) evidence.disposed = true;
        }
      };
    },
    dispose(): void {}
  };
}

function resolverFor(payload: unknown, evidence?: { raw?: Uint8Array; disposed?: boolean }): SecretResolver {
  return resolverForRaw(new TextEncoder().encode(JSON.stringify(payload)), evidence);
}

async function resolvePayload(payload: unknown, at = now) {
  return resolveInboxDigestKeyring({
    reference,
    inboxRetentionSeconds: 2_592_000,
    telegramRetryWindowSeconds: 86_400,
    now: at
  }, resolverFor(payload));
}

describe('resolveInboxDigestKeyring', () => {
  it('parses one current and retained keys, disposes raw bytes, forbids serialization, and zeroes material', async () => {
    const evidence: { raw?: Uint8Array; disposed?: boolean } = {};
    const keyring = await resolveInboxDigestKeyring({
      reference,
      inboxRetentionSeconds: 2_592_000,
      telegramRetryWindowSeconds: 86_400,
      now
    }, resolverFor(validPayload(), evidence));
    expect(keyring.current.version).toBe('v2');
    expect(keyring.retained.map(key => key.version)).toEqual(['v1']);
    expect(evidence.disposed).toBe(true);
    expect(evidence.raw === undefined ? [] : [...evidence.raw]).toEqual(
      new Array(evidence.raw?.length ?? 0).fill(0)
    );
    expect(typeof keyring.current.activatedAt).toBe('string');
    expect(Object.isFrozen(keyring)).toBe(true);
    expect(Object.isFrozen(keyring.current)).toBe(true);
    expect(Object.isFrozen(keyring.retained)).toBe(true);
    let firstBorrowed: Uint8Array | undefined;
    expect(keyring.current.withMaterial(bytes => {
      firstBorrowed = bytes;
      bytes.fill(9);
      return bytes.byteLength;
    })).toBe(32);
    expect(firstBorrowed === undefined ? [] : [...firstBorrowed]).toEqual(new Array(32).fill(0));
    expect(keyring.current.withMaterial(bytes => [...bytes])).toEqual(new Array(32).fill(2));
    const retained = keyring.retained[0];
    if (retained === undefined) throw new Error('MISSING_RETAINED_TEST_KEY');
    expect(retained.withMaterial(bytes => {
      bytes.fill(7);
      return bytes.byteLength;
    })).toBe(32);
    expect(() => JSON.stringify(keyring)).toThrowError(
      expect.objectContaining({ code: 'SERIALIZATION_FORBIDDEN' })
    );
    expect(inspect(keyring)).toBe('[InboxDigestKeyring redacted]');
    expect(inspect(keyring.current)).not.toContain(currentMaterial);
    expect(() => JSON.stringify(keyring.current)).toThrowError(
      expect.objectContaining({ code: 'SERIALIZATION_FORBIDDEN' })
    );
    keyring.dispose();
    keyring.dispose();
    expect(() => keyring.current.withMaterial(() => 1)).toThrowError(
      expect.objectContaining({ code: 'KEYRING_DISPOSED' })
    );
  });

  it('zeroes each borrowed material after consumer throw without changing internal material', async () => {
    const keyring = await resolvePayload(validPayload());
    let borrowed: Uint8Array | undefined;
    expect(() => keyring.current.withMaterial(bytes => {
      borrowed = bytes;
      bytes.fill(8);
      throw new Error('synthetic-borrow-failure');
    })).toThrow('synthetic-borrow-failure');
    expect(borrowed === undefined ? [] : [...borrowed]).toEqual(new Array(32).fill(0));
    expect(keyring.current.withMaterial(bytes => [...bytes])).toEqual(new Array(32).fill(2));
    keyring.dispose();
  });

  it.each([
    ['CURRENT_COUNT', { ...validPayload(), keys: [] }],
    ['CURRENT_COUNT', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v3', status: 'current', material: Buffer.alloc(32, 3).toString('base64url'), activatedAt: '2026-07-21T01:00:00.000Z' }
    ] }],
    ['DUPLICATE_VERSION', { ...validPayload(), keys: [
      ...(validPayload().keys as object[]),
      { version: 'v1', status: 'retained', material: Buffer.alloc(32, 4).toString('base64url'), activatedAt: '2026-05-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] }],
    ['KEY_TOO_SHORT', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: Buffer.alloc(31, 2).toString('base64url'), activatedAt: '2026-07-21T00:00:00.000Z' }
    ] }],
    ['KEY_TOO_LONG', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: Buffer.alloc(65, 2).toString('base64url'), activatedAt: '2026-07-21T00:00:00.000Z' }
    ] }],
    ['NON_CANONICAL_MATERIAL', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: 'A', activatedAt: '2026-07-21T00:00:00.000Z' }
    ] }],
    ['DUPLICATE_MATERIAL', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: currentMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] }],
    ['CURRENT_VERSION_NOT_HIGHEST', { ...validPayload(), keys: [
      { version: 'v1', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v2', status: 'retained', material: retainedMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] }],
    ['RETENTION_WINDOW_TOO_SHORT', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-20T23:59:59.000Z' }
    ] }],
    ['INVALID_SCHEMA', { ...validPayload(), unexpected: true }]
  ])('rejects invalid keyring with stable code %s', async (code, payload) => {
    await expect(resolvePayload(payload)).rejects.toMatchObject({ code });
  });

  it.each([
    ['NON_CANONICAL_MATERIAL', 'A', 0],
    ['KEY_TOO_SHORT', Buffer.alloc(31, 2).toString('base64url'), 31],
    ['KEY_TOO_LONG', Buffer.alloc(65, 2).toString('base64url'), 65]
  ])('clears the sole decoded Buffer after %s', async (code, material, byteLength) => {
    const fillSpy = vi.spyOn(Buffer.prototype, 'fill');
    await expect(resolvePayload({ ...validPayload(), keys: [
      { version: 'v2', status: 'current', material, activatedAt: '2026-07-21T00:00:00.000Z' }
    ] })).rejects.toMatchObject({ code });
    expect(fillSpy.mock.contexts.some((context, index) =>
      fillSpy.mock.calls[index]?.[0] === 0 && (context as Buffer).byteLength === byteLength
    )).toBe(true);
  });

  it('rejects duplicate material before decoding and still clears raw Secret bytes', async () => {
    const evidence: { raw?: Uint8Array; disposed?: boolean } = {};
    const payload = { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: currentMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] };
    await expect(resolveInboxDigestKeyring({
      reference,
      inboxRetentionSeconds: 2_592_000,
      telegramRetryWindowSeconds: 86_400,
      now
    }, resolverFor(payload, evidence))).rejects.toMatchObject({ code: 'DUPLICATE_MATERIAL' });
    expect(evidence.disposed).toBe(true);
    expect(evidence.raw === undefined ? [] : [...evidence.raw]).toEqual(
      new Array(evidence.raw?.length ?? 0).fill(0)
    );
  });

  it.each([
    ['INVALID_UTF8', Uint8Array.from([0xff, 0xfe])],
    ['INVALID_JSON', new TextEncoder().encode('{"schemaVersion":')],
    ['INVALID_SCHEMA', new TextEncoder().encode('{"schemaVersion":1,"keys":[],"raw":"synthetic-raw-json"}')]
  ])('zeroes raw Secret bytes after %s', async (code, raw) => {
    const evidence: { raw?: Uint8Array; disposed?: boolean } = {};
    await expect(resolveInboxDigestKeyring({
      reference,
      inboxRetentionSeconds: 2_592_000,
      telegramRetryWindowSeconds: 86_400,
      now
    }, resolverForRaw(raw, evidence))).rejects.toMatchObject({ code });
    expect(evidence.disposed).toBe(true);
    expect(evidence.raw === undefined ? [] : [...evidence.raw]).toEqual(
      new Array(evidence.raw?.length ?? 0).fill(0)
    );
  });

  it.each([
    ['INVALID_NOW', { now: new Date(Number.NaN) }],
    ['INVALID_POLICY_VALUE', { inboxRetentionSeconds: Number.NaN }],
    ['INVALID_POLICY_VALUE', { inboxRetentionSeconds: Number.POSITIVE_INFINITY }],
    ['INVALID_POLICY_VALUE', { inboxRetentionSeconds: 86_400.5 }],
    ['INVALID_POLICY_VALUE', { inboxRetentionSeconds: -1 }],
    ['INVALID_POLICY_VALUE', { telegramRetryWindowSeconds: 604_801 }]
  ])('rejects invalid time or policy input with %s', async (code, override) => {
    await expect(resolveInboxDigestKeyring({
      reference,
      inboxRetentionSeconds: 2_592_000,
      telegramRetryWindowSeconds: 86_400,
      now,
      ...override
    }, resolverFor(validPayload()))).rejects.toMatchObject({ code });
  });

  it.each([
    [86_400, 1, '2026-07-22T00:00:01.000Z'],
    [7_776_000, 604_800, '2026-10-26T00:00:00.000Z']
  ])('accepts policy boundaries %i + %i', async (
    inboxRetentionSeconds,
    telegramRetryWindowSeconds,
    retireNotBefore
  ) => {
    const payload = { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore }
    ] };
    const keyring = await resolveInboxDigestKeyring({
      reference, inboxRetentionSeconds, telegramRetryWindowSeconds, now
    }, resolverFor(payload));
    expect(keyring.current.version).toBe('v2');
    keyring.dispose();
  });

  it.each([
    ['CURRENT_NOT_ACTIVE', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-22T00:00:00.000Z' }
    ] }],
    ['INVALID_ACTIVATION_ORDER', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-07-20T00:00:00.000Z', retainedAt: '2026-07-19T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] }],
    ['RETAINED_AFTER_CURRENT', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-22T01:00:00.000Z', retireNotBefore: '2026-08-22T01:00:00.000Z' }
    ] }],
    ['VERSION_ACTIVATION_ORDER', { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-06-01T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: retainedMaterial, activatedAt: '2026-07-01T00:00:00.000Z', retainedAt: '2026-07-01T00:00:00.000Z', retireNotBefore: '2026-08-01T00:00:00.000Z' }
    ] }]
  ])('rejects impossible key chronology with %s', async (code, payload) => {
    await expect(resolvePayload(payload)).rejects.toMatchObject({ code });
  });

  it('zeroes a valid earlier material and the failing later material', async () => {
    const fillSpy = vi.spyOn(Buffer.prototype, 'fill');
    const payload = { ...validPayload(), keys: [
      { version: 'v2', status: 'current', material: currentMaterial, activatedAt: '2026-07-21T00:00:00.000Z' },
      { version: 'v1', status: 'retained', material: Buffer.alloc(31, 1).toString('base64url'), activatedAt: '2026-06-01T00:00:00.000Z', retainedAt: '2026-07-21T00:00:00.000Z', retireNotBefore: '2026-08-21T00:00:00.000Z' }
    ] };
    await expect(resolvePayload(payload)).rejects.toMatchObject({ code: 'KEY_TOO_SHORT' });
    const clearedLengths = fillSpy.mock.contexts.flatMap((context, index) =>
      fillSpy.mock.calls[index]?.[0] === 0 ? [(context as Buffer).byteLength] : []
    );
    expect(clearedLengths).toEqual(expect.arrayContaining([31, 32]));
  });

  it('rejects a retained key at its destruction boundary', async () => {
    await expect(resolvePayload(validPayload(), new Date('2026-08-21T00:00:00.000Z')))
      .rejects.toMatchObject({ code: 'RETAINED_KEY_EXPIRED' });
  });

  it('never includes raw payload or material in strings, JSON, inspect, or snapshots', () => {
    const error = new InboxDigestKeyringError('INVALID_SCHEMA');
    expect(String(error)).toBe('InboxDigestKeyringError: INVALID_SCHEMA');
    expect(String(error)).not.toContain(currentMaterial);
    expect(JSON.stringify(error)).not.toContain(currentMaterial);
    expect(inspect(error)).not.toContain(currentMaterial);
    expect({ name: error.name, code: error.code }).toMatchInlineSnapshot(`
      {
        "code": "INVALID_SCHEMA",
        "name": "InboxDigestKeyringError",
      }
    `);
  });
});
