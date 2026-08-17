import { createHmac } from 'node:crypto';
import type { SecretResolver } from './secret-resolver.js';
import type { SecretReference } from './secret-reference.js';
import { withResolvedSecret } from './secret-resolver.js';

export const TELEGRAM_USER_REFERENCE_VERSION = 'tgur-v1' as const;

export type TelegramUserReferenceErrorCode =
  | 'TELEGRAM_USER_ID_INVALID'
  | 'TELEGRAM_USER_REFERENCE_KEY_INVALID';

export class TelegramUserReferenceError extends Error {
  public constructor(public readonly code: TelegramUserReferenceErrorCode) {
    super(code);
    this.name = 'TelegramUserReferenceError';
  }
}

const TELEGRAM_USER_ID_PATTERN = /^[1-9][0-9]{0,18}$/u;
const KEY_MIN_BYTES = 32;

export interface TelegramUserReferenceSource {
  readonly kind: 'reference';
  readonly reference: SecretReference;
}

export interface TelegramUserReferenceStatic {
  readonly kind: 'static';
  readonly key: Uint8Array;
}

export type TelegramUserReferenceKeySource =
  | TelegramUserReferenceSource
  | TelegramUserReferenceStatic;

export interface TelegramUserReferenceOptions {
  readonly resolver: SecretResolver;
  readonly keySource: TelegramUserReferenceKeySource;
}

export async function toTelegramUserReference(
  options: TelegramUserReferenceOptions,
  externalUserId: string
): Promise<string> {
  if (
    typeof externalUserId !== 'string' ||
    !TELEGRAM_USER_ID_PATTERN.test(externalUserId)
  ) {
    throw new TelegramUserReferenceError('TELEGRAM_USER_ID_INVALID');
  }
  const compute = (keyBytes: Uint8Array): string => {
    if (keyBytes.byteLength < KEY_MIN_BYTES) {
      throw new TelegramUserReferenceError(
        'TELEGRAM_USER_REFERENCE_KEY_INVALID'
      );
    }
    const digest = createHmac('sha256', keyBytes)
      .update(Buffer.from(externalUserId, 'utf8'))
      .digest('base64url');
    return `${TELEGRAM_USER_REFERENCE_VERSION}:${digest}`;
  };
  if (options.keySource.kind === 'static') {
    return compute(options.keySource.key);
  }
  return withResolvedSecret(
    options.resolver,
    options.keySource.reference,
    compute
  );
}
