import type {
  InboxDigestKey,
  InboxDigestKeyVersion,
  InboxDigestKeyring
} from '@xht/config';
import {
  InboxDigestKeyringError
} from '@xht/config';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  CanonicalTelegramUpdateError,
  digestTelegramUpdate
} from '../../src/modules/reliability/inbox/telegram-update-digest.js';

interface KeyEvidence {
  borrowed: Uint8Array[];
  calls: number;
}

function key(
  version: InboxDigestKeyVersion,
  status: 'current' | 'retained',
  byte: number,
  evidence: KeyEvidence = { borrowed: [], calls: 0 }
): InboxDigestKey {
  const internal = Buffer.alloc(32, byte);
  return Object.freeze({
    version,
    status,
    activatedAt: '2026-07-31T00:00:00.000Z',
    retainedAt: status === 'retained'
      ? '2026-07-31T00:00:00.000Z'
      : undefined,
    retireNotBefore: status === 'retained'
      ? '2026-09-01T00:00:00.000Z'
      : undefined,
    withMaterial<T>(consumer: (material: Uint8Array) => T): T {
      const borrowed = Buffer.from(internal);
      evidence.borrowed.push(borrowed);
      evidence.calls += 1;
      try {
        return consumer(borrowed);
      } finally {
        borrowed.fill(0);
      }
    },
    toJSON(): never {
      throw new InboxDigestKeyringError('SERIALIZATION_FORBIDDEN');
    }
  });
}

function keyring(
  current: InboxDigestKey = key('v2', 'current', 2),
  retained: readonly InboxDigestKey[] = []
): InboxDigestKeyring {
  let disposed = false;
  return Object.freeze({
    current: Object.freeze({
      ...current,
      withMaterial<T>(consumer: (material: Uint8Array) => T): T {
        if (disposed) throw new InboxDigestKeyringError('KEYRING_DISPOSED');
        return current.withMaterial(consumer);
      }
    }),
    retained: Object.freeze([...retained]),
    dispose(): void { disposed = true; },
    toJSON(): never {
      throw new InboxDigestKeyringError('SERIALIZATION_FORBIDDEN');
    }
  });
}

const vectorUpdate = {
  update_id: 9001,
  message: {
    text: '/start alpha',
    from: { id: 100 },
    chat: { id: 200 }
  }
};
const expectedVector =
  'hmac-sha256:_ok7DE_TalvbxgzGFS2aBYH0tIc4dWOhViegvxH8Ekg';

function digest(update: unknown): string {
  return digestTelegramUpdate(update, keyring()).current.payloadDigest;
}

function publicStrings(value: unknown): string[] {
  const seen = new Set<unknown>();
  const values: string[] = [];
  function visit(item: unknown): void {
    if (typeof item === 'string') values.push(item);
    if (typeof item !== 'object' || item === null || seen.has(item)) return;
    seen.add(item);
    for (const keyName of Reflect.ownKeys(item)) {
      try { visit(Reflect.get(item, keyName)); } catch { values.push('GETTER_THROW'); }
    }
  }
  visit(value);
  return values;
}

afterEach(() => vi.restoreAllMocks());

