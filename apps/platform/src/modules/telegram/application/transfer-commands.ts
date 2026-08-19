export type TransferCommand =
  | { readonly kind: 'transfer'; readonly recipientExternalId: string; readonly amount: string }
  | { readonly kind: 'claim'; readonly claimCode: string }
  | { readonly kind: 'red-packet'; readonly totalAmount: string; readonly packetCount: number }
  | { readonly kind: 'balance' };

interface MinimalShape {
  readonly message?: {
    readonly text?: unknown;
    readonly chat?: { readonly type?: unknown };
    readonly from?: { readonly id?: unknown };
  };
}

export function classifyTransferUpdate(raw: unknown): {
  readonly command: TransferCommand;
  readonly externalUserId: string;
} | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const update = raw as MinimalShape;
  const message = update.message;
  if (message === undefined) return null;
  if (message.chat?.type !== 'private') return null;
  const fromId = message.from?.id;
  if (typeof fromId !== 'number') return null;
  const text = message.text;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/u);
  const cmd = parts[0];

  if (cmd === '/balance') {
    return { command: { kind: 'balance' }, externalUserId: String(fromId) };
  }

  if (cmd === '/transfer' && parts.length === 3) {
    const recipient = parts[1]!;
    const amount = parts[2]!;
    if (
      /^[1-9][0-9]{0,18}$/u.test(recipient) &&
      /^[0-9]+$/.test(amount) && amount !== '0'
    ) {
      return {
        command: { kind: 'transfer', recipientExternalId: recipient, amount },
        externalUserId: String(fromId)
      };
    }
    return null;
  }

  if (cmd === '/claim' && parts.length === 2) {
    const code = parts[1]!;
    if (code.length >= 4 && code.length <= 64) {
      return {
        command: { kind: 'claim', claimCode: code },
        externalUserId: String(fromId)
      };
    }
    return null;
  }

  if (cmd === '/redpacket' && parts.length === 3) {
    const total = parts[1]!;
    const count = Number(parts[2]);
    if (
      /^[0-9]+$/.test(total) && total !== '0' &&
      Number.isSafeInteger(count) && count >= 1 && count <= 100
    ) {
      return {
        command: { kind: 'red-packet', totalAmount: total, packetCount: count },
        externalUserId: String(fromId)
      };
    }
    return null;
  }

  return null;
}
