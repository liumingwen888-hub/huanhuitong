import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Uid } from '@xht/contracts';
import {
  classifyExchangeUpdate
} from '../../src/modules/telegram/application/exchange-commands.js';
import {
  EXCHANGE_REPLIES,
  exchangeReplyText
} from '../../src/modules/telegram/application/exchange-replies.js';
import {
  NumericRenderError,
  renderNumeric
} from '../../src/modules/telegram/application/numeric-render.js';
import {
  ExchangeCommandHandler
} from '../../src/modules/telegram/application/exchange-command.handler.js';
import {
  WithdrawalNotificationHandler,
  WithdrawalNotificationInvalidError
} from '../../../worker/src/outbox/withdrawal-notification.handler.js';

const TEST_UID = '11111111-2222-3333-4444-555566667777' as Uid;
const QUOTE_ID = '9b01b7a2-1111-4222-8333-444455556666';

function privateMessage(text: string): object {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 777, is_bot: false, first_name: 'E' },
      chat: { id: 777, type: 'private' },
      date: 1,
      text
    }
  };
}

function makeFakeUnitOfWork(tables: {
  bindings?: { uid: string }[];
  orders?: { status: string }[];
}) {
  return {
    async execute<T>(
      work: (context: {
        executeSql<R>(sql: string, params: readonly unknown[]): Promise<{
          rows: R[];
        }>;
      }) => T | PromiseLike<T>
    ): Promise<T> {
      return await work({
        async executeSql<R>(sql: string): Promise<{ rows: R[] }> {
          if (sql.includes('FROM channel_bindings')) {
            return { rows: (tables.bindings ?? []) as R[] };
          }
          if (sql.includes('FROM exchange_orders')) {
            return { rows: (tables.orders ?? []) as R[] };
          }
          if (sql.includes('FROM market_configs')) {
            return { rows: [] as R[] };
          }
          return { rows: [] as R[] };
        }
      });
    }
  };
}

function makeFakeMarkets() {
  return {
    async listActive() {
      return [
        {
          marketKey: 'USDT-TRC20:USDT-ERC20',
          configVersion: 1,
          sellAssetCode: 'USDT-TRC20',
          buyAssetCode: 'USDT-ERC20',
          quoteScale: 8,
          spreadBp: 50,
          minSellAmount: '100000',
          maxSellAmount: '10000000000',
          quoteTtlSeconds: 60,
          deviationToleranceBp: 1000,
          activatedAt: new Date().toISOString()
        }
      ];
    }
  };
}

function makeFakeQuotes() {
  const calls: {
    readonly marketKey: string;
    readonly sellAmount: string;
  }[] = [];
  let result:
    | { outcome: 'CREATED'; quote: Record<string, string> }
    | { outcome: 'REJECTED'; reasonCode: string } = {
    outcome: 'CREATED',
    quote: {
      quoteId: QUOTE_ID,
      sellAmount: '2000000',
      buyAmount: '1990000',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }
  };
  return {
    calls,
    setResult(next: typeof result): void {
      result = next;
    },
    async createQuote(input: {
      readonly marketKey: string;
      readonly sellAmount: string;
    }) {
      calls.push(input);
      return result;
    }
  };
}

function makeFakeConfirm() {
  const calls: {
    readonly quoteId: string;
    readonly uid: Uid;
  }[] = [];
  let result:
    | { outcome: 'CONFIRMED'; order: Record<string, string> }
    | { outcome: 'ALREADY_CONFIRMED'; order: Record<string, string> }
    | { outcome: 'REJECTED'; reasonCode: string } = {
    outcome: 'CONFIRMED',
    order: { orderRef: 'XCHG:x' }
  };
  return {
    calls,
    setResult(next: typeof result): void {
      result = next;
    },
    async confirm(input: { readonly quoteId: string; readonly uid: Uid }) {
      calls.push(input);
      return result;
    }
  };
}

function makeHandler(tables: {
  bindings?: { uid: string }[];
  orders?: { status: string }[];
} = {}) {
  const quotes = makeFakeQuotes();
  const confirm = makeFakeConfirm();
  const handler = new ExchangeCommandHandler(
    makeFakeUnitOfWork(tables) as never,
    makeFakeMarkets() as never,
    quotes as never,
    confirm as never
  );
  return { handler, quotes, confirm };
}

