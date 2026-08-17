export interface ParsedTelegramStartUpdate {
  readonly kind: 'private-start';
  readonly updateId: string;
  readonly messageId: string;
  readonly externalUserId: string;
  readonly chatId: string;
  readonly username: string | null;
  readonly displayName: string;
  readonly startParameter: string | null;
}

export interface IgnoredTelegramUpdate {
  readonly kind: 'ignored';
  readonly reason:
    | 'unsupported-update'
    | 'unsupported-chat-or-user'
    | 'not-start';
}

import type { Uid } from './identity.js';
import type {
  InboxDigestKeyVersion,
  InboxDigestSet
} from './inbox-digest.js';

export interface HandleTelegramStartCommand {
  readonly updateId: string;
  readonly externalUserId: string;
  readonly chatId: string;
  readonly username: string | null;
  readonly displayName: string;
  readonly inboxDigests: InboxDigestSet;
  readonly correlationId: string;
  readonly receivedAt: Date;
  readonly claimant: string;
}

export type HandleTelegramStartResult =
  | { readonly kind: 'processed'; readonly uid: Uid; readonly created: boolean }
  | { readonly kind: 'duplicate_same_payload'; readonly inboxId: string }
  | { readonly kind: 'conflict'; readonly inboxId: string }
  | {
      readonly kind: 'digest_key_unavailable';
      readonly inboxId: string;
      readonly requiredKeyVersion: InboxDigestKeyVersion;
    };

export interface TelegramMainMenuRequestedV1 {
  readonly type: 'telegram.main-menu-requested.v1';
  readonly eventId: string;
  readonly uid: Uid;
  readonly bindingId: string;
  readonly menuVersion: 'main-menu-v1';
  readonly occurredAt: string;
  readonly correlationId: string;
}

export type TelegramWebhookErrorCode =
  | 'WEBHOOK_HTTPS_REQUIRED'
  | 'WEBHOOK_SECRET_INVALID'
  | 'WEBHOOK_CONTENT_TYPE_INVALID'
  | 'WEBHOOK_BODY_TOO_LARGE'
  | 'WEBHOOK_UPDATE_MALFORMED'
  | 'WEBHOOK_DIGEST_KEY_UNAVAILABLE';
