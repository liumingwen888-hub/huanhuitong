import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';
import type {
  ChannelType,
  Uid
} from '@xht/contracts';
import { IdentityError } from './identity.errors.js';

const EXTERNAL_USER_ID_PATTERN = /^[1-9][0-9]{0,18}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const REGISTRATION_KEY_NAMESPACE =
  '74686b2e-0000-4000-8000-726567697372' as const;

function invalid(): never {
  throw new IdentityError('IDENTITY_COMMAND_INVALID');
}

function ownRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) invalid();
  if (isProxy(value)) invalid();
  if (Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  return value as Record<string, unknown>;
}

function field(source: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined || !('value' in descriptor)) invalid();
  return descriptor.value;
}

function stringField(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): string {
  const value = field(source, key);
  if (
    typeof value !== 'string' ||
    value.length < minimum ||
    value.length > maximum
  ) {
    invalid();
  }
  return value;
}

function nullableStringField(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): string | null {
  const value = field(source, key);
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length < minimum ||
    value.length > maximum
  ) {
    invalid();
  }
  return value;
}

export interface ChannelIdentityQuery {
  readonly channelType: ChannelType;
  readonly externalUserId: string;
}

export interface ProfileSnapshotInput {
  readonly username: string | null;
  readonly displayName: string | null;
}

export function parseChannelIdentityQuery(
  input: unknown
): ChannelIdentityQuery {
  const source = ownRecord(input);
  const channelType = field(source, 'channelType');
  const externalUserId = field(source, 'externalUserId');
  if (channelType !== 'telegram') invalid();
  if (
    typeof externalUserId !== 'string' ||
    !EXTERNAL_USER_ID_PATTERN.test(externalUserId)
  ) {
    invalid();
  }
  return Object.freeze({ channelType, externalUserId });
}

export function parseProfileSnapshot(input: unknown): ProfileSnapshotInput {
  const source = ownRecord(input);
  return Object.freeze({
    username: nullableStringField(source, 'username', 1, 64),
    displayName: nullableStringField(source, 'displayName', 1, 128)
  });
}

export interface RegistrationKey {
  readonly registrationKey: string;
  readonly channelType: ChannelType;
  readonly externalUserId: string;
}

const REGISTRATION_KEY_SOURCE_PREFIX = 'registration:v1:telegram:start:'; // — service-derived only

export function createRegistrationKey(
  channelType: ChannelType,
  externalUserId: string
): RegistrationKey {
  if (channelType !== 'telegram') {
    throw new IdentityError('IDENTITY_REGISTRATION_KEY_INVALID');
  }
  if (
    typeof externalUserId !== 'string' ||
    !EXTERNAL_USER_ID_PATTERN.test(externalUserId)
  ) {
    throw new IdentityError('IDENTITY_REGISTRATION_KEY_INVALID');
  }
  const digestSource = `${REGISTRATION_KEY_SOURCE_PREFIX}${externalUserId}`;
  if (digestSource.length > 255) {
    throw new IdentityError('IDENTITY_REGISTRATION_KEY_INVALID');
  }
  const key = deterministicRegistrationUuid(digestSource);
  return Object.freeze({
    registrationKey: key,
    channelType,
    externalUserId
  });
}

function deterministicRegistrationUuid(source: string): string {
  const namespaceBytes = Buffer.from(
    REGISTRATION_KEY_NAMESPACE.replace(/-/gu, ''),
    'hex'
  );
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(Buffer.from(source, 'utf8'))
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

export function isUid(value: unknown): value is Uid {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function asUid(value: unknown): Uid {
  if (!isUid(value)) invalid();
  return value as Uid;
}