describe('S7-7 exchange telegram UX', () => {
  it('S7EU01: the parser accepts valid shapes and rejects invalid ones', () => {
    expect(
      classifyExchangeUpdate(privateMessage('/markets'))?.command
    ).toEqual({ kind: 'markets' });
    expect(
      classifyExchangeUpdate(
        privateMessage('/rate USDT-TRC20:USDT-ERC20 2000000')
      )?.command
    ).toEqual({
      kind: 'rate',
      marketKey: 'USDT-TRC20:USDT-ERC20',
      sellAmount: '2000000'
    });
    expect(
      classifyExchangeUpdate(privateMessage(`/exchange ${QUOTE_ID}`))?.command
    ).toEqual({ kind: 'confirm', quoteId: QUOTE_ID });
    expect(
      classifyExchangeUpdate(
        privateMessage('/exchangestatus XCHG:9b01b7a211114222')
      )?.command
    ).toEqual({ kind: 'status', orderRef: 'XCHG:9b01b7a211114222' });
    for (const invalid of [
      '/markets extra',
      '/rate lowercase:KEY 100',
      '/rate USDT-TRC20:USDT-ERC20 0',
      '/rate USDT-TRC20:USDT-ERC20 12a',
      '/exchange not-a-uuid',
      '/exchangestatus WD:unknown!!',
      '/exchange'
    ]) {
      expect(classifyExchangeUpdate(privateMessage(invalid))).toBeNull();
    }
    const group = {
      update_id: 2,
      message: {
        chat: { id: -100, type: 'group' },
        from: { id: 777 },
        text: '/markets'
      }
    };
    expect(classifyExchangeUpdate(group)).toBeNull();
  });

  it('S7EU02: /rate renders whitelisted numbers from a real quote', async () => {
    const { handler, quotes } = makeHandler({ bindings: [{ uid: TEST_UID }] });
    const outcome = await handler.execute({
      command: {
        kind: 'rate',
        marketKey: 'USDT-TRC20:USDT-ERC20',
        sellAmount: '2000000'
      },
      externalUserId: '777',
      updateId: 'u1'
    });
    expect(quotes.calls).toEqual([
      { marketKey: 'USDT-TRC20:USDT-ERC20', sellAmount: '2000000' }
    ]);
    expect(outcome.text).toContain(QUOTE_ID);
    expect(outcome.text).toContain('2000000');
    expect(outcome.text).toContain('1990000');
    expect(outcome.text).toMatch(/有效期剩余约 [0-9]+ 秒。/u);
    quotes.setResult({
      outcome: 'REJECTED',
      reasonCode: 'QUOTE_DEVIATION_EXCEEDED'
    });
    const denied = await handler.execute({
      command: {
        kind: 'rate',
        marketKey: 'USDT-TRC20:USDT-ERC20',
        sellAmount: '2000000'
      },
      externalUserId: '777',
      updateId: 'u2'
    });
    expect(denied.text).toBe(exchangeReplyText('rateDeviationExceeded'));
  });

  it('S7EU03: /exchange maps confirm outcomes to categorical replies', async () => {
    const { handler, confirm } = makeHandler({ bindings: [{ uid: TEST_UID }] });
    const outcome = await handler.execute({
      command: { kind: 'confirm', quoteId: QUOTE_ID },
      externalUserId: '777',
      updateId: 'u1'
    });
    expect(outcome.text).toBe(exchangeReplyText('exchangeConfirmed'));
    expect(confirm.calls).toEqual([{ quoteId: QUOTE_ID, uid: TEST_UID }]);
    confirm.setResult({ outcome: 'ALREADY_CONFIRMED', order: {} });
    expect(
      (await handler.execute({
        command: { kind: 'confirm', quoteId: QUOTE_ID },
        externalUserId: '777',
        updateId: 'u2'
      })).text
    ).toBe(exchangeReplyText('exchangeAlreadyConfirmed'));
    for (const [reasonCode, expected] of [
      ['QUOTE_NOT_FOUND', 'exchangeQuoteNotFound'],
      ['QUOTE_NOT_CONSUMABLE', 'exchangeQuoteNotConsumable'],
      ['EXCHANGE_INSUFFICIENT_FUNDS', 'exchangeInsufficient'],
      ['EXCHANGE_COMMAND_INVALID', 'exchangeCommandInvalid']
    ] as const) {
      confirm.setResult({ outcome: 'REJECTED', reasonCode });
      expect(
        (await handler.execute({
          command: { kind: 'confirm', quoteId: QUOTE_ID },
          externalUserId: '777',
          updateId: 'u3'
        })).text
      ).toBe(exchangeReplyText(expected));
    }
  });

  it('S7EU04: /markets renders whitelisted market facts', async () => {
    const { handler } = makeHandler({ bindings: [{ uid: TEST_UID }] });
    const outcome = await handler.execute({
      command: { kind: 'markets' },
      externalUserId: '777',
      updateId: 'u1'
    });
    expect(outcome.text).toContain('USDT-TRC20:USDT-ERC20');
    expect(outcome.text).toContain('100000');
    expect(outcome.text).toContain('10000000000');
  });

  it('S7EU05: /exchangestatus maps six states and hides foreign orders', async () => {
    const states = [
      'FUNDS_RESERVED', 'EXECUTING', 'SETTLED', 'FAILED', 'EXPIRED', 'REFUNDED'
    ];
    for (const status of states) {
      const { handler } = makeHandler({
        bindings: [{ uid: TEST_UID }],
        orders: [{ status }]
      });
      const outcome = await handler.execute({
        command: { kind: 'status', orderRef: 'XCHG:9b01b7a211114222' },
        externalUserId: '777',
        updateId: 'u1'
      });
      expect(outcome.text).toBe(exchangeReplyText(statusReplyOf(status)));
    }
    const unknown = makeHandler({
      bindings: [{ uid: TEST_UID }],
      orders: []
    });
    expect(
      (await unknown.handler.execute({
        command: { kind: 'status', orderRef: 'XCHG:9b01b7a211114222' },
        externalUserId: '777',
        updateId: 'u2'
      })).text
    ).toBe(exchangeReplyText('exchangeStatusUnknown'));
  });

  it('S7EU06: renderNumeric rejects everything outside the whitelist', () => {
    expect(
      renderNumeric('卖出 {0}。', [{ kind: 'amount', value: '100' }])
    ).toBe('卖出 100。');
    expect(
      renderNumeric('{0} 限额 {1}', [
        { kind: 'marketKey', value: 'BTC:USDT-TRC20' },
        { kind: 'amount', value: '1000' }
      ])
    ).toBe('BTC:USDT-TRC20 限额 1000');
    for (const bad of [
      '', 'abc', '12a', '-1', '1.5', '1e5', ' ', 'DROP TABLE',
      '1000000000000000000', '${x}', '<b>'
    ]) {
      expect(() =>
        renderNumeric('v {0}', [{ kind: 'amount', value: bad }])
      ).toThrow(NumericRenderError);
    }
    expect(() =>
      renderNumeric('{0}', [{ kind: 'marketKey', value: 'lower:case' }])
    ).toThrow(NumericRenderError);
    expect(() =>
      renderNumeric('{0}', [{ kind: 'quoteId', value: 'NOT-A-UUID' }])
    ).toThrow(NumericRenderError);
    expect(() =>
      renderNumeric('no placeholder', [{ kind: 'amount', value: '1' }])
    ).toThrow(NumericRenderError);
    expect(() =>
      renderNumeric('costs $5 {0}', [{ kind: 'amount', value: '1' }])
    ).toThrow(NumericRenderError);
  });

  it('S7EU07: notification topics render static exchange texts', async () => {
    const sent: {
      readonly externalUserId: string;
      readonly text: string;
      readonly idempotencyKey: string;
    }[] = [];
    const texts = new Map<string, string>([
      ['telegram.exchange-reserved.v1', EXCHANGE_REPLIES.exchangeNotifyReserved],
      ['telegram.exchange-settled.v1', EXCHANGE_REPLIES.exchangeNotifySettled],
      ['telegram.exchange-failed.v1', EXCHANGE_REPLIES.exchangeNotifyFailed],
      ['telegram.exchange-refunded.v1', EXCHANGE_REPLIES.exchangeNotifyRefunded]
    ]);
    const handler = new WithdrawalNotificationHandler(
      {
        sendPrompt: async (input) => {
          sent.push(input);
        }
      } as never,
      {
        findExternalUserIdByUid: async (uid) =>
          uid === TEST_UID ? '777' : null
      },
      texts
    );
    for (const [topic, text] of texts) {
      await handler.handle({
        topic, eventKey: `k-${topic}`, payload: { uid: TEST_UID }
      } as never);
    }
    expect(sent).toHaveLength(4);
    expect(new Set(sent.map((s) => s.text))).toEqual(new Set(texts.values()));
    await expect(
      handler.handle({
        topic: 'telegram.exchange-unknown.v1',
        eventKey: 'k',
        payload: { uid: TEST_UID }
      } as never)
    ).rejects.toBeInstanceOf(WithdrawalNotificationInvalidError);
  });

  it('S7EU08: static guarantees hold across replies and handlers', async () => {
    const repliesSource = await readFile(
      resolve(import.meta.dirname, '../../src/modules/telegram/application/exchange-replies.ts'),
      'utf8'
    );
    expect(repliesSource.match(/\$\{|`/u) ?? []).toEqual([]);
    const handlerSource = await readFile(
      resolve(import.meta.dirname, '../../src/modules/telegram/application/exchange-command.handler.ts'),
      'utf8'
    );
    // every dynamic fragment must flow through renderNumeric
    expect(handlerSource.match(/message\.text|payload\.[A-Za-z]+\s*\+/u) ?? [])
      .toEqual([]);
    const renderCalls = handlerSource.match(/renderNumeric\(/gu)?.length ?? 0;
    expect(renderCalls).toBeGreaterThan(0);
    for (const text of Object.values(EXCHANGE_REPLIES)) {
      expect(text.includes('$')).toBe(false);
    }
  });
});

function statusReplyOf(status: string): string {
  const map: Record<string, string> = {
    FUNDS_RESERVED: 'exchangeStatusFundsReserved',
    EXECUTING: 'exchangeStatusExecuting',
    SETTLED: 'exchangeStatusSettled',
    FAILED: 'exchangeStatusFailed',
    EXPIRED: 'exchangeStatusExpired',
    REFUNDED: 'exchangeStatusRefunded'
  };
  return map[status]!;
}