describe('Task 5 Telegram Update digest', () => {
  it('T5C01: fixed synthetic vector matches canonical HMAC', () => {
    const result = digestTelegramUpdate(vectorUpdate, keyring());
    expect(result.current).toEqual({
      keyVersion: 'v2',
      payloadDigest: expectedVector
    });
  });

  it('T5C02: object key order is equivalent at every depth', () => {
    expect(digest({ update_id: 1, message: { text: 'x', chat: { id: 2 } } }))
      .toBe(digest({ message: { chat: { id: 2 }, text: 'x' }, update_id: 1 }));
  });

  it('T5C03: array order remains significant', () => {
    expect(digest({ update_id: 1, values: [1, 2] }))
      .not.toBe(digest({ update_id: 1, values: [2, 1] }));
  });

  it('T5C04: strings retain whitespace case and escapes', () => {
    const base = digest({ update_id: 1, text: ' A\n' });
    expect(base).not.toBe(digest({ update_id: 1, text: 'A\n' }));
    expect(base).not.toBe(digest({ update_id: 1, text: ' a\n' }));
  });

  it('T5C05: Unicode normalization is not implicit', () => {
    expect(digest({ update_id: 1, text: '\u00e9' }))
      .not.toBe(digest({ update_id: 1, text: 'e\u0301' }));
  });

  it('T5C06: parsed number form is stable and negative zero is zero', () => {
    expect(digest({ update_id: 1, value: -0 }))
      .toBe(digest({ update_id: 1, value: 0 }));
    expect(digest({ update_id: 1, value: 1.25 }))
      .toMatch(/^hmac-sha256:[A-Za-z0-9_-]{43}$/u);
  });

  it('T5C07: null and booleans remain significant', () => {
    const nullDigest = digest({ update_id: 1, value: null });
    expect(nullDigest).not.toBe(digest({ update_id: 1, value: false }));
    expect(nullDigest).not.toBe(digest({ update_id: 1, value: true }));
  });

  it('T5C08: undefined object property is rejected rather than omitted', () => {
    expect(() => digest({ update_id: 1, value: undefined }))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VALUE' }));
  });

  it('T5C09: undefined array member is rejected rather than null', () => {
    expect(() => digest({ update_id: 1, value: [undefined] }))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VALUE' }));
  });

  it('T5C10: sparse arrays and every extra own property are rejected', () => {
    expect(() => digest({ update_id: 1, value: new Array(1) }))
      .toThrowError(expect.objectContaining({ code: 'SPARSE_ARRAY' }));

    const named: unknown[] = [];
    Object.defineProperty(named, 'extra', {
      value: 'hidden-difference', enumerable: true
    });
    const outOfRange: unknown[] = [];
    Object.defineProperty(outOfRange, '4294967295', {
      value: 'hidden-difference', enumerable: true
    });
    let getterCalls = 0;
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, 'extra', {
      enumerable: true,
      get(): string { getterCalls += 1; return 'hidden-difference'; }
    });
    for (const value of [named, outOfRange, accessor]) {
      let error: unknown;
      try { digest({ update_id: 1, value }); } catch (caught: unknown) {
        error = caught;
      }
      expect(error).toEqual(expect.objectContaining({
        code: 'UNSUPPORTED_VALUE'
      }));
      expect(publicStrings(error).join('|')).not.toContain('hidden-difference');
    }
    expect(getterCalls).toBe(0);
  });

  it('T5C11: non-JSON values are rejected with stable codes', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => digest({ update_id: 1, value }))
        .toThrowError(expect.objectContaining({ code: 'NON_FINITE_NUMBER' }));
    }
    for (const value of [1n, () => 1, Symbol('synthetic')]) {
      expect(() => digest({ update_id: 1, value }))
        .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VALUE' }));
    }
  });

  it('T5C12: unknown future fields participate in the digest', () => {
    const base = digest({ update_id: 1, message: { text: 'x' } });
    expect(base).not.toBe(digest({ update_id: 1, message: { text: 'x' }, future: 1 }));
    expect(base).not.toBe(digest({ update_id: 1, message: { text: 'x', future: 1 } }));
  });

  it('T5C13: Telegram content dimensions each change the digest', () => {
    const base = digest(vectorUpdate);
    const changes = [
      { ...vectorUpdate, update_id: 9002 },
      { ...vectorUpdate, message: { ...vectorUpdate.message, text: '/start beta' } },
      { ...vectorUpdate, message: { ...vectorUpdate.message, from: { id: 101 } } },
      { ...vectorUpdate, message: { ...vectorUpdate.message, chat: { id: 201 } } },
      { update_id: 9001, callback_query: { id: 'synthetic', data: 'next' } },
      { update_id: 9001, edited_message: vectorUpdate.message }
    ];
    expect(changes.map((value) => digest(value)))
      .toSatisfy((values: string[]) => values.every((value) => value !== base));
  });

  it('T5C14: non-plain objects and every Proxy reject before observation', () => {
    expect(() => digest(null)).toThrowError(
      expect.objectContaining({ code: 'ROOT_NOT_OBJECT' })
    );
    expect(() => digest([])).toThrowError(
      expect.objectContaining({ code: 'ROOT_NOT_OBJECT' })
    );
    expect(() => digest({ update_id: 1, value: new Date(0) }))
      .toThrowError(expect.objectContaining({ code: 'NON_PLAIN_OBJECT' }));

    let trapCalls = 0;
    let validDigests = 0;
    const sensitive = 'T5C14_PROXY_INPUT_SENTINEL';
    const handler: ProxyHandler<object> = {
      get(target, key, receiver) {
        trapCalls += 1;
        return Reflect.get(target, key, receiver);
      },
      getPrototypeOf(target) {
        trapCalls += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        trapCalls += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        trapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    };
    const cases: readonly unknown[] = [
      new Proxy({ update_id: 1, sensitive }, handler),
      { update_id: 1, nested: new Proxy({ sensitive }, handler) },
      { update_id: 1, nested: new Proxy([sensitive], handler) }
    ];
    for (const value of cases) {
      let error: unknown;
      try {
        digest(value);
        validDigests += 1;
      } catch (caught: unknown) {
        error = caught;
      }
      expect(error).toEqual(expect.objectContaining({ code: 'UNSUPPORTED_VALUE' }));
      expect(error).toBeInstanceOf(CanonicalTelegramUpdateError);
      expect(publicStrings(error).join('|')).not.toContain(sensitive);
    }
    expect(trapCalls).toBe(0);
    expect(validDigests).toBe(0);
  });

  it('T5C15: cycles reject while shared acyclic values serialize per position', () => {
    const cyclic: Record<string, unknown> = { update_id: 1 };
    cyclic['self'] = cyclic;
    expect(() => digest(cyclic)).toThrowError(
      expect.objectContaining({ code: 'CYCLIC_VALUE' })
    );
    const shared = { id: 1 };
    expect(() => digest({ update_id: 1, left: shared, right: shared })).not.toThrow();
  });

  it('T5C16: accessors reject without invoking the getter', () => {
    let calls = 0;
    const update = { update_id: 1 } as Record<string, unknown>;
    Object.defineProperty(update, 'secret', {
      enumerable: true,
      get(): string { calls += 1; return 'synthetic-raw'; }
    });
    expect(() => digest(update)).toThrowError(
      expect.objectContaining({ code: 'ACCESSOR_PROPERTY' })
    );
    expect(calls).toBe(0);
  });

  it('T5C17: symbol keys are rejected', () => {
    const update = { update_id: 1 } as Record<PropertyKey, unknown>;
    update[Symbol('synthetic')] = 'value';
    expect(() => digest(update)).toThrowError(
      expect.objectContaining({ code: 'SYMBOL_PROPERTY' })
    );
  });

  it('T5C18: current and retained versions appear exactly once', () => {
    const result = digestTelegramUpdate(vectorUpdate, keyring(
      key('v3', 'current', 3),
      [key('v2', 'retained', 2), key('v1', 'retained', 1)]
    ));
    expect(result.current.keyVersion).toBe('v3');
    expect(result.comparisonCandidates.map((value) => value.keyVersion))
      .toEqual(['v3', 'v2', 'v1']);
  });

  it('T5C19: withMaterial callbacks are synchronous and do not escape bytes', () => {
    const evidence: KeyEvidence = { borrowed: [], calls: 0 };
    const result = digestTelegramUpdate(vectorUpdate, keyring(
      key('v2', 'current', 2, evidence)
    ));
    expect(result.current.payloadDigest).toBe(expectedVector);
    expect(evidence.calls).toBe(1);
    expect(evidence.borrowed).toHaveLength(1);
  });

  it('T5C20: borrowed material clears after success without corrupting next use', () => {
    const evidence: KeyEvidence = { borrowed: [], calls: 0 };
    const current = key('v2', 'current', 2, evidence);
    expect(digestTelegramUpdate(vectorUpdate, keyring(current)).current.payloadDigest)
      .toBe(expectedVector);
    expect(evidence.borrowed[0] === undefined ? [] : [...evidence.borrowed[0]])
      .toEqual(new Array(32).fill(0));
    expect(digestTelegramUpdate(vectorUpdate, keyring(current)).current.payloadDigest)
      .toBe(expectedVector);
  });

  it('T5C21: key failure still clears borrowed and canonical buffers', () => {
    const fillSpy = vi.spyOn(Buffer.prototype, 'fill');
    let borrowed: Uint8Array | undefined;
    const throwing = key('v2', 'current', 2);
    const wrapped: InboxDigestKey = Object.freeze({
      ...throwing,
      withMaterial<T>(consumer: (material: Uint8Array) => T): T {
        return throwing.withMaterial((material) => {
          borrowed = material;
          consumer(material);
          throw new InboxDigestKeyringError('KEYRING_DISPOSED');
        });
      }
    });
    expect(() => digestTelegramUpdate(vectorUpdate, keyring(wrapped)))
      .toThrowError(expect.objectContaining({ code: 'KEYRING_DISPOSED' }));
    expect(borrowed === undefined ? [] : [...borrowed]).toEqual(new Array(32).fill(0));
    expect(fillSpy.mock.contexts.some((context, index) =>
      Buffer.isBuffer(context) &&
      fillSpy.mock.calls[index]?.[0] === 0 &&
      (context as Buffer).byteLength > 32
    )).toBe(true);
  });

  it('T5C22: digest DTO is frozen and carries no raw input or material', () => {
    const result = digestTelegramUpdate(vectorUpdate, keyring());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.current)).toBe(true);
    expect(Object.isFrozen(result.comparisonCandidates)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('/start alpha');
    expect(JSON.stringify(result)).not.toContain(Buffer.alloc(32, 2).toString('base64url'));
  });

  it('T5C23: disposed keyring error propagates without raw values', () => {
    const ring = keyring();
    ring.dispose();
    let error: unknown;
    try { digestTelegramUpdate(vectorUpdate, ring); } catch (value: unknown) { error = value; }
    expect(error).toEqual(expect.objectContaining({ code: 'KEYRING_DISPOSED' }));
    expect(publicStrings(error).join('|')).not.toContain('/start alpha');
  });

  it('T5C24: public errors do not expose raw callback digest or key material', () => {
    const update = { update_id: 1, callback_query: { data: 'synthetic-raw-callback' } };
    const cyclic = update as Record<string, unknown>;
    cyclic['self'] = cyclic;
    let error: unknown;
    try { digestTelegramUpdate(cyclic, keyring()); } catch (value: unknown) { error = value; }
    const text = publicStrings(error).join('|');
    expect(text).not.toContain('synthetic-raw-callback');
    expect(text).not.toContain('hmac-sha256:');
    expect(text).not.toContain(Buffer.alloc(32, 2).toString('base64url'));
    expect(error).toBeInstanceOf(CanonicalTelegramUpdateError);
  });
});
