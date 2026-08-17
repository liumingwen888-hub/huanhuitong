import type {
  IgnoredTelegramUpdate,
  ParsedTelegramStartUpdate
} from '@xht/contracts';

export class TelegramUpdateValidationError extends Error {
  public readonly code = 'WEBHOOK_UPDATE_MALFORMED' as const;
  constructor(detail: 'MALFORMED_UPDATE' | 'MALFORMED_MESSAGE') {
    super(detail);
    this.name = 'TelegramUpdateValidationError';
  }
}

function invalid(): never {
  throw new TelegramUpdateValidationError('MALFORMED_UPDATE');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

function decimalId(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\d+$/u.test(value)) return value;
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  ) {
    return String(value);
  }
  return undefined;
}

function signedChatId(value: unknown): string | undefined {
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) return value;
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER
  ) {
    return String(value);
  }
  return undefined;
}

function messageInvalid(): never {
  throw new TelegramUpdateValidationError('MALFORMED_MESSAGE');
}

interface ValidatedMessage {
  readonly messageId: string;
  readonly chatId: string;
  readonly chatType: string;
  readonly text: string | undefined;
  readonly from:
    | {
        readonly id: string;
        readonly username: string | undefined;
        readonly firstName: string;
        readonly lastName: string | undefined;
      }
    | undefined;
}

function validateMessage(value: unknown): ValidatedMessage {
  if (!isPlainObject(value)) messageInvalid();
  const messageId = decimalId(value.message_id);
  if (messageId === undefined) messageInvalid();
  const chat = value.chat;
  if (!isPlainObject(chat)) messageInvalid();
  const chatId = signedChatId(chat.id);
  if (chatId === undefined) messageInvalid();
  if (typeof chat.type !== 'string' || chat.type.length === 0) {
    messageInvalid();
  }
  const rawText = value.text;
  if (
    rawText !== undefined &&
    (typeof rawText !== 'string' || rawText.length > 4096)
  ) {
    messageInvalid();
  }
  let from: ValidatedMessage['from'] = undefined;
  const rawFrom = value.from;
  if (rawFrom !== undefined) {
    if (!isPlainObject(rawFrom)) messageInvalid();
    const fromId = decimalId(rawFrom.id);
    if (fromId === undefined) messageInvalid();
    if (
      typeof rawFrom.first_name !== 'string' ||
      rawFrom.first_name.length < 1 ||
      rawFrom.first_name.length > 256
    ) {
      messageInvalid();
    }
    const username = rawFrom.username;
    if (
      username !== undefined &&
      (typeof username !== 'string' || username.length < 1 || username.length > 64)
    ) {
      messageInvalid();
    }
    const lastName = rawFrom.last_name;
    if (
      lastName !== undefined &&
      (typeof lastName !== 'string' || lastName.length < 1 || lastName.length > 256)
    ) {
      messageInvalid();
    }
    from = {
      id: fromId,
      username,
      firstName: rawFrom.first_name,
      lastName
    };
  }
  return {
    messageId: messageId!,
    chatId: chatId!,
    chatType: chat.type,
    text: rawText,
    from
  };
}

export function parseTelegramUpdate(
  input: unknown
): ParsedTelegramStartUpdate | IgnoredTelegramUpdate {
  if (!isPlainObject(input)) invalid();
  const updateId = decimalId(input.update_id);
  if (updateId === undefined) invalid();
  const rawMessage = input.message;
  if (rawMessage === undefined) {
    return { kind: 'ignored', reason: 'unsupported-update' };
  }
  const message = validateMessage(rawMessage);
  if (message.chatType !== 'private' || message.from === undefined) {
    return { kind: 'ignored', reason: 'unsupported-chat-or-user' };
  }
  if (message.text === undefined) {
    return { kind: 'ignored', reason: 'unsupported-update' };
  }
  const text = message.text.trim();
  if (text !== '/start' && !text.startsWith('/start ')) {
    return { kind: 'ignored', reason: 'not-start' };
  }
  const from = message.from;
  return {
    kind: 'private-start',
    updateId: updateId!,
    messageId: message.messageId,
    externalUserId: from.id,
    chatId: message.chatId,
    username: from.username ?? null,
    displayName: [from.firstName, from.lastName]
      .filter((part): part is string => part !== undefined)
      .join(' '),
    startParameter: text.length > 6 ? text.slice(7) : null
  };
}
