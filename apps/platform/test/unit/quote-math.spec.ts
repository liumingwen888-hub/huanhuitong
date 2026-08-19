import { describe, expect, it } from 'vitest';
import {
  computeBuyAmount,
  exceedsDeviationTolerance,
  parseDecimalRate,
  QuoteMathError
} from '../../src/modules/exchange/domain/quote-math.js';

describe('S7-2 quote math pure functions', () => {
  it('S7QT07a: parses valid rates and rejects invalid ones', () => {
    expect(parseDecimalRate('1')).toEqual({ num: 1n, den: 1n });
    expect(parseDecimalRate('1.5')).toEqual({ num: 15n, den: 10n });
    expect(parseDecimalRate('0.000000000000000001'))
      .toEqual({ num: 1n, den: 10n ** 18n });
    expect(parseDecimalRate(' 95000.12345678 '))
      .toEqual({ num: 9500012345678n, den: 10n ** 8n });
    for (const invalid of [
      '', '0', '0.0', '-1', '1.', '.5', 'abc', '1e5', '  ', 'NaN',
      '1.2.3', '1234567890123456789'
    ]) {
      expect(() => parseDecimalRate(invalid)).toThrow(QuoteMathError);
    }
  });

  it('S7QT07b: rounds the buyer amount down and shifts decimals', () => {
    // same-asset cross-chain: 1 USDT, rate 1, 50bp spread
    expect(
      computeBuyAmount({
        sellAmount: 1_000_000n,
        rateNum: 1n,
        rateDen: 1n,
        sellDecimals: 6,
        buyDecimals: 6,
        spreadBp: 50
      })
    ).toBe(995_000n);
    // 1000 satoshi BTC at 95000 USDT/BTC, 50bp spread, decimals 8 -> 6
    expect(
      computeBuyAmount({
        sellAmount: 1000n,
        rateNum: 95_000n,
        rateDen: 1n,
        sellDecimals: 8,
        buyDecimals: 6,
        spreadBp: 50
      })
    ).toBe(945_250n);
    // remainder of one never carries: 1.5 units gross -> floor 1
    expect(
      computeBuyAmount({
        sellAmount: 15n,
        rateNum: 1n,
        rateDen: 10n,
        sellDecimals: 0,
        buyDecimals: 0,
        spreadBp: 0
      })
    ).toBe(1n);
    // rate below one, upward decimal shift
    expect(
      computeBuyAmount({
        sellAmount: 2n,
        rateNum: 1n,
        rateDen: 2n,
        sellDecimals: 6,
        buyDecimals: 8,
        spreadBp: 0
      })
    ).toBe(100n);
    // dust below representable output rounds to zero
    expect(
      computeBuyAmount({
        sellAmount: 1n,
        rateNum: 1n,
        rateDen: 10n ** 18n,
        sellDecimals: 0,
        buyDecimals: 0,
        spreadBp: 0
      })
    ).toBe(0n);
  });

  it('S7QT07c: deviation tolerance compares exactly against the reference', () => {
    const reference = parseDecimalRate('1');
    const within = parseDecimalRate('1.05');
    const beyond = parseDecimalRate('1.2');
    expect(
      exceedsDeviationTolerance({
        rate: within, referenceRate: reference, toleranceBp: 1000
      })
    ).toBe(false);
    expect(
      exceedsDeviationTolerance({
        rate: beyond, referenceRate: reference, toleranceBp: 1000
      })
    ).toBe(true);
    expect(
      exceedsDeviationTolerance({
        rate: parseDecimalRate('0.85'),
        referenceRate: reference,
        toleranceBp: 1000
      })
    ).toBe(true);
    expect(
      exceedsDeviationTolerance({
        rate: parseDecimalRate('95000.12345678'),
        referenceRate: parseDecimalRate('95000'),
        toleranceBp: 1000
      })
    ).toBe(false);
  });
});
