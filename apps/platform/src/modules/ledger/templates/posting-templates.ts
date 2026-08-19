import type {
  LedgerAccountId,
  PostMoneyCommand
} from '@xht/contracts';

export type TemplateResult =
  | { readonly ok: true; readonly command: PostMoneyCommand }
  | { readonly ok: false; readonly reason: string };

function positiveAmount(value: string): boolean {
  return typeof value === 'string' && /^[0-9]+$/.test(value) && value !== '0';
}

function line(
  accountId: LedgerAccountId,
  direction: 'DEBIT' | 'CREDIT',
  amount: string
) {
  return { accountId, direction, amount };
}

function ok(idempotencyKey: string, type: string, lines: PostMoneyCommand['lines']): TemplateResult {
  return {
    ok: true,
    command: {
      idempotencyKey,
      transactionType: type as PostMoneyCommand['transactionType'],
      lines,
      occurredAt: new Date().toISOString()
    }
  };
}

function fail(reason: string): TemplateResult {
  return { ok: false, reason };
}

// ─── 1. Deposit confirmation ───
export function depositConfirmed(input: {
  readonly custodyAccountId: LedgerAccountId;
  readonly userAvailableAccountId: LedgerAccountId;
  readonly amount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  return ok(
    `DEPOSIT:${input.orderId}:CONFIRM:0`,
    'DEPOSIT',
    [
      line(input.custodyAccountId, 'DEBIT', input.amount),
      line(input.userAvailableAccountId, 'CREDIT', input.amount)
    ]
  );
}

// ─── 2. Internal transfer ───
export function internalTransfer(input: {
  readonly senderAvailableAccountId: LedgerAccountId;
  readonly recipientAvailableAccountId: LedgerAccountId;
  readonly feeIncomeAccountId: LedgerAccountId;
  readonly amount: string;
  readonly feeAmount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  const lines = [
    line(input.senderAvailableAccountId, 'DEBIT', (
      BigInt(input.amount) + BigInt(input.feeAmount || '0')
    ).toString()),
    line(input.recipientAvailableAccountId, 'CREDIT', input.amount)
  ];
  if (positiveAmount(input.feeAmount)) {
    lines.push(line(input.feeIncomeAccountId, 'CREDIT', input.feeAmount));
  }
  return ok(`INTERNAL_TRANSFER:${input.orderId}:EXECUTE:0`, 'INTERNAL_TRANSFER', lines);
}

// ─── 3. Claim ───
export function claimExecuted(input: {
  readonly claimLiabilityAccountId: LedgerAccountId;
  readonly recipientAvailableAccountId: LedgerAccountId;
  readonly amount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  return ok(
    `CLAIM:${input.orderId}:EXECUTE:0`,
    'CLAIM',
    [
      line(input.claimLiabilityAccountId, 'DEBIT', input.amount),
      line(input.recipientAvailableAccountId, 'CREDIT', input.amount)
    ]
  );
}

// ─── 4. Red packet ───
export function redPacketCreated(input: {
  readonly senderAvailableAccountId: LedgerAccountId;
  readonly claimLiabilityAccountId: LedgerAccountId;
  readonly amount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  return ok(
    `RED_PACKET:${input.orderId}:CREATE:0`,
    'RED_PACKET',
    [
      line(input.senderAvailableAccountId, 'DEBIT', input.amount),
      line(input.claimLiabilityAccountId, 'CREDIT', input.amount)
    ]
  );
}

export function redPacketRefunded(input: {
  readonly senderAvailableAccountId: LedgerAccountId;
  readonly claimLiabilityAccountId: LedgerAccountId;
  readonly amount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  return ok(
    `RED_PACKET:${input.orderId}:REFUND:0`,
    'RED_PACKET',
    [
      line(input.claimLiabilityAccountId, 'DEBIT', input.amount),
      line(input.senderAvailableAccountId, 'CREDIT', input.amount)
    ]
  );
}

// ─── 5. Withdrawal ───
export function withdrawalRequested(input: {
  readonly userAvailableAccountId: LedgerAccountId;
  readonly userFrozenAccountId: LedgerAccountId;
  readonly amount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  return ok(
    `WITHDRAWAL:${input.orderId}:FREEZE:0`,
    'WITHDRAWAL',
    [
      line(input.userAvailableAccountId, 'DEBIT', input.amount),
      line(input.userFrozenAccountId, 'CREDIT', input.amount)
    ]
  );
}

export function withdrawalSucceeded(input: {
  readonly userAvailableAccountId: LedgerAccountId;
  readonly userFrozenAccountId: LedgerAccountId;
  readonly custodyAccountId: LedgerAccountId;
  readonly feeIncomeAccountId: LedgerAccountId;
  readonly amount: string;
  readonly feeAmount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  const lines = [
    line(input.userFrozenAccountId, 'DEBIT', input.amount),
    line(input.custodyAccountId, 'CREDIT', input.amount)
  ];
  if (positiveAmount(input.feeAmount)) {
    lines.push(line(input.userAvailableAccountId, 'DEBIT', input.feeAmount));
    lines.push(line(input.feeIncomeAccountId, 'CREDIT', input.feeAmount));
  }
  return ok(`WITHDRAWAL:${input.orderId}:SETTLE:0`, 'WITHDRAWAL', lines);
}

export function withdrawalFailed(input: {
  readonly userAvailableAccountId: LedgerAccountId;
  readonly userFrozenAccountId: LedgerAccountId;
  readonly amount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  return ok(
    `WITHDRAWAL:${input.orderId}:RELEASE:0`,
    'WITHDRAWAL',
    [
      line(input.userFrozenAccountId, 'DEBIT', input.amount),
      line(input.userAvailableAccountId, 'CREDIT', input.amount)
    ]
  );
}

// ─── 6. Exchange ───
export function exchangeFrozen(input: {
  readonly userAvailableAccountId: LedgerAccountId;
  readonly userFrozenAccountId: LedgerAccountId;
  readonly sellAmount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.sellAmount)) return fail('AMOUNT_INVALID');
  return ok(
    `EXCHANGE:${input.orderId}:FREEZE:0`,
    'EXCHANGE',
    [
      line(input.userAvailableAccountId, 'DEBIT', input.sellAmount),
      line(input.userFrozenAccountId, 'CREDIT', input.sellAmount)
    ]
  );
}

export function exchangeSettled(input: {
  readonly sellFrozenAccountId: LedgerAccountId;
  readonly sellClearingAccountId: LedgerAccountId;
  readonly buyClearingAccountId: LedgerAccountId;
  readonly buyAvailableAccountId: LedgerAccountId;
  readonly sellAmount: string;
  readonly buyAmount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.sellAmount) || !positiveAmount(input.buyAmount)) {
    return fail('AMOUNT_INVALID');
  }
  return ok(
    `EXCHANGE:${input.orderId}:SETTLE:0`,
    'EXCHANGE',
    [
      line(input.sellFrozenAccountId, 'DEBIT', input.sellAmount),
      line(input.sellClearingAccountId, 'CREDIT', input.sellAmount),
      line(input.buyClearingAccountId, 'DEBIT', input.buyAmount),
      line(input.buyAvailableAccountId, 'CREDIT', input.buyAmount)
    ]
  );
}

// ─── 7. Fiat payout ───
export function fiatPayoutRequested(input: {
  readonly userAvailableAccountId: LedgerAccountId;
  readonly userFrozenAccountId: LedgerAccountId;
  readonly amount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  return ok(
    `FIAT_PAYOUT:${input.orderId}:FREEZE:0`,
    'FIAT_PAYOUT',
    [
      line(input.userAvailableAccountId, 'DEBIT', input.amount),
      line(input.userFrozenAccountId, 'CREDIT', input.amount)
    ]
  );
}

export function fiatPayoutSucceeded(input: {
  readonly userAvailableAccountId: LedgerAccountId;
  readonly userFrozenAccountId: LedgerAccountId;
  readonly upstreamCostAccountId: LedgerAccountId;
  readonly feeIncomeAccountId: LedgerAccountId;
  readonly amount: string;
  readonly feeAmount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  const lines = [
    line(input.userFrozenAccountId, 'DEBIT', input.amount),
    line(input.upstreamCostAccountId, 'CREDIT', input.amount)
  ];
  if (positiveAmount(input.feeAmount)) {
    lines.push(line(input.userAvailableAccountId, 'DEBIT', input.feeAmount));
    lines.push(line(input.feeIncomeAccountId, 'CREDIT', input.feeAmount));
  }
  return ok(`FIAT_PAYOUT:${input.orderId}:SETTLE:0`, 'FIAT_PAYOUT', lines);
}

export function fiatPayoutFailed(input: {
  readonly userAvailableAccountId: LedgerAccountId;
  readonly userFrozenAccountId: LedgerAccountId;
  readonly amount: string;
  readonly orderId: string;
}): TemplateResult {
  if (!positiveAmount(input.amount)) return fail('AMOUNT_INVALID');
  return ok(
    `FIAT_PAYOUT:${input.orderId}:RELEASE:0`,
    'FIAT_PAYOUT',
    [
      line(input.userFrozenAccountId, 'DEBIT', input.amount),
      line(input.userAvailableAccountId, 'CREDIT', input.amount)
    ]
  );
}

Object.freeze({
  depositConfirmed,
  internalTransfer,
  claimExecuted,
  redPacketCreated,
  redPacketRefunded,
  withdrawalRequested,
  withdrawalSucceeded,
  withdrawalFailed,
  exchangeFrozen,
  exchangeSettled,
  fiatPayoutRequested,
  fiatPayoutSucceeded,
  fiatPayoutFailed
});
