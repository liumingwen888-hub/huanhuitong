import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AuthorizePaymentProofV1,
  Uid,
  WithdrawalCommandResult
} from '@xht/contracts';
import {
  classifyWithdrawalUpdate,
  type WithdrawalCommand
} from '../../src/modules/telegram/application/withdrawal-commands.js';
import {
  WITHDRAWAL_REPLIES,
  withdrawalReplyText
} from '../../src/modules/telegram/application/withdrawal-replies.js';
import { SecurityFlowRegistry } from '../../src/modules/telegram/application/security-flow.registry.js';
import {
  WithdrawalCommandHandler
} from '../../src/modules/telegram/application/withdrawal-command.handler.js';
import {
  WithdrawalNotificationHandler,
  WithdrawalNotificationInvalidError,
  WithdrawalBindingNotFoundError
} from '../../../worker/src/outbox/withdrawal-notification.handler.js';

const TEST_UID = '11111111-2222-3333-4444-555566667777' as Uid;

function privateMessage(text: string): object {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 4242, is_bot: false, first_name: 'W' },
      chat: { id: 4242, type: 'private' },
      date: 1,
      text
    }
  };
}

interface FakeRow {
  readonly uid?: string;
  readonly status?: string;
}

function makeFakeUnitOfWork(rowsByTable: {
  bindings?: FakeRow[];
  withdrawals?: FakeRow[];
}) {
  const inserts: string[] = [];
  return {
    inserts,
    async execute<T>(
      work: (context: {
        executeSql<R>(sql: string, params: readonly unknown[]): Promise<{
          rows: R[];
        }>;
      }) => T | PromiseLike<T>
    ): Promise<T> {
      const context = {
        async executeSql<R>(
          sql: string,
          _params: readonly unknown[]
        ): Promise<{ rows: R[] }> {
          if (sql.includes('INSERT INTO outbox_messages')) {
            inserts.push(sql);
            return { rows: [] as R[] };
          }
          if (sql.includes('FROM channel_bindings')) {
            return { rows: (rowsByTable.bindings ?? []) as R[] };
          }
          if (sql.includes('FROM withdrawal_orders')) {
            return { rows: (rowsByTable.withdrawals ?? []) as R[] };
          }
          return { rows: [] as R[] };
        }
      };
      return await work(context);
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

function makeFakeRequests() {
  const calls: {
    readonly command: {
      readonly orderRef: string;
      readonly uid: Uid;
      readonly assetCode: string;
      readonly amount: string;
      readonly destinationAddress: string;
    };
    readonly proof: AuthorizePaymentProofV1;
  }[] = [];
  let result: WithdrawalCommandResult = {
    outcome: 'ACCEPTED',
    order: {
      withdrawalId: 'wd-1',
      orderRef: 'WD:TG:TEST',
      uid: TEST_UID,
      assetCode: 'USDT-TRC20',
      amount: '500000',
      feeAmount: '1000',
      destinationAddress: 'TDestinationTestAddress',
      status: 'APPROVED',
      freezeLedgerTransactionId: 'tx-1',
      settlementLedgerTransactionId: null,
      broadcastTxid: null,
      approverAdminId: null,
      rejectionReason: null,
      failureReason: null,
      createdAt: new Date().toISOString()
    }
  };
  return {
    calls,
    setResult(next: WithdrawalCommandResult): void {
      result = next;
    },
    async request(
      command: {
        readonly orderRef: string;
        readonly uid: Uid;
        readonly assetCode: string;
        readonly amount: string;
        readonly destinationAddress: string;
      },
      proof: AuthorizePaymentProofV1
    ): Promise<WithdrawalCommandResult> {
      calls.push({ command, proof });
      return result;
    }
  };
}

function makeHandler(
  options: {
    readonly bindings?: FakeRow[];
    readonly withdrawals?: FakeRow[];
  } = {}
): {
  readonly handler: WithdrawalCommandHandler;
  readonly sessions: ReturnType<typeof makeFakeSessions>;
  readonly requests: ReturnType<typeof makeFakeRequests>;
  readonly flows: SecurityFlowRegistry;
  readonly unitOfWork: ReturnType<typeof makeFakeUnitOfWork>;
} {
  const unitOfWork = makeFakeUnitOfWork(options);
  const sessions = makeFakeSessions();
  const requests = makeFakeRequests();
  const flows = new SecurityFlowRegistry();
  const handler = new WithdrawalCommandHandler(
    unitOfWork as never,
    sessions as never,
    requests as never,
    flows
  );
  return { handler, sessions, requests, flows, unitOfWork };
}

function makeProof(overrides: Partial<AuthorizePaymentProofV1> = {}): AuthorizePaymentProofV1 {
  return Object.freeze({
    type: 'security.payment-authorized.v1',
    uid: TEST_UID,
    operationType: 'withdrawal',
    orderRef: 'WD:TG:TEST',
    amountSummary: '500000',
    assetSummary: 'USDT-TRC20',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sessionId: 'session-1',
    ...overrides
  });
}

describe('S6-7 withdrawal telegram UX', () => {
  it('S6WU01: parser accepts valid shapes and rejects invalid ones', () => {
    const good = classifyWithdrawalUpdate(
      privateMessage('/withdraw USDT-TRC20 500000 TDestinationAddress1234')
    );
    expect(good?.command).toEqual({
      kind: 'withdraw',
      assetCode: 'USDT-TRC20',
      amount: '500000',
      destinationAddress: 'TDestinationAddress1234'
    });
    expect(good?.externalUserId).toBe('4242');
    const status = classifyWithdrawalUpdate(
      privateMessage('/withdrawstatus WD:TG:ABC12345')
    );
    expect(status?.command).toEqual({
      kind: 'status',
      orderRef: 'WD:TG:ABC12345'
    });
    const invalid = [
      '/withdraw USDT-TRC20 500000',                       // missing address
      '/withdraw usdt-trc20 500000 TDestinationAddress1234', // lowercase asset
      '/withdraw USDT-TRC20 0 TDestinationAddress1234',    // zero amount
      '/withdraw USDT-TRC20 500000 ShortAddr',             // short address
      '/withdraw USDT-TRC20 500000x TDestinationAddress1234', // non-numeric amount
      '/withdrawstatus',                                    // missing ref
      '/withdrawstatus x'                                   // too-short ref
    ];
    for (const text of invalid) {
      expect(classifyWithdrawalUpdate(privateMessage(text))).toBeNull();
    }
    const group = {
      update_id: 2,
      message: {
        chat: { id: -100, type: 'group' },
        from: { id: 4242 },
        text: '/withdraw USDT-TRC20 500000 TDestinationAddress1234'
      }
    };
    expect(classifyWithdrawalUpdate(group)).toBeNull();
  });

  it('S6WU02: /withdraw opens the session with real binding values', async () => {
    const { handler, sessions, flows, unitOfWork } = makeHandler({
      bindings: [{ uid: TEST_UID }]
    });
    const outcome = await handler.execute({
      command: {
        kind: 'withdraw',
        assetCode: 'USDT-TRC20',
        amount: '500000',
        destinationAddress: 'TDestinationAddress1234'
      },
      externalUserId: '4242',
      updateId: 'u1'
    });
    expect(outcome.reply).toBe('withdrawPrompt');
    expect(sessions.begun).toHaveLength(1);
    expect(sessions.begun[0]).toMatchObject({
      uid: TEST_UID,
      operationType: 'withdrawal',
      amountSummary: '500000',
      assetSummary: 'USDT-TRC20'
    });
    expect(sessions.begun[0]!.orderRef).toMatch(/^WD:TG:[0-9A-F]{8}$/u);
    const flow = flows.get('4242');
    expect(flow?.mode).toBe('authorize');
    expect(flow?.sessionId).toBe('session-1');
    expect(unitOfWork.inserts).toHaveLength(1);
    const unbound = makeHandler({ bindings: [] });
    expect(
      (await unbound.handler.execute({
        command: {
          kind: 'withdraw',
          assetCode: 'USDT-TRC20',
          amount: '500000',
          destinationAddress: 'TDestinationAddress1234'
        },
        externalUserId: '4242',
        updateId: 'u2'
      })).reply
    ).toBe('withdrawNotBound');
  });

  it('S6WU03: authorized continuation maps outcomes to category replies', async () => {
    const { handler, requests } = makeHandler({ bindings: [{ uid: TEST_UID }] });
    await handler.execute({
      command: {
        kind: 'withdraw',
        assetCode: 'USDT-TRC20',
        amount: '500000',
        destinationAddress: 'TDestinationAddress1234'
      },
      externalUserId: '4242',
      updateId: 'u1'
    });
    const acceptedAuto = await handler.consumeAuthorized({
      uid: TEST_UID,
      externalUserId: '4242',
      proof: makeProof()
    });
    expect(acceptedAuto.replyKey).toBe('withdrawAcceptedAuto');
    expect(acceptedAuto.text)
      .toBe(withdrawalReplyText('withdrawAcceptedAuto'));
    expect(requests.calls).toHaveLength(1);
    expect(requests.calls[0]!.command.amount).toBe('500000');
    expect(requests.calls[0]!.proof.assetSummary).toBe('USDT-TRC20');

    const cases: [WithdrawalCommandResult, string][] = [
      [
        {
          outcome: 'ACCEPTED',
          order: {
            ...makeProoflessOrder(),
            status: 'PENDING_APPROVAL'
          }
        },
        'withdrawAcceptedPendingApproval'
      ],
      [
        {
          outcome: 'ALREADY_REQUESTED',
          order: makeProoflessOrder()
        },
        'withdrawDuplicate'
      ],
      [{ outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_POLICY_NOT_FOUND' }, 'withdrawDeniedUnavailable'],
      [{ outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_AMOUNT_ABOVE_MAX' }, 'withdrawDeniedTooLarge'],
      [{ outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_INSUFFICIENT_FUNDS' }, 'withdrawDeniedInsufficient'],
      [{ outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_RISK_DENIED' }, 'withdrawDeniedRisk'],
      [{ outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_COMMAND_INVALID' }, 'withdrawDeniedInvalid']
    ];
    for (const [result, expectedReply] of cases) {
      await handler.execute({
        command: {
          kind: 'withdraw',
          assetCode: 'USDT-TRC20',
          amount: '500000',
          destinationAddress: 'TDestinationAddress1234'
        },
        externalUserId: '4242',
        updateId: 'u2'
      });
      requests.setResult(result);
      const outcome = await handler.consumeAuthorized({
        uid: TEST_UID,
        externalUserId: '4242',
        proof: makeProof()
      });
      expect(outcome.replyKey).toBe(expectedReply);
      expect(outcome.text).toBe(withdrawalReplyText(expectedReply as never));
    }
    const noPending = await handler.consumeAuthorized({
      uid: TEST_UID,
      externalUserId: '9999',
      proof: makeProof()
    });
    expect(noPending.replyKey).toBe('withdrawDeniedInvalid');
  });

  it('S6WU04: missing pending context is denied before any service call', async () => {
    const { handler, requests } = makeHandler({ bindings: [{ uid: TEST_UID }] });
    const outcome = await handler.consumeAuthorized({
      uid: TEST_UID,
      externalUserId: '4242',
      proof: makeProof({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    });
    expect(outcome.replyKey).toBe('withdrawDeniedInvalid');
    expect(outcome.text).toBe(withdrawalReplyText('withdrawDeniedInvalid'));
    expect(requests.calls).toHaveLength(0);
  });

  it('S6WU05: status maps the ten states and hides foreign orders', async () => {
    const statuses = [
      'FROZEN', 'PENDING_APPROVAL', 'APPROVED', 'SIGNING', 'BROADCAST',
      'CONFIRMED', 'REJECTED', 'FAILED', 'EXPIRED', 'REFUNDED'
    ];
    for (const status of statuses) {
      const { handler } = makeHandler({
        bindings: [{ uid: TEST_UID }],
        withdrawals: [{ status }]
      });
      const outcome = await handler.execute({
        command: { kind: 'status', orderRef: 'WD:TG:KNOWN01' },
        externalUserId: '4242',
        updateId: 'u1'
      });
      expect(outcome.reply).toBe(`withdrawStatus${status
        .split('_')
        .map((part) => part[0]! + part.slice(1).toLowerCase())
        .join('')}` as never);
    }
    const unknown = makeHandler({
      bindings: [{ uid: TEST_UID }],
      withdrawals: []
    });
    expect(
      (await unknown.handler.execute({
        command: { kind: 'status', orderRef: 'WD:TG:MISSING' },
        externalUserId: '4242',
        updateId: 'u2'
      })).reply
    ).toBe('withdrawStatusUnknown');
  });

  it('S6WU06: notification handler renders static text per topic', async () => {
    const sent: {
      readonly externalUserId: string;
      readonly text: string;
      readonly idempotencyKey: string;
    }[] = [];
    const texts = new Map<string, string>([
      ['telegram.withdrawal-requested.v1', WITHDRAWAL_REPLIES.withdrawNotifyRequested],
      ['telegram.withdrawal-approved.v1', WITHDRAWAL_REPLIES.withdrawNotifyApproved],
      ['telegram.withdrawal-rejected.v1', WITHDRAWAL_REPLIES.withdrawNotifyRejected],
      ['telegram.withdrawal-broadcast.v1', WITHDRAWAL_REPLIES.withdrawNotifyBroadcast],
      ['telegram.withdrawal-succeeded.v1', WITHDRAWAL_REPLIES.withdrawNotifySucceeded],
      ['telegram.withdrawal-failed.v1', WITHDRAWAL_REPLIES.withdrawNotifyFailed],
      ['telegram.withdrawal-refunded.v1', WITHDRAWAL_REPLIES.withdrawNotifyRefunded]
    ]);
    const handler = new WithdrawalNotificationHandler(
      {
        sendPrompt: async (input) => {
          sent.push(input);
        }
      } as never,
      {
        findExternalUserIdByUid: async (uid) =>
          uid === TEST_UID ? '4242' : null
      },
      texts
    );
    for (const [topic, text] of texts) {
      await handler.handle({
        topic,
        eventKey: `key-${topic}`,
        payload: { uid: TEST_UID }
      } as never);
    }
    expect(sent).toHaveLength(7);
    expect(new Set(sent.map((s) => s.text))).toEqual(new Set(texts.values()));
    expect(sent.every((s) => s.idempotencyKey.startsWith('key-'))).toBe(true);
    await expect(
      handler.handle({
        topic: 'telegram.unknown.v1',
        eventKey: 'k',
        payload: { uid: TEST_UID }
      } as never)
    ).rejects.toBeInstanceOf(WithdrawalNotificationInvalidError);
    await expect(
      handler.handle({
        topic: 'telegram.withdrawal-approved.v1',
        eventKey: 'k',
        payload: {}
      } as never)
    ).rejects.toBeInstanceOf(WithdrawalNotificationInvalidError);
    await expect(
      handler.handle({
        topic: 'telegram.withdrawal-approved.v1',
        eventKey: 'k',
        payload: { uid: '00000000-0000-0000-0000-000000000000' }
      } as never)
    ).rejects.toBeInstanceOf(WithdrawalBindingNotFoundError);
  });

  it('S6WU03b: reply and handler sources carry zero dynamic interpolation', async () => {
    const sources = await Promise.all([
      readFile(
        resolve(import.meta.dirname, '../../src/modules/telegram/application/withdrawal-replies.ts'),
        'utf8'
      ),
      readFile(
        resolve(import.meta.dirname, '../../src/modules/telegram/application/withdrawal-command.handler.ts'),
        'utf8'
      ),
      readFile(
        resolve(import.meta.dirname, '../../../worker/src/outbox/withdrawal-notification.handler.ts'),
        'utf8'
      )
    ]);
    const [repliesSource, handlerSource, notificationSource] = sources;
    // user-facing text constants: no interpolation of any kind
    expect(repliesSource.match(/\$\{|`/u) ?? []).toEqual([]);
    for (const text of Object.values(WITHDRAWAL_REPLIES)) {
      expect(text.includes('$')).toBe(false);
      expect(text.includes('{')).toBe(false);
    }
    // handlers must never derive text from raw message or payload values
    for (const source of [handlerSource, notificationSource]) {
      expect(source.match(/message\.text|payload\.[A-Za-z]+\s*\+|\+\s*payload\./u) ?? [])
        .toEqual([]);
    }
  });
});

function makeProoflessOrder() {
  return {
    withdrawalId: 'wd-1',
    orderRef: 'WD:TG:TEST',
    uid: TEST_UID,
    assetCode: 'USDT-TRC20',
    amount: '500000',
    feeAmount: '1000',
    destinationAddress: 'TDestinationTestAddress',
    status: 'APPROVED',
    freezeLedgerTransactionId: 'tx-1',
    settlementLedgerTransactionId: null,
    broadcastTxid: null,
    approverAdminId: null,
    rejectionReason: null,
    failureReason: null,
    createdAt: new Date().toISOString()
  } as const;
}
