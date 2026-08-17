import type { ParsedTelegramStartUpdate } from '@xht/contracts';
import type {
  PolicyRequestShape,
  WebhookRequestPolicy
} from './webhook-request-policy.js';
import { parseTelegramUpdate } from './telegram-update.schema.js';
import type { GrammyWebhookAdapter } from './grammy-webhook.adapter.js';

export interface ControllerRequestShape extends PolicyRequestShape {
  readonly body: unknown;
}

export interface ControllerResponseShape {
  status(code: number): { json(payload: unknown): void };
}

export interface TelegramStartHandlerInput {
  readonly rawUpdate: object;
  readonly digestSet: object;
  readonly start: ParsedTelegramStartUpdate;
}

export interface TelegramStartHandler {
  handle(input: TelegramStartHandlerInput): Promise<void>;
}

export interface TelegramDigestProvider {
  digest(rawUpdate: object): object | { readonly unavailable: true };
}

const STATUS_BY_CODE: Record<string, number> = {
  WEBHOOK_HTTPS_REQUIRED: 400,
  WEBHOOK_SECRET_INVALID: 401,
  WEBHOOK_CONTENT_TYPE_INVALID: 415
};

export class DigestUnavailableError extends Error {
  public readonly code = 'WEBHOOK_DIGEST_KEY_UNAVAILABLE' as const;
  constructor() {
    super('WEBHOOK_DIGEST_KEY_UNAVAILABLE');
    this.name = 'DigestUnavailableError';
  }
}

export class TelegramWebhookController {
  constructor(
    private readonly policy: WebhookRequestPolicy,
    private readonly adapter: GrammyWebhookAdapter,
    private readonly digests: TelegramDigestProvider,
    private readonly startHandler: TelegramStartHandler
  ) {}

  public receive(
    request: ControllerRequestShape,
    response: ControllerResponseShape,
    next: (error?: unknown) => void
  ): void {
    const gate = this.policy.check(request);
    if (gate.kind === 'rejected') {
      response
        .status(STATUS_BY_CODE[gate.code] ?? 400)
        .json({ code: gate.code });
      return;
    }
    try {
      parseTelegramUpdate(request.body);
    } catch {
      response.status(400).json({ code: 'WEBHOOK_UPDATE_MALFORMED' });
      return;
    }
    this.adapter.handle(
      request,
      response,
      (error?: unknown) => {
        if (error instanceof DigestUnavailableError) {
          response
            .status(503)
            .json({ code: 'WEBHOOK_DIGEST_KEY_UNAVAILABLE' });
          return;
        }
        next(error);
      }
    );
  }

  public async dispatchUpdate(rawUpdate: object): Promise<void> {
    const command = parseTelegramUpdate(rawUpdate);
    if (command.kind === 'ignored') return;
    const digestSet = this.digests.digest(rawUpdate);
    if (
      typeof digestSet === 'object' &&
      digestSet !== null &&
      'unavailable' in digestSet &&
      (digestSet as { readonly unavailable?: unknown }).unavailable === true
    ) {
      throw new DigestUnavailableError();
    }
    await this.startHandler.handle({ rawUpdate, digestSet, start: command });
  }
}
