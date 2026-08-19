import { randomUUID } from 'node:crypto';
import type {
  InboxDigestSet,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { PostgresInboxRepository } from '../../reliability/inbox/inbox.repository.js';
import { PostgresOutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { InboxRepository } from '../../reliability/inbox/inbox.types.js';
import type { CredentialSessionService } from '../../security/application/credential-session.service.js';
import type { SecurityCommand } from './security-commands.js';
import {
  SECURITY_REPLIES,
  securityReplyText,
  type SecurityReply
} from './security-replies.js';

export interface SecurityCommandInput {
  readonly rawUpdate: object;
  readonly digestSet: InboxDigestSet;
  readonly command: SecurityCommand;
  readonly externalUserId: string;
  readonly updateId: string;
}

export interface SecurityCommandOutcome {
  readonly reply: SecurityReply;
  readonly claim:
    | 'claimed'
    | 'duplicate_same_payload'
    | 'conflict'
    | 'digest_key_unavailable';
}

interface OpenFlow {
  readonly sessionId: string;
  readonly phase: 'primary' | 'confirmation';
  readonly mode: 'setup' | 'authorize';
}

const SECURITY_PROMPT_TOPIC = 'telegram.security-prompt.v1';

/**
 * Orchestrates security UX commands inside one UoW: the security update is
 * claimed in the inbox (idempotent by update_id), the credential session is
 * driven, and the user-facing reply is enqueued as an outbox prompt whose
 * payload carries only chat reference material — never digits, input text,
 * or anything derived from them.
 */
export class SecurityCommandHandler {
  readonly #unitOfWork: UnitOfWork;
  readonly #sessions: CredentialSessionService;
  readonly #inbox: InboxRepository = new PostgresInboxRepository();
  readonly #outbox: OutboxRepository = new PostgresOutboxRepository();
  readonly #flows = new Map<string, OpenFlow>();

  constructor(unitOfWork: UnitOfWork, sessions: CredentialSessionService) {
    this.#unitOfWork = unitOfWork;
    this.#sessions = sessions;
  }

  public async execute(input: SecurityCommandInput): Promise<SecurityCommandOutcome> {
    const claimResult = await this.#unitOfWork.execute(async (transaction) => {
      const claim = await this.#inbox.claim(transaction, {
        consumer: 'telegram-security-v1',
        externalMessageId: `security:${input.updateId}`,
        digests: input.digestSet,
        correlationId: randomUUID(),
        claimant: 'telegram-security-v1',
        receivedAt: new Date()
      });
      if (claim.kind !== 'claimed') {
        return { nonClaim: claim.kind } as const;
      }
      return { lease: claim.lease } as const;
    });
    if ('nonClaim' in claimResult) {
      return {
        reply: 'internalError',
        claim: claimResult.nonClaim as SecurityCommandOutcome['claim']
      };
    }
    const uid = await this.#unitOfWork.execute((transaction) =>
      this.#resolveUid(transaction, input.externalUserId)
    );
    let handled: { reply: SecurityReply; prompt: { readonly chatRef: string; readonly reply: SecurityReply } | null };
    if (uid === null) {
      handled = { reply: 'notInSession', prompt: null };
    } else {
      handled = await this.#dispatch(uid, input);
    }
    await this.#unitOfWork.execute((transaction) =>
      this.#inbox.markProcessed(transaction, { lease: claimResult.lease })
    );
    if (handled.prompt !== null) {
      await this.#enqueuePrompt(handled.prompt);
    }
    return { reply: handled.reply, claim: 'claimed' };
  }

  async #dispatch(
    uid: Uid,
    input: SecurityCommandInput
  ): Promise<{
    reply: SecurityReply;
    prompt: { readonly chatRef: string; readonly reply: SecurityReply } | null;
  }> {
    const command = input.command;
    try {
      if (command.kind === 'begin-setup') {
        const begun = await this.#sessions.beginSetup(uid);
        this.#flows.set(input.externalUserId, {
          sessionId: begun.sessionId,
          phase: 'primary',
          mode: 'setup'
        });
        return { reply: 'setupStarted', prompt: { chatRef: input.externalUserId, reply: 'setupStarted' } };
      }
      if (command.kind === 'begin-authorize') {
        const begun = await this.#sessions.beginAuthorization({
          uid,
          operationType: 'withdrawal',
          orderRef: command.orderRef,
          amountSummary: '0',
          assetSummary: 'DEMO'
        });
        this.#flows.set(input.externalUserId, {
          sessionId: begun.sessionId,
          phase: 'primary',
          mode: 'authorize'
        });
        return { reply: 'authorizePrompt', prompt: { chatRef: input.externalUserId, reply: 'authorizePrompt' } };
      }
      const flow = this.#flows.get(input.externalUserId);
      if (command.kind === 'cancel') {
        if (flow !== undefined) {
          await this.#sessions.cancel(flow.sessionId);
          this.#flows.delete(input.externalUserId);
        }
        return { reply: 'cancelled', prompt: { chatRef: input.externalUserId, reply: 'cancelled' } };
      }
      if (flow === undefined) {
        return { reply: 'notInSession', prompt: null };
      }
      if (command.kind === 'digits') {
        for (const [index, digit] of [...command.value].entries()) {
          this.#sessions.appendDigit({
            sessionId: flow.sessionId,
            actionNonce: `sec:${input.updateId}:${index}:${flow.phase}`,
            digit,
            phase: flow.phase
          });
        }
        return { reply: flow.mode === 'setup' ? 'setupStarted' : 'authorizePrompt', prompt: null };
      }
      // command.kind === 'done'
      if (flow.mode === 'authorize') {
        const result = await this.#sessions.authorizePayment(flow.sessionId);
        this.#flows.delete(input.externalUserId);
        const reply: SecurityReply =
          result.kind === 'authorized' ? 'authorized' : 'rejected';
        return { reply, prompt: { chatRef: input.externalUserId, reply } };
      }
      if (flow.phase === 'primary') {
        this.#flows.set(input.externalUserId, {
          ...flow,
          phase: 'confirmation'
        });
        return { reply: 'confirmPhase', prompt: { chatRef: input.externalUserId, reply: 'confirmPhase' } };
      }
      await this.#sessions.confirmSetup(flow.sessionId);
      this.#flows.delete(input.externalUserId);
      return { reply: 'setupSuccess', prompt: { chatRef: input.externalUserId, reply: 'setupSuccess' } };
    } catch (error) {
      return this.#mapError(error, input.externalUserId);
    }
  }

  #mapError(
    error: unknown,
    chatRef: string
  ): {
    reply: SecurityReply;
    prompt: { readonly chatRef: string; readonly reply: SecurityReply } | null;
  } {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'SESSION_ALREADY_OPEN') {
      return { reply: 'sessionAlreadyOpen', prompt: { chatRef, reply: 'sessionAlreadyOpen' } };
    }
    if (message === 'SESSION_RATE_LIMITED') {
      return { reply: 'rateLimited', prompt: { chatRef, reply: 'rateLimited' } };
    }
    if (message === 'ENTRIES_MISMATCH') {
      this.#flows.delete(chatRef);
      return { reply: 'entriesMismatch', prompt: { chatRef, reply: 'entriesMismatch' } };
    }
    if (message === 'DIGITS_OUT_OF_POLICY_RANGE') {
      this.#flows.delete(chatRef);
      return { reply: 'outOfRange', prompt: { chatRef, reply: 'outOfRange' } };
    }
    if (message === 'CREDENTIAL_DIGIT_INVALID' || message === 'SESSION_NONCE_REUSED') {
      return { reply: 'notInSession', prompt: null };
    }
    return { reply: 'internalError', prompt: { chatRef, reply: 'internalError' } };
  }

  async #enqueuePrompt(prompt: {
    readonly chatRef: string;
    readonly reply: SecurityReply;
  }): Promise<void> {
    await this.#unitOfWork.execute(async (transaction) => {
      const eventId = randomUUID();
      await this.#outbox.enqueue(transaction, {
        id: eventId,
        topic: SECURITY_PROMPT_TOPIC,
        eventKey: `security-prompt:${eventId}`,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        payload: {
          type: SECURITY_PROMPT_TOPIC,
          eventId,
          chatRef: prompt.chatRef,
          replyKey: prompt.reply,
          text: securityReplyText(prompt.reply)
        }
      });
    });
  }

  async #resolveUid(
    transaction: TransactionContext,
    externalUserId: string
  ): Promise<Uid | null> {
    const rows = await transaction.executeSql<{ uid: string }>(
      `SELECT uid FROM channel_bindings
        WHERE channel_type='TELEGRAM' AND external_user_id=$1
          AND status='ACTIVE' LIMIT 1`,
      [externalUserId]
    );
    return (rows.rows[0]?.uid as Uid) ?? null;
  }
}
