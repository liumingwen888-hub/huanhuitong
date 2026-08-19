export type ExchangeCommand =
  | { readonly kind: 'markets' }
  | { readonly kind: 'rate'; readonly marketKey: string; readonly sellAmount: string }
  | { readonly kind: 'confirm'; readonly quoteId: string }
  | { readonly kind: 'status'; readonly orderRef: string };

interface MinimalShape {
  readonly message?: {
    readonly text?: unknown;
    readonly chat?: { readonly type?: unknown };
    readonly from?: { readonly id?: unknown };
  };
}

const MARKET_KEY_PATTERN = /^[A-Z0-9-]{1,16}:[A-Z0-9-]{1,16}$/u;
const AMOUNT_PATTERN = /^[0-9]{1,18}$/u;
const QUOTE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ORDER_REF_PATTERN = /^XCHG:[0-9a-f-]{10,40}$/u;

export function classifyExchangeUpdate(raw: unknown): {
  readonly command: ExchangeCommand;
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

  if (cmd === '/markets' && parts.length === 1) {
    return { command: { kind: 'markets' }, externalUserId: String(fromId) };
  }
  if (cmd === '/rate' && parts.length === 3) {
    const marketKey = parts[1]!;
    const sellAmount = parts[2]!;
    if (
      MARKET_KEY_PATTERN.test(marketKey) &&
      AMOUNT_PATTERN.test(sellAmount) &&
      sellAmount !== '0'
    ) {
      return {
        command: { kind: 'rate', marketKey, sellAmount },
        externalUserId: String(fromId)
      };
    }
    return null;
  }
  if (cmd === '/exchange' && parts.length === 2) {
    const quoteId = parts[1]!;
    if (QUOTE_ID_PATTERN.test(quoteId)) {
      return {
        command: { kind: 'confirm', quoteId },
        externalUserId: String(fromId)
      };
    }
    return null;
  }
  if (cmd === '/exchangestatus' && parts.length === 2) {
    const orderRef = parts[1]!;
    if (ORDER_REF_PATTERN.test(orderRef)) {
      return {
        command: { kind: 'status', orderRef },
        externalUserId: String(fromId)
      };
    }
  }
  return null;
}
