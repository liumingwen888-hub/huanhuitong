export type PayoutCommand =
  | { readonly kind: 'capabilities' }
  | {
      readonly kind: 'quote';
      readonly route: string;
      readonly amount: string;
    }
  | {
      readonly kind: 'confirm';
      readonly route: string;
      readonly amount: string;
      readonly beneficiaryRef: string;
    }
  | { readonly kind: 'status'; readonly orderRef: string };

interface MinimalShape {
  readonly message?: {
    readonly text?: unknown;
    readonly chat?: { readonly type?: unknown };
    readonly from?: { readonly id?: unknown };
  };
}

const ROUTE_PATTERN = /^[A-Z]{2}:[A-Z]{3}$/u;
const AMOUNT_PATTERN = /^[0-9]{1,18}$/u;
const BENEFICIARY_PATTERN = /^[A-Za-z0-9-]{4,64}$/u;
const ORDER_REF_PATTERN = /^PO:TG:[0-9A-F]{8}$/u;

export function classifyPayoutUpdate(raw: unknown): {
  readonly command: PayoutCommand;
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

  if (cmd === '/payoutcapa' && parts.length === 1) {
    return {
      command: { kind: 'capabilities' },
      externalUserId: String(fromId)
    };
  }
  if (cmd === '/payoutquote' && parts.length === 3) {
    const route = parts[1]!;
    const amount = parts[2]!;
    if (ROUTE_PATTERN.test(route) && AMOUNT_PATTERN.test(amount) && amount !== '0') {
      return {
        command: { kind: 'quote', route, amount },
        externalUserId: String(fromId)
      };
    }
    return null;
  }
  if (cmd === '/payout' && parts.length === 4) {
    const route = parts[1]!;
    const amount = parts[2]!;
    const beneficiaryRef = parts[3]!;
    if (
      ROUTE_PATTERN.test(route) &&
      AMOUNT_PATTERN.test(amount) &&
      amount !== '0' &&
      BENEFICIARY_PATTERN.test(beneficiaryRef)
    ) {
      return {
        command: { kind: 'confirm', route, amount, beneficiaryRef },
        externalUserId: String(fromId)
      };
    }
    return null;
  }
  if (cmd === '/payoutstatus' && parts.length === 2) {
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
