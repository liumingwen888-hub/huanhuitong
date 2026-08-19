import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePostMoneyCommand } from '../../src/modules/ledger/domain/ledger.types.js';

function base(lines: unknown): unknown {
  return {
    idempotencyKey: 'unit-key-1234',
    transactionType: 'INTERNAL_TRANSFER',
    occurredAt: '2026-08-17T12:00:00.000Z',
    lines
  };
}

describe('post money command validation (S3PE unit)', () => {
  it('S3PE-U01: rejects zero, decimal, negative and single-line amounts', () => {
    const a = randomUUID();
    const b = randomUUID();
    for (const lines of [
      [{ accountId: a, direction: 'DEBIT', amount: '0' },
       { accountId: b, direction: 'CREDIT', amount: '0' }],
      [{ accountId: a, direction: 'DEBIT', amount: '1.5' },
       { accountId: b, direction: 'CREDIT', amount: '1.5' }],
      [{ accountId: a, direction: 'DEBIT', amount: '-5' },
       { accountId: b, direction: 'CREDIT', amount: '-5' }],
      [{ accountId: a, direction: 'DEBIT', amount: '5' }]
    ]) {
      expect(() => parsePostMoneyCommand(base(lines))).toThrow();
    }
  });

  it('S3PE-U02: rejects proxies and accessor-bearing commands', () => {
    const proxied = new Proxy(base([]), {});
    expect(() => parsePostMoneyCommand(proxied)).toThrow();
  });

  it('S3PE-U03: accepts a balanced multi-line cross-asset command', () => {
    const a = randomUUID();
    const b = randomUUID();
    const parsed = parsePostMoneyCommand(base([
      { accountId: a, direction: 'DEBIT', amount: '1000000' },
      { accountId: b, direction: 'CREDIT', amount: '400' },
      { accountId: a, direction: 'CREDIT', amount: '1000000' },
      { accountId: b, direction: 'DEBIT', amount: '400' }
    ]));
    expect(parsed.lines).toHaveLength(4);
  });
});
