export type SecurityCommand =
  | { readonly kind: 'begin-setup' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'done' }
  | { readonly kind: 'digits'; readonly value: string }
  | {
      readonly kind: 'begin-authorize';
      readonly orderRef: string;
    };

interface MinimalTelegramShape {
  readonly message?: {
    readonly text?: unknown;
    readonly chat?: { readonly type?: unknown; readonly id?: unknown };
    readonly from?: { readonly id?: unknown };
  };
}

export function classifySecurityUpdate(raw: unknown): {
  readonly command: SecurityCommand;
  readonly externalUserId: string;
  readonly chatId: string;
} | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const update = raw as MinimalTelegramShape;
  const message = update.message;
  if (message === undefined) return null;
  if (message.chat?.type !== 'private') return null;
  const fromId = message.from?.id;
  const chatId = message.chat.id;
  if (typeof fromId !== 'number' || typeof chatId !== 'number') return null;
  const text = message.text;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  let command: SecurityCommand | null = null;
  if (trimmed === '/setpassword') command = { kind: 'begin-setup' };
  else if (trimmed === '/cancel') command = { kind: 'cancel' };
  else if (trimmed === '/done') command = { kind: 'done' };
  else if (trimmed.startsWith('/authorize ')) {
    const orderRef = trimmed.slice('/authorize '.length).trim();
    command =
      orderRef.length > 0 && orderRef.length <= 64
        ? { kind: 'begin-authorize', orderRef }
        : null;
  } else if (/^[0-9]{1,12}$/u.test(trimmed)) {
    command = { kind: 'digits', value: trimmed };
  }
  if (command === null) return null;
  return {
    command,
    externalUserId: String(fromId),
    chatId: String(chatId)
  };
}
