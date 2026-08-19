import { isProxy } from 'node:util/types';
import type {
  LedgerAccountId,
  LedgerEntryLine,
  PostMoneyCommand
} from '@xht/contracts';
import { LedgerError } from './ledger.errors.js';

const ACCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POSITIVE_INTEGER_PATTERN = /^[0-9]+$/u;

function invalid(): never {
  throw new LedgerError('LEDGER_COMMAND_INVALID');
}

function ownRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) invalid();
  if (isProxy(value)) invalid();
  if (Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  return value as Record<string, unknown>;
}

function field(source: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined || !('value' in descriptor)) invalid();
  return descriptor.value;
}

function positiveIntegerString(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !POSITIVE_INTEGER_PATTERN.test(value) ||
    value === '0' ||
    (value.length > 1 && value.startsWith('0'))
  ) {
    invalid();
  }
  return value;
}

export function parsePostMoneyCommand(input: unknown): PostMoneyCommand {
  const source = ownRecord(input);
  const idempotencyKey = field(source, 'idempotencyKey');
  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 200
  ) {
    invalid();
  }
  const transactionType = field(source, 'transactionType');
  const allowedTypes = new Set([
    'DEPOSIT', 'INTERNAL_TRANSFER', 'CLAIM', 'RED_PACKET',
    'WITHDRAWAL', 'EXCHANGE', 'FIAT_PAYOUT', 'REVERSAL', 'ADJUSTMENT'
  ]);
  if (typeof transactionType !== 'string' || !allowedTypes.has(transactionType)) {
    invalid();
  }
  const occurredAt = field(source, 'occurredAt');
  if (typeof occurredAt !== 'string' || occurredAt.length === 0) invalid();
  const rawLines = field(source, 'lines');
  if (typeof rawLines !== 'object' || rawLines === null || isProxy(rawLines)) {
    invalid();
  }
  if (!Array.isArray(rawLines) || rawLines.length < 2) invalid();
  const lines: LedgerEntryLine[] = [];
  let debitTotal = 0n;
  let creditTotal = 0n;
  for (const rawLine of rawLines) {
    const lineRecord = ownRecord(rawLine);
    const accountId = field(lineRecord, 'accountId');
    if (
      typeof accountId !== 'string' ||
      !ACCOUNT_ID_PATTERN.test(accountId)
    ) {
      invalid();
    }
    const direction = field(lineRecord, 'direction');
    if (direction !== 'DEBIT' && direction !== 'CREDIT') invalid();
    const amount = positiveIntegerString(field(lineRecord, 'amount'));
    const amountBig = BigInt(amount);
    if (direction === 'DEBIT') debitTotal += amountBig;
    else creditTotal += amountBig;
    lines.push({
      accountId: accountId as LedgerAccountId,
      direction,
      amount
    });
  }
  if (debitTotal !== creditTotal) {
    throw new LedgerError('LEDGER_UNBALANCED');
  }
  return Object.freeze({
    idempotencyKey,
    transactionType: transactionType as PostMoneyCommand['transactionType'],
    lines: Object.freeze(lines),
    occurredAt
  });
}

export function parseMoneyAmount(input: unknown): {
  readonly value: string;
  readonly assetCode: string;
  readonly decimals: number;
} {
  const source = ownRecord(input);
  const value = positiveIntegerString(field(source, 'value'));
  const assetCode = field(source, 'assetCode');
  if (typeof assetCode !== 'string' || assetCode.length === 0) invalid();
  const decimals = field(source, 'decimals');
  if (
    typeof decimals !== 'number' ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  ) {
    invalid();
  }
  return Object.freeze({ value, assetCode, decimals });
}
