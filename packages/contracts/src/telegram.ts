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

export type TelegramWebhookErrorCode =
  | 'WEBHOOK_HTTPS_REQUIRED'
  | 'WEBHOOK_SECRET_INVALID'
  | 'WEBHOOK_CONTENT_TYPE_INVALID'
  | 'WEBHOOK_BODY_TOO_LARGE'
  | 'WEBHOOK_UPDATE_MALFORMED'
  | 'WEBHOOK_DIGEST_KEY_UNAVAILABLE';
