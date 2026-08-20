import { randomUUID } from 'node:crypto';
import type {
  AuthorizePaymentProofV1,
  PayoutCommandResult,
  Uid
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { CredentialSessionService } from '../../security/application/credential-session.service.js';
import type {
  PayoutCapabilityService
} from '../../fiatpayout/application/payout-capability.service.js';
import type {
  PayoutRequestService
} from '../../fiatpayout/application/payout-request.service.js';
import type { PayoutCommand } from './payout-commands.js';
import {
  PAYOUT_REPLIES,
  payoutReplyText,
  type PayoutReply
} from './payout-replies.js';
import { renderNumeric } from './numeric-render.js';
import type { SecurityFlowRegistry } from './security-flow.registry.js';

export interface PayoutCommandInput {
  readonly command: PayoutCommand;
  readonly externalUserId: string;
  readonly updateId: string;
}

export interface PayoutCommandOutcome {
  readonly reply: PayoutReply;
  readonly text: string;
}

interface PendingPayout {
  readonly orderRef: string;
  readonly route: string;
  readonly amount: string;
  readonly beneficiaryRef: string;
}

const PAYOUT_PROMPT_TOPIC = 'telegram.security-prompt.v1';

/**
 * Telegram UX for payouts: /payout opens the payment authorization
 * session with real binding values (assetSummary binds the ROUTE —
 * the source asset is derived from provider config), registers the
 * flow in the shared registry, and consumes the proof through the
 * authorized continuation. Capability and quote commands render
 * whitelisted config facts only.
 */
export class PayoutCommandHandler {
  readonly #unitOfWork: UnitOfWork;
  readonly #sessions: CredentialSessionService;
  readonly #capabilities: PayoutCapabilityService;
  readonly #requests: PayoutRequestService;
  readonly #flows: SecurityFlowRegistry;
  readonly #pending = new Map<string, PendingPayout>();

  constructor(
    unitOfWork: UnitOfWork,
    sessions: CredentialSessionService,
    capabilities: PayoutCapabilityService,
    requests: PayoutRequestService,
    flows: SecurityFlowRegistry
  ) {
    this.#unitOfWork = unitOfWork;
    this.#sessions = sessions;
    this.#capabilities = capabilities;
    this.#requests = requests;
    this.#flows = flows;
  }

  public async execute(
    input: PayoutCommandInput
  ): Promise<PayoutCommandOutcome> {
    const uid = await this.#resolveUid(input.externalUserId);
    if (uid === null) {
      return outcome('payoutNotBound');
    }
    try {
      return await this.#dispatch(uid, input.command, input.externalUserId);
    } catch {
      return outcome('internalError');
    }
  }

  public async consumeAuthorized(input: {
    readonly uid: Uid;
    readonly externalUserId: string;
    readonly proof: AuthorizePaymentProofV1;
  }): Promise<{ readonly replyKey: string; readonly text: string }> {
    const pending = this.#pending.get(input.externalUserId) ?? null;
    this.#pending.delete(input.externalUserId);
    if (pending === null) {
      return {
        replyKey: 'payoutDeniedInvalid',
        text: payoutReplyText('payoutDeniedInvalid')
      };
    }
    const result = await this.#requests.request(
      {
        orderRef: pending.orderRef,
        uid: input.uid,
        route: pending.route,
        amount: pending.amount,
        beneficiaryRef: pending.beneficiaryRef
      },
      input.proof
    );
    const reply = mapRequestResult(result);
    return { replyKey: reply, text: payoutReplyText(reply) };
  }

  async #dispatch(
    uid: Uid,
    command: PayoutCommand,
    externalUserId: string
  ): Promise<PayoutCommandOutcome> {
    if (command.kind === 'capabilities') {
      const capabilities = await this.#capabilities.getCapabilities();
      if (capabilities.length === 0) {
        return outcome('payoutCapaEmpty');
      }
      const lines = capabilities.map((capability) =>
        renderNumeric(PAYOUT_REPLIES.payoutCapaLineTemplate, [
          { kind: 'route', value: capability.route },
          { kind: 'amount', value: capability.fixedFee },
          { kind: 'amount', value: capability.minAmount },
          { kind: 'amount', value: capability.maxAmount }
        ])
      );
      return {
        reply: 'payoutCapaHeader',
        text: PAYOUT_REPLIES.payoutCapaHeader + '\n' + lines.join('\n')
      };
    }
    if (command.kind === 'quote') {
      const result = await this.#capabilities.quotePayout({
        route: command.route,
        sourceAmount: command.amount
      });
      if (result.outcome === 'QUOTED') {
        return {
          reply: 'payoutQuoteTemplate',
          text: renderNumeric(PAYOUT_REPLIES.payoutQuoteTemplate, [
            { kind: 'route', value: result.quote.route },
            { kind: 'amount', value: result.quote.sourceAmount },
            { kind: 'amount', value: result.quote.fee },
            { kind: 'amount', value: result.quote.estimatedFiat }
          ])
        };
      }
      switch (result.reasonCode) {
        case 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND':
          return outcome('payoutQuoteRouteNotFound');
        case 'PAYOUT_AMOUNT_OUT_OF_RANGE':
          return outcome('payoutQuoteOutOfRange');
        default:
          return outcome('payoutQuoteCommandInvalid');
      }
    }
    if (command.kind === 'confirm') {
      const orderRef = `PO:TG:${randomUUID().slice(0, 8).toUpperCase()}`;
      const begun = await this.#sessions.beginAuthorization({
        uid,
        operationType: 'fiat-payout',
        orderRef,
        amountSummary: command.amount,
        assetSummary: command.route
      });
      this.#flows.set(externalUserId, {
        sessionId: begun.sessionId,
        phase: 'primary',
        mode: 'authorize'
      });
      this.#pending.set(externalUserId, {
        orderRef,
        route: command.route,
        amount: command.amount,
        beneficiaryRef: command.beneficiaryRef
      });
      return outcome('payoutPrompt');
    }
    // status
    const status = await this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ status: string }>(
        `SELECT status FROM payout_orders
          WHERE order_ref = $1 AND uid = $2::uuid LIMIT 1`,
        [command.orderRef, uid]
      );
      return rows.rows[0]?.status ?? null;
    });
    if (status === null) {
      return outcome('payoutStatusUnknown');
    }
    return outcome(statusReply(status));
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
  result: PayoutCommandResult
): PayoutReply {
  if (result.outcome === 'ACCEPTED') {
    return 'payoutAccepted';
  }
  if (result.outcome === 'ALREADY_REQUESTED') {
    return 'payoutAlreadyRequested';
  }
  switch (result.reasonCode) {
    case 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND':
      return 'payoutDeniedConfig';
    case 'PAYOUT_AMOUNT_OUT_OF_RANGE':
      return 'payoutDeniedRange';
    case 'PAYOUT_INSUFFICIENT_FUNDS':
      return 'payoutDeniedInsufficient';
    case 'PAYOUT_RISK_DENIED':
      return 'payoutDeniedRisk';
    default:
      return 'payoutDeniedInvalid';
  }
}

function statusReply(status: string): PayoutReply {
  const mapping: Record<string, PayoutReply> = {
    FUNDS_RESERVED: 'payoutStatusFundsReserved',
    SUBMITTING: 'payoutStatusSubmitting',
    ACCEPTED: 'payoutStatusAccepted',
    SUCCEEDED: 'payoutStatusSucceeded',
    FAILED: 'payoutStatusFailed',
    UNKNOWN: 'payoutStatusUnknownState',
    REFUNDED: 'payoutStatusRefunded',
    REVERSED: 'payoutStatusReversed'
  };
  return mapping[status] ?? 'payoutStatusUnknown';
}

function outcome(key: PayoutReply): PayoutCommandOutcome {
  return { reply: key, text: payoutReplyText(key) };
}
