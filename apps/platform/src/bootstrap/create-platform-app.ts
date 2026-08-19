import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { RequestHandler } from 'express';
import type { UserFromGetMe } from 'grammy/types';
import { WebhookRequestPolicy } from '../modules/telegram/http/webhook-request-policy.js';
import { GrammyWebhookAdapter } from '../modules/telegram/http/grammy-webhook.adapter.js';
import {
  DigestUnavailableError,
  TelegramWebhookController,
  type TelegramSecurityHandler,
  type ControllerRequestShape,
  type ControllerResponseShape,
  type TelegramDigestProvider,
  type TelegramStartHandler
} from '../modules/telegram/http/telegram-webhook.controller.js';
import { TelegramModule } from '../modules/telegram/telegram.module.js';

export interface CreatePlatformAppOptions {
  readonly webhookSecret: string;
  readonly trustedProxyEnabled: boolean;
  readonly injectedBotInfo: UserFromGetMe;
  readonly digestProvider: TelegramDigestProvider;
  readonly startHandler: TelegramStartHandler;
  readonly securityHandler?: TelegramSecurityHandler | undefined;
  readonly onForbiddenNetworkCall?: ((detail: string) => void) | undefined;
}

export interface PlatformAppHandle {
  readonly app: NestExpressApplication;
  readonly close: () => Promise<void>;
}

export async function createPlatformApp(
  options: CreatePlatformAppOptions
): Promise<PlatformAppHandle> {
  const policy = new WebhookRequestPolicy({
    expectedSecret: options.webhookSecret,
    trustedProxyEnabled: options.trustedProxyEnabled
  });
  const grammyAdapter = new GrammyWebhookAdapter({
    fakeToken: '0000000000:00000000000000000000000000000000000',
    injectedBotInfo: options.injectedBotInfo,
    onForbiddenNetworkCall: options.onForbiddenNetworkCall
  });
  const app = await NestFactory.create<NestExpressApplication>(
    TelegramModule.withInstances({
      policy,
      adapter: grammyAdapter,
      digestProvider: options.digestProvider,
      startHandler: options.startHandler
    }),
    { logger: false, bodyParser: false }
  );
  app.useBodyParser('json', { limit: '256kb' });
  app.set('trust proxy', options.trustedProxyEnabled ? 1 : false);
  const controller = new TelegramWebhookController(
    policy,
    grammyAdapter,
    options.digestProvider,
    options.startHandler,
    options.securityHandler
  );
  grammyAdapter.setDispatch((update: object) =>
    controller.dispatchUpdate(update)
  );
  const webhookRoute: RequestHandler = (request, response, next) => {
    grammyAdapter.setErrorSink((error: unknown): boolean => {
      if (error instanceof DigestUnavailableError) {
        response
          .status(503)
          .json({ code: 'WEBHOOK_DIGEST_KEY_UNAVAILABLE' });
        return true;
      }
      next(error);
      return false;
    });
    controller.receive(
      request as unknown as ControllerRequestShape,
      response as unknown as ControllerResponseShape,
      next
    );
  };
  app.getHttpAdapter().post('/webhooks/telegram', webhookRoute as never);
  await app.init();
  return {
    app,
    close: async () => {
      await app.close();
    }
  };
}
