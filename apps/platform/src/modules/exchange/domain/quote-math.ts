export type QuoteMathErrorCode =
  | 'RATE_INVALID'
  | 'DECIMALS_INVALID';

export class QuoteMathError extends Error {
  public readonly code: QuoteMathErrorCode;

  public constructor(code: QuoteMathErrorCode) {
    super(code);
    this.name = 'QuoteMathError';
    this.code = code;
  }
}

export interface ParsedRate {
  readonly num: bigint;
  readonly den: bigint;
}

/**
 * Parses a positive decimal rate string (up to 18 whole digits and 18
 * fraction digits) into an exact BigInt fraction. No float ever
 * touches money math.
 */
export function parseDecimalRate(text: string): ParsedRate {
  if (typeof text !== 'string') {
    throw new QuoteMathError('RATE_INVALID');
  }
  const match = /^([0-9]{1,18})(?:\.([0-9]{1,18}))?$/u.exec(text.trim());
  if (match === null) {
    throw new QuoteMathError('RATE_INVALID');
  }
  const whole = match[1]!;
  const fraction = match[2] ?? '';
  const num = BigInt(whole + fraction);
  if (num === 0n) {
    throw new QuoteMathError('RATE_INVALID');
  }
  return { num, den: 10n ** BigInt(fraction.length) };
}

/**
 * Exact floor computation of the buyer's proceeds:
 * floor(sell · rate · 10^(buyDecimals−sellDecimals) · (10000−spread)/10000).
 * Truncating BigInt division on positive values is the round-down
 * boundary; the remainder never carries into the buyer's amount.
 */
export function computeBuyAmount(input: {
  readonly sellAmount: bigint;
  readonly rateNum: bigint;
  readonly rateDen: bigint;
  readonly sellDecimals: number;
  readonly buyDecimals: number;
  readonly spreadBp: number;
}): bigint {
  if (
    !Number.isInteger(input.sellDecimals) ||
    !Number.isInteger(input.buyDecimals) ||
    input.sellDecimals < 0 ||
    input.buyDecimals < 0 ||
    input.sellDecimals > 18 ||
    input.buyDecimals > 18
  ) {
    throw new QuoteMathError('DECIMALS_INVALID');
  }
  const decimalShiftUp =
    BigInt(10) **
    BigInt(Math.max(input.buyDecimals - input.sellDecimals, 0));
  const decimalShiftDown =
    BigInt(10) **
    BigInt(Math.max(input.sellDecimals - input.buyDecimals, 0));
  const spreadFactor = 10000n - BigInt(input.spreadBp);
  const numerator =
    input.sellAmount * input.rateNum * decimalShiftUp * spreadFactor;
  const denominator = input.rateDen * decimalShiftDown * 10000n;
  return numerator / denominator;
}

/**
 * Exact deviation check |rate − referenceRate| / referenceRate > toleranceBp,
 * expressed as cross-multiplied integer comparisons — no float.
 */
export function exceedsDeviationTolerance(input: {
  readonly rate: ParsedRate;
  readonly referenceRate: ParsedRate;
  readonly toleranceBp: number;
}): boolean {
  const difference =
    input.rate.num * input.referenceRate.den -
    input.referenceRate.num * input.rate.den;
  const absolute = difference < 0n ? -difference : difference;
  return absolute * 10000n >
    BigInt(input.toleranceBp) * input.rate.den * input.referenceRate.num;
}
