import type { DynamicModule } from '@nestjs/common';
import type { WebhookRequestPolicy } from './http/webhook-request-policy.js';
import type { GrammyWebhookAdapter } from './http/grammy-webhook.adapter.js';
import type {
  TelegramDigestProvider,
  TelegramStartHandler
} from './http/telegram-webhook.controller.js';
export const TELEGRAM_POLICY = Symbol('TELEGRAM_POLICY');
export const TELEGRAM_ADAPTER = Symbol('TELEGRAM_ADAPTER');
export const TELEGRAM_DIGEST_PROVIDER = Symbol('TELEGRAM_DIGEST_PROVIDER');
export const TELEGRAM_START_HANDLER = Symbol('TELEGRAM_START_HANDLER');

export interface TelegramModuleOptions {
  readonly policy: WebhookRequestPolicy;
  readonly adapter: GrammyWebhookAdapter;
  readonly digestProvider: TelegramDigestProvider;
  readonly startHandler: TelegramStartHandler;
}

export class TelegramModule {
  public static withInstances(
    options: TelegramModuleOptions
  ): DynamicModule {
    return {
      module: TelegramModule,
      providers: [
        { provide: TELEGRAM_POLICY, useValue: options.policy },
        { provide: TELEGRAM_ADAPTER, useValue: options.adapter },
        {
          provide: TELEGRAM_DIGEST_PROVIDER,
          useValue: options.digestProvider
        },
        { provide: TELEGRAM_START_HANDLER, useValue: options.startHandler }
      ]
    };
  }
}
