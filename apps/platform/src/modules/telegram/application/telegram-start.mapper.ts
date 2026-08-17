import { isProxy } from 'node:util/types';
import type {
  HandleTelegramStartCommand,
  ResolveOrCreateUidCommand
} from '@xht/contracts';
import type { InboxClaimCommand } from '../../reliability/inbox/inbox.types.js';

export const TELEGRAM_WEBHOOK_CONSUMER = 'telegram-webhook-v1' as const;

export class TelegramStartCommandError extends Error {
  public readonly code = 'TELEGRAM_START_COMMAND_INVALID' as const;
  constructor() {
    super('TELEGRAM_START_COMMAND_INVALID');
    this.name = 'TelegramStartCommandError';
  }
}

function invalid(): never {
  throw new TelegramStartCommandError();
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

const SENSITIVE_KEYS = new Set([
  'rawUpdate',
  'update',
  'canonicalBytes',
  'messageText',
  'botToken',
  'secretToken',
  'password',
  'keyMaterial'
]);

function validateNoSensitiveKeys(source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (SENSITIVE_KEYS.has(key)) invalid();
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function uuidField(source: Record<string, unknown>, key: string): string {
  const value = stringField(source, key, 36, 36);
  if (!UUID_PATTERN.test(value)) invalid();
  return value;
}

function finiteDate(value: unknown): Date {
  if (typeof value !== 'object' || value === null) invalid();
  if (isProxy(value)) invalid();
  if (Object.getPrototypeOf(value) !== Date.prototype) invalid();
  if (Reflect.ownKeys(value).length !== 0) invalid();
  let milliseconds: number;
  try {
    milliseconds = Date.prototype.getTime.call(value);
  } catch {
    invalid();
  }
  if (!Number.isFinite(milliseconds)) invalid();
  return new Date(milliseconds);
}

export function toInboxClaimCommand(
  command: HandleTelegramStartCommand
): InboxClaimCommand {
  const source = ownRecord(command as unknown);
  validateNoSensitiveKeys(source);
  return {
    consumer: TELEGRAM_WEBHOOK_CONSUMER,
    externalMessageId: stringField(source, 'updateId', 1, 64),
    digests: command.inboxDigests,
    correlationId: uuidField(source, 'correlationId'),
    claimant: stringField(source, 'claimant', 1, 100),
    receivedAt: finiteDate(field(source, 'receivedAt'))
  };
}

export function toIdentityCommand(
  command: HandleTelegramStartCommand
): ResolveOrCreateUidCommand {
  const source = ownRecord(command as unknown);
  return {
    channelType: 'telegram',
    externalUserId: stringField(source, 'externalUserId', 1, 19),
    sourceMessageId: stringField(source, 'updateId', 1, 64),
    username:
      field(source, 'username') === null
        ? null
        : stringField(source, 'username', 1, 64),
    displayName: stringField(source, 'displayName', 1, 256),
    correlationId: uuidField(source, 'correlationId'),
    occurredAt: finiteDate(field(source, 'receivedAt')).toISOString()
  };
}
