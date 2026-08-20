import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AuthorizePaymentProofV1,
  PayoutCommandResult,
  Uid
} from '@xht/contracts';
import {
  classifyPayoutUpdate
} from '../../src/modules/telegram/application/payout-commands.js';
import {
  PAYOUT_REPLIES,
  payoutReplyText
} from '../../src/modules/telegram/application/payout-replies.js';
import { SecurityFlowRegistry } from '../../src/modules/telegram/application/security-flow.registry.js';
import { renderNumeric } from '../../src/modules/telegram/application/numeric-render.js';
import {
  PayoutCommandHandler
} from '../../src/modules/telegram/application/payout-command.handler.js';
import {
  WithdrawalNotificationHandler
} from '../../../worker/src/outbox/withdrawal-notification.handler.js';

const TEST_UID = '11111111-2222-3333-4444-555566667777' as Uid;

function privateMessage(text: string): object {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 888, is_bot: false, first_name: 'P' },
      chat: { id: 888, type: 'private' },
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
          if (sql.includes('FROM payout_orders')) {
            return { rows: (tables.orders ?? []) as R[] };
          }
          return { rows: [] as R[] };
        }
      });
    }
  };
}

function makeFakeSessions() {
  const begun: {
    readonly uid: Uid;
    readonly operationType: string;
    readonly orderRef: string;
    readonly amountSummary: string;
    readonly assetSummary: string;
  }[] = [];
  return {
    begun,
    async beginAuthorization(input: {
      readonly uid: Uid;
      readonly operationType: string;
      readonly orderRef: string;
      readonly amountSummary: string;
      readonly assetSummary: string;
    }): Promise<{ readonly sessionId: string; readonly expiresAt: string }> {
      begun.push(input);
      return {
        sessionId: `session-${begun.length}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      };
    }
  };
}

function makeFakeCapabilities() {
  return {
    async getCapabilities() {
      return [
        {
          providerId: 'fake-bank-v1',
          configVersion: 1,
          providerName: 'Fake Bank',
          route: 'US:USD',
          sourceAssetCode: 'USDT-TRC20',
          fixedFee: '2000',
          minAmount: '100000',
          maxAmount: '100000000'
        }
      ];
    },
    async quotePayout(input: { readonly route: string; readonly sourceAmount: string }) {
      if (input.route !== 'US:USD') {
        return { outcome: 'REJECTED' as const, reasonCode: 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND' };
      }
      return {
        outcome: 'QUOTED' as const,
        quote: {
          providerId: 'fake-bank-v1',
          configVersion: 1,
          route: input.route,
          sourceAssetCode: 'USDT-TRC20',
          sourceAmount: input.sourceAmount,
          fee: '2000',
          estimatedFiat: (BigInt(input.sourceAmount) - 2000n).toString(),
          estimate: true as const
        }
      };
    }
  };
}

function makeFakeRequests() {
  const calls: {
    readonly command: Record<string, string>;
    readonly proof: AuthorizePaymentProofV1;
  }[] = [];
  let result: PayoutCommandResult = {
    outcome: 'ACCEPTED',
    order: {} as never
  };
  return {
    calls,
    setResult(next: PayoutCommandResult): void {
      result = next;
    },
    async request(
      command: Record<string, string>,
      proof: AuthorizePaymentProofV1
    ): Promise<PayoutCommandResult> {
      calls.push({ command, proof });
      return result;
    }
  };
}

function makeHandler(tables: {
  bindings?: { uid: string }[];
  orders?: { status: string }[];
} = {}) {
  const sessions = makeFakeSessions();
  const requests = makeFakeRequests();
  const flows = new SecurityFlowRegistry();
  const handler = new PayoutCommandHandler(
    makeFakeUnitOfWork(tables) as never,
    sessions as never,
    makeFakeCapabilities() as never,
    requests as never,
    flows
  );
  return { handler, sessions, requests, flows };
}

describe('S8-7 payout telegram UX', () => {
  it('S8PU01: the parser accepts valid shapes and rejects invalid ones', () => {
    expect(
      classifyPayoutUpdate(privateMessage('/payoutcapa'))?.command
    ).toEqual({ kind: 'capabilities' });
    expect(
      classifyPayoutUpdate(privateMessage('/payoutquote US:USD 5000000'))
        ?.command
    ).toEqual({ kind: 'quote', route: 'US:USD', amount: '5000000' });
    expect(
      classifyPayoutUpdate(
        privateMessage('/payout US:USD 5000000 BEN-TEST-0001')
      )?.command
    ).toEqual({
      kind: 'confirm',
      route: 'US:USD',
      amount: '5000000',
      beneficiaryRef: 'BEN-TEST-0001'
    });
    expect(
      classifyPayoutUpdate(privateMessage('/payoutstatus PO:TG:AB12CD34'))
        ?.command
    ).toEqual({ kind: 'status', orderRef: 'PO:TG:AB12CD34' });
    for (const invalid of [
      '/payoutcapa extra',
      '/payoutquote us:usd 100',
      '/payoutquote US:USD 0',
      '/payout US:USD 100',
      '/payout US:USD 100 bad ref!',
      '/payoutstatus PO-unknown',
      '/payout'
    ]) {
      expect(classifyPayoutUpdate(privateMessage(invalid))).toBeNull();
    }
  });

  it('S8PU02: /payout opens a session with route-bound values', async () => {
    const { handler, sessions, flows } = makeHandler({
      bindings: [{ uid: TEST_UID }]
    });
    const result = await handler.execute({
      command: {
        kind: 'confirm',
        route: 'US:USD',
        amount: '5000000',
        beneficiaryRef: 'BEN-TEST-0001'
      },
      externalUserId: '888',
      updateId: 'u1'
    });
    expect(result.text).toBe(payoutReplyText('payoutPrompt'));
    expect(sessions.begun).toHaveLength(1);
    expect(sessions.begun[0]).toMatchObject({
      uid: TEST_UID,
      operationType: 'fiat-payout',
      amountSummary: '5000000',
      assetSummary: 'US:USD'
    });
    expect(sessions.begun[0]!.orderRef).toMatch(/^PO:TG:[0-9A-F]{8}$/u);
    expect(flows.get('888')?.mode).toBe('authorize');
  });

  it('S8PU03: the continuation maps results and passes exact facts', async () => {
    const { handler, requests } = makeHandler({ bindings: [{ uid: TEST_UID }] });
    await handler.execute({
      command: {
        kind: 'confirm',
        route: 'US:USD',
        amount: '5000000',
        beneficiaryRef: 'BEN-TEST-0001'
      },
      externalUserId: '888',
      updateId: 'u1'
    });
    const proof = Object.freeze({
      type: 'security.payment-authorized.v1',
      uid: TEST_UID,
      operationType: 'fiat-payout',
      orderRef: 'whatever',
      amountSummary: '5000000',
      assetSummary: 'US:USD',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionId: 'session-1'
    }) as AuthorizePaymentProofV1;
    const accepted = await handler.consumeAuthorized({
      uid: TEST_UID, externalUserId: '888', proof
    });
    expect(accepted.replyKey).toBe('payoutAccepted');
    expect(requests.calls).toHaveLength(1);
    expect(requests.calls[0]!.command).toMatchObject({
      route: 'US:USD',
      amount: '5000000',
      beneficiaryRef: 'BEN-TEST-0001',
      uid: TEST_UID
    });
    for (const [result, expected] of [
      [{ outcome: 'ALREADY_REQUESTED', order: {} as never }, 'payoutAlreadyRequested'],
      [{ outcome: 'REJECTED', reasonCode: 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND' }, 'payoutDeniedConfig'],
      [{ outcome: 'REJECTED', reasonCode: 'PAYOUT_AMOUNT_OUT_OF_RANGE' }, 'payoutDeniedRange'],
      [{ outcome: 'REJECTED', reasonCode: 'PAYOUT_INSUFFICIENT_FUNDS' }, 'payoutDeniedInsufficient'],
      [{ outcome: 'REJECTED', reasonCode: 'PAYOUT_RISK_DENIED' }, 'payoutDeniedRisk'],
      [{ outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID' }, 'payoutDeniedInvalid']
    ] as [PayoutCommandResult, string][]) {
      await handler.execute({
        command: {
          kind: 'confirm', route: 'US:USD', amount: '5000000',
          beneficiaryRef: 'BEN-TEST-0001'
        },
        externalUserId: '888', updateId: 'u2'
      });
      requests.setResult(result);
      const mapped = await handler.consumeAuthorized({
        uid: TEST_UID, externalUserId: '888', proof
      });
      expect(mapped.replyKey).toBe(expected);
    }
  });

  it('S8PU04: /payoutquote renders the estimate', async () => {
    const { handler } = makeHandler({ bindings: [{ uid: TEST_UID }] });
    const result = await handler.execute({
      command: { kind: 'quote', route: 'US:USD', amount: '5000000' },
      externalUserId: '888',
      updateId: 'u1'
    });
    expect(result.text).toContain('US:USD');
    expect(result.text).toContain('5000000');
    expect(result.text).toContain('2000');
    expect(result.text).toContain('4998000');
    expect(result.text).toContain('以实际为准');
    const unknown = await handler.execute({
      command: { kind: 'quote', route: 'XX:XXX', amount: '500000' },
      externalUserId: '888',
      updateId: 'u2'
    });
    expect(unknown.text).toBe(payoutReplyText('payoutQuoteRouteNotFound'));
  });

  it('S8PU05: /payoutcapa renders whitelisted config facts', async () => {
    const { handler } = makeHandler({ bindings: [{ uid: TEST_UID }] });
    const result = await handler.execute({
      command: { kind: 'capabilities' },
      externalUserId: '888',
      updateId: 'u1'
    });
    expect(result.text).toContain('US:USD');
    expect(result.text).toContain('2000');
    expect(result.text).toContain('100000');
  });

  it('S8PU06: status maps eight states and the route whitelist holds', async () => {
    const states = [
      'FUNDS_RESERVED', 'SUBMITTING', 'ACCEPTED', 'SUCCEEDED',
      'FAILED', 'UNKNOWN', 'REFUNDED', 'REVERSED'
    ];
    for (const status of states) {
      const { handler } = makeHandler({
        bindings: [{ uid: TEST_UID }],
        orders: [{ status }]
      });
      const result = await handler.execute({
        command: { kind: 'status', orderRef: 'PO:TG:AB12CD34' },
        externalUserId: '888',
        updateId: 'u1'
      });
      expect(result.text).toBe(payoutReplyText(statusReplyOf(status)));
    }
    const unknown = makeHandler({ bindings: [{ uid: TEST_UID }], orders: [] });
    expect(
      (await unknown.handler.execute({
        command: { kind: 'status', orderRef: 'PO:TG:AB12CD34' },
        externalUserId: '888',
        updateId: 'u2'
      })).text
    ).toBe(payoutReplyText('payoutStatusUnknown'));
    expect(
      renderNumeric('{0}', [{ kind: 'route', value: 'US:USD' }])
    ).toBe('US:USD');
    expect(() =>
      renderNumeric('{0}', [{ kind: 'route', value: 'us:usd' }])
    ).toThrow();
    expect(() =>
      renderNumeric('{0}', [{ kind: 'route', value: 'USA:USDX' }])
    ).toThrow();
  });

  it('S8PU07: notification topics render static texts and sources stay clean', async () => {
    const sent: { readonly text: string }[] = [];
    const texts = new Map<string, string>([
      ['telegram.payout-requested.v1', PAYOUT_REPLIES.payoutNotifyRequested],
      ['telegram.payout-submitted.v1', PAYOUT_REPLIES.payoutNotifySubmitted],
      ['telegram.payout-succeeded.v1', PAYOUT_REPLIES.payoutNotifySucceeded],
      ['telegram.payout-failed.v1', PAYOUT_REPLIES.payoutNotifyFailed],
      ['telegram.payout-refunded.v1', PAYOUT_REPLIES.payoutNotifyRefunded],
      ['telegram.payout-reversed.v1', PAYOUT_REPLIES.payoutNotifyReversed]
    ]);
    const notificationHandler = new WithdrawalNotificationHandler(
      {
        sendPrompt: async (input) => {
          sent.push(input);
        }
      } as never,
      {
        findExternalUserIdByUid: async (uid) =>
          uid === TEST_UID ? '888' : null
      },
      texts
    );
    for (const [topic] of texts) {
      await notificationHandler.handle({
        topic, eventKey: `k-${topic}`, payload: { uid: TEST_UID }
      } as never);
    }
    expect(sent).toHaveLength(6);
    expect(new Set(sent.map((s) => s.text))).toEqual(new Set(texts.values()));
    const repliesSource = await readFile(
      resolve(import.meta.dirname, '../../src/modules/telegram/application/payout-replies.ts'),
      'utf8'
    );
    expect(repliesSource.match(/\$\{|`/u) ?? []).toEqual([]);
    const handlerSource = await readFile(
      resolve(import.meta.dirname, '../../src/modules/telegram/application/payout-command.handler.ts'),
      'utf8'
    );
    expect(
      handlerSource.match(/message\.text|payload\.[A-Za-z]+\s*\+/u) ?? []
    ).toEqual([]);
    expect(handlerSource.match(/renderNumeric\(/gu)?.length ?? 0)
      .toBeGreaterThan(0);
  });
});

function statusReplyOf(status: string): string {
  const map: Record<string, string> = {
    FUNDS_RESERVED: 'payoutStatusFundsReserved',
    SUBMITTING: 'payoutStatusSubmitting',
    ACCEPTED: 'payoutStatusAccepted',
    SUCCEEDED: 'payoutStatusSucceeded',
    FAILED: 'payoutStatusFailed',
    UNKNOWN: 'payoutStatusUnknownState',
    REFUNDED: 'payoutStatusRefunded',
    REVERSED: 'payoutStatusReversed'
  };
  return map[status]!;
}
