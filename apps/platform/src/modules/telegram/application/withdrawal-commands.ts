export type WithdrawalCommand =
  | {
      readonly kind: 'withdraw';
      readonly assetCode: string;
      readonly amount: string;
      readonly destinationAddress: string;
    }
  | { readonly kind: 'status'; readonly orderRef: string };

interface MinimalShape {
  readonly message?: {
    readonly text?: unknown;
    readonly chat?: { readonly type?: unknown };
    readonly from?: { readonly id?: unknown };
  };
}

const ASSET_PATTERN = /^[A-Z0-9-]{3,16}$/u;
const AMOUNT_PATTERN = /^[0-9]{1,18}$/u;
const ADDRESS_PATTERN = /^[A-Za-z0-9]{20,64}$/u;

export function classifyWithdrawalUpdate(raw: unknown): {
  readonly command: WithdrawalCommand;
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

  if (cmd === '/withdraw' && parts.length === 4) {
    const assetCode = parts[1]!;
    const amount = parts[2]!;
    const destinationAddress = parts[3]!;
    if (
      ASSET_PATTERN.test(assetCode) &&
      AMOUNT_PATTERN.test(amount) &&
      amount !== '0' &&
      ADDRESS_PATTERN.test(destinationAddress)
    ) {
      return {
        command: { kind: 'withdraw', assetCode, amount, destinationAddress },
        externalUserId: String(fromId)
      };
    }
    return null;
  }

  if (cmd === '/withdrawstatus' && parts.length === 2) {
    const orderRef = parts[1]!;
    if (orderRef.length >= 4 && orderRef.length <= 64) {
      return {
        command: { kind: 'status', orderRef },
        externalUserId: String(fromId)
      };
    }
  }

  return null;
}
