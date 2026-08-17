import { createHmac } from 'node:crypto';
import { isProxy } from 'node:util/types';
import type {
  InboxDigestKey,
  InboxDigestKeyring
} from '@xht/config';
import type {
  InboxDigestCandidate,
  InboxDigestSet,
  InboxPayloadDigest
} from '@xht/contracts';

export type CanonicalTelegramUpdateErrorCode =
  | 'ROOT_NOT_OBJECT'
  | 'UNSUPPORTED_VALUE'
  | 'NON_FINITE_NUMBER'
  | 'SPARSE_ARRAY'
  | 'ACCESSOR_PROPERTY'
  | 'SYMBOL_PROPERTY'
  | 'NON_PLAIN_OBJECT'
  | 'CYCLIC_VALUE';

export class CanonicalTelegramUpdateError extends Error {
  constructor(readonly code: CanonicalTelegramUpdateErrorCode) {
    super(code);
    this.name = 'CanonicalTelegramUpdateError';
    Object.defineProperty(this, 'stack', {
      value: `CanonicalTelegramUpdateError: ${code}`,
      enumerable: false,
      writable: false,
      configurable: false
    });
    Object.freeze(this);
  }
}

Object.freeze(CanonicalTelegramUpdateError.prototype);

class CanonicalByteWriter {
  readonly #chunks: Buffer[] = [];
  #closed = false;

  write(text: string): void {
    if (this.#closed) {
      throw new CanonicalTelegramUpdateError('UNSUPPORTED_VALUE');
    }
    this.#chunks.push(Buffer.from(text, 'utf8'));
  }

  finish(): Buffer {
    if (this.#closed) {
      throw new CanonicalTelegramUpdateError('UNSUPPORTED_VALUE');
    }
    this.#closed = true;
    try {
      return Buffer.concat(this.#chunks);
    } finally {
      this.#clearChunks();
    }
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#clearChunks();
  }

  #clearChunks(): void {
    for (const chunk of this.#chunks) chunk.fill(0);
    this.#chunks.length = 0;
  }
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index]?.codePointAt(0);
    const rightPoint = rightPoints[index]?.codePointAt(0);
    if (leftPoint === undefined || rightPoint === undefined) break;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }
  return leftPoints.length - rightPoints.length;
}

function jsonString(value: string): string {
  return JSON.stringify(value);
}

function assertNoSymbolKeys(value: object): void {
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new CanonicalTelegramUpdateError('SYMBOL_PROPERTY');
  }
}

function writeArray(
  value: readonly unknown[],
  writer: CanonicalByteWriter,
  active: WeakSet<object>
): void {
  assertNoSymbolKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownNames = Object.getOwnPropertyNames(value);
  if (
    ownNames.some((name) =>
      name !== 'length' &&
      !Number.isSafeInteger(Number(name))
    )
  ) {
    throw new CanonicalTelegramUpdateError('UNSUPPORTED_VALUE');
  }
  writer.write('[');
  for (let index = 0; index < value.length; index += 1) {
    const name = String(index);
    if (!Object.prototype.hasOwnProperty.call(descriptors, name)) {
      throw new CanonicalTelegramUpdateError('SPARSE_ARRAY');
    }
    const descriptor = descriptors[name];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new CanonicalTelegramUpdateError('ACCESSOR_PROPERTY');
    }
    if (index > 0) writer.write(',');
    writeValue(descriptor.value, writer, active);
  }
  if (ownNames.some((name) =>
    name !== 'length' &&
    (String(Number(name)) !== name || Number(name) >= value.length)
  )) {
    throw new CanonicalTelegramUpdateError('UNSUPPORTED_VALUE');
  }
  writer.write(']');
}

function writeObject(
  value: object,
  writer: CanonicalByteWriter,
  active: WeakSet<object>
): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalTelegramUpdateError('NON_PLAIN_OBJECT');
  }
  assertNoSymbolKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort(compareCodePoints);
  writer.write('{');
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) {
      throw new CanonicalTelegramUpdateError('UNSUPPORTED_VALUE');
    }
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new CanonicalTelegramUpdateError('ACCESSOR_PROPERTY');
    }
    if (index > 0) writer.write(',');
    writer.write(jsonString(key));
    writer.write(':');
    writeValue(descriptor.value, writer, active);
  }
  writer.write('}');
}

function writeValue(
  value: unknown,
  writer: CanonicalByteWriter,
  active: WeakSet<object>
): void {
  if (value === null) {
    writer.write('null');
    return;
  }
  if (typeof value === 'string') {
    writer.write(jsonString(value));
    return;
  }
  if (typeof value === 'boolean') {
    writer.write(value ? 'true' : 'false');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalTelegramUpdateError('NON_FINITE_NUMBER');
    }
    writer.write(Object.is(value, -0) ? '0' : JSON.stringify(value));
    return;
  }
  if (typeof value !== 'object') {
    throw new CanonicalTelegramUpdateError('UNSUPPORTED_VALUE');
  }
  if (isProxy(value)) {
    throw new CanonicalTelegramUpdateError('UNSUPPORTED_VALUE');
  }
  if (active.has(value)) {
    throw new CanonicalTelegramUpdateError('CYCLIC_VALUE');
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      writeArray(value, writer, active);
    } else {
      writeObject(value, writer, active);
    }
  } finally {
    active.delete(value);
  }
}

function canonicalizeTelegramUpdate(update: unknown): Buffer {
  if (
    typeof update === 'object' &&
    update !== null &&
    isProxy(update)
  ) {
    throw new CanonicalTelegramUpdateError('UNSUPPORTED_VALUE');
  }
  if (
    typeof update !== 'object' ||
    update === null ||
    Array.isArray(update)
  ) {
    throw new CanonicalTelegramUpdateError('ROOT_NOT_OBJECT');
  }
  const writer = new CanonicalByteWriter();
  try {
    writeObject(update, writer, new WeakSet<object>());
    return writer.finish();
  } catch (error: unknown) {
    writer.dispose();
    throw error;
  }
}

function digestWithKey(
  key: InboxDigestKey,
  canonicalBytes: Uint8Array
): InboxDigestCandidate {
  return key.withMaterial((material) => Object.freeze({
    keyVersion: key.version,
    payloadDigest: (
      'hmac-sha256:' +
      createHmac('sha256', material)
        .update(canonicalBytes)
        .digest('base64url')
    ) as InboxPayloadDigest
  }));
}

export function digestTelegramUpdate(
  update: unknown,
  keyring: InboxDigestKeyring
): InboxDigestSet {
  const canonicalBytes = canonicalizeTelegramUpdate(update);
  try {
    const current = digestWithKey(keyring.current, canonicalBytes);
    const candidates = Object.freeze([
      current,
      ...keyring.retained.map((key) =>
        digestWithKey(key, canonicalBytes)
      )
    ]);
    return Object.freeze({
      current,
      comparisonCandidates: candidates
    });
  } finally {
    canonicalBytes.fill(0);
  }
}
