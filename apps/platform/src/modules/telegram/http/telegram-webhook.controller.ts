import type {
  HandleTelegramStartResult,
  ParsedTelegramStartUpdate
} from '@xht/contracts';
import type {
  PolicyRequestShape,
  WebhookRequestPolicy
} from './webhook-request-policy.js';
import { parseTelegramUpdate } from './telegram-update.schema.js';
import { classifySecurityUpdate } from '../application/security-commands.js';
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

export interface TelegramSecurityHandler {
  handle(input: {
    readonly rawUpdate: object;
    readonly digestSet: object;
    readonly command:
      | { readonly kind: 'begin-setup' }
      | { readonly kind: 'cancel' }
      | { readonly kind: 'done' }
      | { readonly kind: 'digits'; readonly value: string }
      | { readonly kind: 'begin-authorize'; readonly orderRef: string };
    readonly externalUserId: string;
    readonly updateId: string;
  }): Promise<void>;
}

export class DigestUnavailableError extends Error {
  public readonly code = 'WEBHOOK_DIGEST_KEY_UNAVAILABLE' as const;
  constructor() {
    super('WEBHOOK_DIGEST_KEY_UNAVAILABLE');
    this.name = 'DigestUnavailableError';
  }
}

function extractUpdateId(rawUpdate: object): string {
  const candidate = (rawUpdate as { readonly update_id?: unknown }).update_id;
  return typeof candidate === 'number' || typeof candidate === 'string'
    ? String(candidate)
    : '';
}


export function toWebhookOutcome(
  result: HandleTelegramStartResult
): { readonly status: number; readonly body: unknown } {
  if (result.kind === 'digest_key_unavailable') {
    return { status: 503, body: { code: 'WEBHOOK_DIGEST_KEY_UNAVAILABLE' } };
  }
  if (result.kind === 'processed') {
    return { status: 200, body: { code: 'OK' } };
  }
  return { status: 200, body: { code: 'OK_IDEMPOTENT' } };
}

export class TelegramWebhookController {
  constructor(
    private readonly policy: WebhookRequestPolicy,
    private readonly adapter: GrammyWebhookAdapter,
    private readonly digests: TelegramDigestProvider,
    private readonly startHandler: TelegramStartHandler,
    private readonly securityHandler?: TelegramSecurityHandler
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
    if (command.kind === 'ignored') {
      if (this.securityHandler !== undefined) {
        const security = classifySecurityUpdate(rawUpdate);
        if (security !== null) {
          const digestSet = this.digests.digest(rawUpdate);
          if (
            typeof digestSet === 'object' &&
            digestSet !== null &&
            'unavailable' in digestSet &&
            (digestSet as { readonly unavailable?: unknown }).unavailable === true
          ) {
            throw new DigestUnavailableError();
          }
          await this.securityHandler.handle({
            rawUpdate,
            digestSet,
            command: security.command,
            externalUserId: security.externalUserId,
            updateId: extractUpdateId(rawUpdate)
          });
        }
      }
      return;
    }
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
