import { inspect } from 'node:util';
import { z } from 'zod';
import type { SecretReference } from './secret-reference.js';
import { type SecretResolver, withResolvedSecret } from './secret-resolver.js';

export type InboxDigestKeyVersion = `v${number}`;

export type InboxDigestKeyringErrorCode =
  | 'INVALID_UTF8'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'INVALID_NOW'
  | 'INVALID_POLICY_VALUE'
  | 'CURRENT_COUNT'
  | 'DUPLICATE_VERSION'
  | 'DUPLICATE_MATERIAL'
  | 'NON_CANONICAL_MATERIAL'
  | 'KEY_TOO_SHORT'
  | 'KEY_TOO_LONG'
  | 'CURRENT_VERSION_NOT_HIGHEST'
  | 'INVALID_ACTIVATION_ORDER'
  | 'CURRENT_NOT_ACTIVE'
  | 'RETAINED_AFTER_CURRENT'
  | 'VERSION_ACTIVATION_ORDER'
  | 'RETENTION_WINDOW_TOO_SHORT'
  | 'RETAINED_KEY_EXPIRED'
  | 'KEYRING_DISPOSED'
  | 'SERIALIZATION_FORBIDDEN';

export class InboxDigestKeyringError extends Error {
  public constructor(public readonly code: InboxDigestKeyringErrorCode) {
    super(code);
    this.name = 'InboxDigestKeyringError';
  }
}

export interface InboxDigestKey {
  readonly version: InboxDigestKeyVersion;
  readonly status: 'current' | 'retained';
  readonly activatedAt: string;
  readonly retainedAt: string | undefined;
  readonly retireNotBefore: string | undefined;
  withMaterial<T>(consumer: (material: Uint8Array) => T): T;
  toJSON(): never;
}

export interface InboxDigestKeyring {
  readonly current: InboxDigestKey;
  readonly retained: readonly InboxDigestKey[];
  dispose(): void;
  toJSON(): never;
}

export interface ResolveInboxDigestKeyringInput {
  readonly reference: SecretReference;
  readonly inboxRetentionSeconds: number;
  readonly telegramRetryWindowSeconds: number;
  readonly now: Date;
}

const versionPattern = /^v[1-9][0-9]{0,8}$/;
const materialPattern = /^[A-Za-z0-9_-]+$/;
const common = {
  version: z.string().regex(versionPattern),
  material: z.string().min(1),
  activatedAt: z.string().datetime({ offset: true })
};
const currentSchema = z.object({
  ...common,
  status: z.literal('current')
}).strict();
const retainedSchema = z.object({
  ...common,
  status: z.literal('retained'),
  retainedAt: z.string().datetime({ offset: true }),
  retireNotBefore: z.string().datetime({ offset: true })
}).strict();
const payloadSchema = z.object({
  schemaVersion: z.literal(1),
  keys: z.array(z.discriminatedUnion('status', [currentSchema, retainedSchema])).max(32)
}).strict();

