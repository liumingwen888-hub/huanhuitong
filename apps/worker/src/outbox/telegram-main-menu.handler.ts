import type { LeasedOutboxMessage, OutboxHandler } from '@xht/contracts';
import type { TelegramBotGateway } from '../infrastructure/telegram/telegram-bot.gateway.js';

interface MainMenuPayload {
  readonly type: 'telegram.main-menu-requested.v1';
  readonly eventId: string;
  readonly uid: string;
  readonly bindingId: string;
  readonly menuVersion: 'main-menu-v1';
  readonly occurredAt: string;
  readonly correlationId: string;
}

export interface BindingLookup {
  findExternalUserIdByBindingId(bindingId: string): Promise<string | null>;
}

export interface MainMenuContent {
  readonly text: string;
  readonly buttons: readonly {
    readonly id: string;
    readonly label: string;
  }[];
}

export class MainMenuContentInvalidError extends Error {
  public readonly workerFailureClassification = 'PERMANENT' as const;
  constructor() {
    super('MAIN_MENU_CONTENT_INVALID');
    this.name = 'MainMenuContentInvalidError';
  }
}

export class BindingNotFoundError extends Error {
  public readonly workerFailureClassification = 'PERMANENT' as const;
  constructor() {
    super('BINDING_NOT_FOUND');
    this.name = 'BindingNotFoundError';
  }
}

export class TelegramMainMenuHandler implements OutboxHandler {
  readonly #gateway: TelegramBotGateway;
  readonly #bindings: BindingLookup;
  readonly #content: MainMenuContent;

  constructor(
    gateway: TelegramBotGateway,
    bindings: BindingLookup,
    content: MainMenuContent
  ) {
    this.#gateway = gateway;
    this.#bindings = bindings;
    this.#content = content;
  }

  public async handle(
    message: LeasedOutboxMessage
  ): Promise<void> {
    if (message.topic !== 'telegram.main-menu-requested.v1') {
      throw new MainMenuContentInvalidError();
    }
    const payload = message.payload as unknown as MainMenuPayload;
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof payload.bindingId !== 'string' ||
      payload.bindingId.length === 0
    ) {
      throw new MainMenuContentInvalidError();
    }
    if (
      typeof this.#content.text !== 'string' ||
      !Array.isArray(this.#content.buttons) ||
      this.#content.buttons.length === 0
    ) {
      throw new MainMenuContentInvalidError();
    }
    const externalUserId = await this.#bindings.findExternalUserIdByBindingId(
      payload.bindingId
    );
    if (externalUserId === null) {
      throw new BindingNotFoundError();
    }
    await this.#gateway.sendMainMenu({
      externalUserId,
      text: this.#content.text,
      buttons: this.#content.buttons,
      idempotencyKey: message.eventKey
    });
  }
}
