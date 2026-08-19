import type { LeasedOutboxMessage, OutboxHandler } from '@xht/contracts';
import type { TelegramBotGateway } from '../infrastructure/telegram/telegram-bot.gateway.js';

export interface WithdrawalBindingLookup {
  findExternalUserIdByUid(uid: string): Promise<string | null>;
}

export class WithdrawalNotificationInvalidError extends Error {
  public readonly workerFailureClassification = 'PERMANENT' as const;
  constructor() {
    super('WITHDRAWAL_NOTIFICATION_INVALID');
    this.name = 'WithdrawalNotificationInvalidError';
  }
}

export class WithdrawalBindingNotFoundError extends Error {
  public readonly workerFailureClassification = 'PERMANENT' as const;
  constructor() {
    super('WITHDRAWAL_BINDING_NOT_FOUND');
    this.name = 'WithdrawalBindingNotFoundError';
  }
}

export const WITHDRAWAL_NOTIFICATION_TOPICS = [
  'telegram.withdrawal-requested.v1',
  'telegram.withdrawal-approved.v1',
  'telegram.withdrawal-rejected.v1',
  'telegram.withdrawal-broadcast.v1',
  'telegram.withdrawal-succeeded.v1',
  'telegram.withdrawal-failed.v1',
  'telegram.withdrawal-refunded.v1'
] as const;

export type WithdrawalNotificationTopic =
  (typeof WITHDRAWAL_NOTIFICATION_TOPICS)[number];

/**
 * Renders withdrawal outbox notifications: the topic alone selects the
 * injected static text — no payload value is ever interpolated into
 * the message, and unknown topics or shapes fail permanently.
 */
export class WithdrawalNotificationHandler implements OutboxHandler {
  readonly #gateway: TelegramBotGateway;
  readonly #bindings: WithdrawalBindingLookup;
  readonly #texts: ReadonlyMap<string, string>;

  constructor(
    gateway: TelegramBotGateway,
    bindings: WithdrawalBindingLookup,
    texts: ReadonlyMap<string, string>
  ) {
    this.#gateway = gateway;
    this.#bindings = bindings;
    this.#texts = texts;
  }

  public async handle(message: LeasedOutboxMessage): Promise<void> {
    const text = this.#texts.get(message.topic);
    if (text === undefined) {
      throw new WithdrawalNotificationInvalidError();
    }
    const payload = message.payload as { readonly uid?: unknown };
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof payload.uid !== 'string' ||
      payload.uid.length === 0
    ) {
      throw new WithdrawalNotificationInvalidError();
    }
    const externalUserId = await this.#bindings.findExternalUserIdByUid(
      payload.uid
    );
    if (externalUserId === null) {
      throw new WithdrawalBindingNotFoundError();
    }
    const sendPrompt = this.#gateway.sendPrompt;
    if (sendPrompt === undefined) {
      throw new WithdrawalNotificationInvalidError();
    }
    await sendPrompt({
      externalUserId,
      text,
      idempotencyKey: message.eventKey
    });
  }
}

Object.freeze(WithdrawalNotificationHandler.prototype);