class KeyMaterial {
  private disposed = false;
  readonly #bytes: Buffer;
  public constructor(bytes: Buffer) { this.#bytes = bytes; }
  public use<T>(consumer: (material: Uint8Array) => T): T {
    if (this.disposed) throw new InboxDigestKeyringError('KEYRING_DISPOSED');
    const borrowed = Buffer.from(this.#bytes);
    try { return consumer(borrowed); }
    finally { borrowed.fill(0); }
  }
  public dispose(): void {
    if (!this.disposed) this.#bytes.fill(0);
    this.disposed = true;
  }
}

class RuntimeInboxDigestKey implements InboxDigestKey {
  readonly #keyMaterial: KeyMaterial;
  public constructor(
    public readonly version: InboxDigestKeyVersion,
    public readonly status: 'current' | 'retained',
    public readonly activatedAt: string,
    keyMaterial: KeyMaterial,
    public readonly retainedAt: string | undefined,
    public readonly retireNotBefore: string | undefined
  ) {
    this.#keyMaterial = keyMaterial;
    Object.freeze(this);
  }
  public withMaterial<T>(consumer: (material: Uint8Array) => T): T {
    return this.#keyMaterial.use(consumer);
  }
  public dispose(): void { this.#keyMaterial.dispose(); }
  public toJSON(): never {
    throw new InboxDigestKeyringError('SERIALIZATION_FORBIDDEN');
  }
  public [inspect.custom](): string { return '[InboxDigestKey redacted]'; }
}

class RuntimeInboxDigestKeyring implements InboxDigestKeyring {
  public readonly current: RuntimeInboxDigestKey;
  public readonly retained: readonly RuntimeInboxDigestKey[];
  public constructor(
    current: RuntimeInboxDigestKey,
    retained: readonly RuntimeInboxDigestKey[]
  ) {
    this.current = current;
    this.retained = Object.freeze([...retained]);
    Object.freeze(this);
  }
  public dispose(): void {
    this.current.dispose();
    for (const key of this.retained) key.dispose();
  }
  public toJSON(): never {
    throw new InboxDigestKeyringError('SERIALIZATION_FORBIDDEN');
  }
  public [inspect.custom](): string { return '[InboxDigestKeyring redacted]'; }
}

function decodeMaterial(value: string): Buffer {
  if (!materialPattern.test(value) || value.includes('=')) {
    throw new InboxDigestKeyringError('NON_CANONICAL_MATERIAL');
  }
  const bytes = Buffer.from(value, 'base64url');
  let accepted = false;
  try {
    if (bytes.toString('base64url') !== value) {
      throw new InboxDigestKeyringError('NON_CANONICAL_MATERIAL');
    }
    if (bytes.byteLength < 32) throw new InboxDigestKeyringError('KEY_TOO_SHORT');
    if (bytes.byteLength > 64) throw new InboxDigestKeyringError('KEY_TOO_LONG');
    accepted = true;
    return bytes;
  } finally {
    if (!accepted) bytes.fill(0);
  }
}

function versionNumber(version: string): number { return Number(version.slice(1)); }
function timestamp(value: string): number { return new Date(value).getTime(); }

function retentionWindowMilliseconds(input: ResolveInboxDigestKeyringInput): number {
  const values = [input.inboxRetentionSeconds, input.telegramRetryWindowSeconds];
  if (!values.every(Number.isSafeInteger) ||
    input.inboxRetentionSeconds < 86_400 || input.inboxRetentionSeconds > 7_776_000 ||
    input.telegramRetryWindowSeconds < 1 || input.telegramRetryWindowSeconds > 604_800) {
    throw new InboxDigestKeyringError('INVALID_POLICY_VALUE');
  }
  const seconds = input.inboxRetentionSeconds + input.telegramRetryWindowSeconds;
  return seconds * 1000;
}

export async function resolveInboxDigestKeyring(
  input: ResolveInboxDigestKeyringInput,
  resolver: SecretResolver
): Promise<InboxDigestKeyring> {
  const nowMilliseconds = input.now instanceof Date ? input.now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMilliseconds)) throw new InboxDigestKeyringError('INVALID_NOW');
  const retentionMilliseconds = retentionWindowMilliseconds(input);
  const unknownPayload = await withResolvedSecret(resolver, input.reference, bytes => {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new InboxDigestKeyringError('INVALID_UTF8'); }
    try { return JSON.parse(text) as unknown; }
    catch { throw new InboxDigestKeyringError('INVALID_JSON'); }
  });
  const parsed = payloadSchema.safeParse(unknownPayload);
  if (!parsed.success) throw new InboxDigestKeyringError('INVALID_SCHEMA');
  const entries = parsed.data.keys;
  const currentEntries = entries.filter(entry => entry.status === 'current');
  if (currentEntries.length !== 1) throw new InboxDigestKeyringError('CURRENT_COUNT');
  const versions = entries.map(entry => entry.version);
  if (new Set(versions).size !== versions.length) throw new InboxDigestKeyringError('DUPLICATE_VERSION');
  const materialStrings = entries.map(entry => entry.material);
  if (new Set(materialStrings).size !== materialStrings.length) {
    throw new InboxDigestKeyringError('DUPLICATE_MATERIAL');
  }
  const currentEntry = currentEntries[0];
  if (currentEntry === undefined) throw new InboxDigestKeyringError('CURRENT_COUNT');
  if (entries.some(entry => versionNumber(entry.version) > versionNumber(currentEntry.version))) {
    throw new InboxDigestKeyringError('CURRENT_VERSION_NOT_HIGHEST');
  }
  const currentActivatedAt = timestamp(currentEntry.activatedAt);
  if (currentActivatedAt > nowMilliseconds) {
    throw new InboxDigestKeyringError('CURRENT_NOT_ACTIVE');
  }
  const byVersion = [...entries].sort(
    (left, right) => versionNumber(left.version) - versionNumber(right.version)
  );
  for (let index = 1; index < byVersion.length; index += 1) {
    const previous = byVersion[index - 1];
    const next = byVersion[index];
    if (previous === undefined || next === undefined) continue;
    if (timestamp(previous.activatedAt) >= timestamp(next.activatedAt)) {
      throw new InboxDigestKeyringError('VERSION_ACTIVATION_ORDER');
    }
  }
  for (const entry of entries) {
    if (entry.status !== 'retained') continue;
    const activatedAt = timestamp(entry.activatedAt);
    const retainedAt = timestamp(entry.retainedAt);
    const retireNotBefore = timestamp(entry.retireNotBefore);
    if (retainedAt < activatedAt) {
      throw new InboxDigestKeyringError('INVALID_ACTIVATION_ORDER');
    }
    if (retainedAt > currentActivatedAt) {
      throw new InboxDigestKeyringError('RETAINED_AFTER_CURRENT');
    }
    if (retireNotBefore < retainedAt + retentionMilliseconds) {
      throw new InboxDigestKeyringError('RETENTION_WINDOW_TOO_SHORT');
    }
    if (nowMilliseconds >= retireNotBefore) {
      throw new InboxDigestKeyringError('RETAINED_KEY_EXPIRED');
    }
  }

  const decoded: Buffer[] = [];
  try {
    const runtime = entries.map(entry => {
      const material = decodeMaterial(entry.material);
      decoded.push(material);
      return new RuntimeInboxDigestKey(
        entry.version as InboxDigestKeyVersion,
        entry.status,
        new Date(entry.activatedAt).toISOString(),
        new KeyMaterial(material),
        entry.status === 'retained' ? new Date(entry.retainedAt).toISOString() : undefined,
        entry.status === 'retained' ? new Date(entry.retireNotBefore).toISOString() : undefined
      );
    });
    const current = runtime.find(entry => entry.status === 'current');
    if (current === undefined) throw new InboxDigestKeyringError('CURRENT_COUNT');
    return new RuntimeInboxDigestKeyring(
      current,
      runtime.filter(entry => entry.status === 'retained')
        .sort((left, right) => versionNumber(right.version) - versionNumber(left.version))
    );
  } catch (error: unknown) {
    for (const bytes of decoded) bytes.fill(0);
    throw error;
  }
}
