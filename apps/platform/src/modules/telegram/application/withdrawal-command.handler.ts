import { randomUUID } from 'node:crypto';
import type { AuthorizePaymentProofV1, Uid } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { CredentialSessionService } from '../../security/application/credential-session.service.js';
import type { WithdrawalRequestService } from '../../withdrawals/application/withdrawal-request.service.js';
import type { WithdrawalCommand } from './withdrawal-commands.js';
import {
  withdrawalReplyText,
  type WithdrawalReply
} from './withdrawal-replies.js';
import type { SecurityFlowRegistry } from './security-flow.registry.js';

export interface WithdrawalCommandInput {
  readonly command: WithdrawalCommand;
  readonly externalUserId: string;
  readonly updateId: string;
}

export interface WithdrawalCommandOutcome {
  readonly reply: WithdrawalReply;
}

interface PendingWithdrawal {
  readonly orderRef: string;
  readonly assetCode: string;
  readonly amount: string;
  readonly destinationAddress: string;
}

const WITHDRAWAL_PROMPT_TOPIC = 'telegram.security-prompt.v1';

/**
 * Telegram UX for withdrawals: parses /withdraw, opens the payment
 * authorization session with the REAL S6-2 binding values (orderRef,
 * amountSummary = the decimal amount, assetSummary = the asset code),
 * and registers the flow in the shared registry so the security
 * handler can drive digit collection. The authorized continuation
 * consumes the proof through WithdrawalRequestService and maps the
 * result to category constants — never interpolated text.
 */
export class WithdrawalCommandHandler {
  readonly #unitOfWork: UnitOfWork;
  readonly #sessions: CredentialSessionService;
  readonly #requests: WithdrawalRequestService;
  readonly #flows: SecurityFlowRegistry;
  readonly #pending = new Map<string, PendingWithdrawal>();

  constructor(
    unitOfWork: UnitOfWork,
    sessions: CredentialSessionService,
    requests: WithdrawalRequestService,
    flows: SecurityFlowRegistry
  ) {
    this.#unitOfWork = unitOfWork;
    this.#sessions = sessions;
    this.#requests = requests;
    this.#flows = flows;
  }

  public async execute(
    input: WithdrawalCommandInput
  ): Promise<WithdrawalCommandOutcome> {
    const uid = await this.#resolveUid(input.externalUserId);
    if (uid === null) {
      return { reply: 'withdrawNotBound' };
    }
    try {
      return await this.#dispatch(uid, input);
    } catch {
      return { reply: 'internalError' };
    }
  }

  /**
   * Authorized continuation invoked by the security handler once the
   * payment proof is issued: submits the pending withdrawal through
   * the S6-2 service and renders the categorical reply.
   */
  public async consumeAuthorized(input: {
    readonly uid: Uid;
    readonly externalUserId: string;
    readonly proof: AuthorizePaymentProofV1;
  }): Promise<{ readonly replyKey: string; readonly text: string }> {
    const pending = this.#pending.get(input.externalUserId) ?? null;
    this.#pending.delete(input.externalUserId);
    if (pending === null) {
      return {
        replyKey: 'withdrawDeniedInvalid',
        text: withdrawalReplyText('withdrawDeniedInvalid')
      };
    }
    const result = await this.#requests.request(
      {
        orderRef: pending.orderRef,
        uid: input.uid,
        assetCode: pending.assetCode,
        amount: pending.amount,
        destinationAddress: pending.destinationAddress
      },
      input.proof
    );
    const reply = mapRequestResult(result);
    return { replyKey: reply, text: withdrawalReplyText(reply) };
  }

  async #dispatch(
    uid: Uid,
    input: WithdrawalCommandInput
  ): Promise<WithdrawalCommandOutcome> {
    if (input.command.kind === 'status') {
      return await this.#status(uid, input.command.orderRef);
    }
    const orderRef = `WD:TG:${randomUUID().slice(0, 8).toUpperCase()}`;
    const begun = await this.#sessions.beginAuthorization({
      uid,
      operationType: 'withdrawal',
      orderRef,
      amountSummary: input.command.amount,
      assetSummary: input.command.assetCode
    });
    this.#flows.set(input.externalUserId, {
      sessionId: begun.sessionId,
      phase: 'primary',
      mode: 'authorize'
    });
    this.#pending.set(input.externalUserId, {
      orderRef,
      assetCode: input.command.assetCode,
      amount: input.command.amount,
      destinationAddress: input.command.destinationAddress
    });
    await this.#enqueuePrompt(input.externalUserId, 'withdrawPrompt');
    return { reply: 'withdrawPrompt' };
  }

  async #status(uid: Uid, orderRef: string): Promise<WithdrawalCommandOutcome> {
    const status = await this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ status: string }>(
        `SELECT status FROM withdrawal_orders
          WHERE order_ref = $1 AND uid = $2::uuid LIMIT 1`,
        [orderRef, uid]
      );
      return rows.rows[0]?.status ?? null;
    });
    if (status === null) {
      return { reply: 'withdrawStatusUnknown' };
    }
    return { reply: statusReply(status) };
  }

  async #enqueuePrompt(
    externalUserId: string,
    reply: WithdrawalReply
  ): Promise<void> {
    const eventId = randomUUID();
    await this.#unitOfWork.execute(async (transaction) => {
      await transaction.executeSql(
        `INSERT INTO outbox_messages
           (outbox_id, topic, event_key, occurred_at, correlation_id, payload)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::jsonb)`,
        [
          eventId,
          WITHDRAWAL_PROMPT_TOPIC,
          `security-prompt:${eventId}`,
          new Date().toISOString(),
          randomUUID(),
          JSON.stringify({
            type: WITHDRAWAL_PROMPT_TOPIC,
            eventId,
            chatRef: externalUserId,
            replyKey: reply,
            text: withdrawalReplyText(reply)
          })
        ]
      );
    });
  }

  async #resolveUid(externalUserId: string): Promise<Uid | null> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ uid: string }>(
        `SELECT uid FROM channel_bindings
          WHERE channel_type='TELEGRAM' AND external_user_id=$1
            AND status='ACTIVE' LIMIT 1`,
        [externalUserId]
      );
      return (rows.rows[0]?.uid as Uid) ?? null;
    });
  }
}

function mapRequestResult(
  result: Awaited<ReturnType<WithdrawalRequestService['request']>>
): WithdrawalReply {
  if (result.outcome === 'ALREADY_REQUESTED') {
    return 'withdrawDuplicate';
  }
  if (result.outcome === 'ACCEPTED') {
    return result.order.status === 'APPROVED'
      ? 'withdrawAcceptedAuto'
      : 'withdrawAcceptedPendingApproval';
  }
  switch (result.reasonCode) {
    case 'WITHDRAWAL_POLICY_NOT_FOUND':
      return 'withdrawDeniedUnavailable';
    case 'WITHDRAWAL_AMOUNT_ABOVE_MAX':
      return 'withdrawDeniedTooLarge';
    case 'WITHDRAWAL_INSUFFICIENT_FUNDS':
      return 'withdrawDeniedInsufficient';
    case 'WITHDRAWAL_RISK_DENIED':
      return 'withdrawDeniedRisk';
    default:
      return 'withdrawDeniedInvalid';
  }
}

function statusReply(status: string): WithdrawalReply {
  const mapping: Record<string, WithdrawalReply> = {
    FROZEN: 'withdrawStatusFrozen',
    PENDING_APPROVAL: 'withdrawStatusPendingApproval',
    APPROVED: 'withdrawStatusApproved',
    SIGNING: 'withdrawStatusSigning',
    BROADCAST: 'withdrawStatusBroadcast',
    CONFIRMED: 'withdrawStatusConfirmed',
    REJECTED: 'withdrawStatusRejected',
    FAILED: 'withdrawStatusFailed',
    EXPIRED: 'withdrawStatusExpired',
    REFUNDED: 'withdrawStatusRefunded'
  };
  return mapping[status] ?? 'withdrawStatusUnknown';
}

