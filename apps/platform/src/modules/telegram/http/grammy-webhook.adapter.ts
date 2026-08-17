import { Bot, webhookCallback } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

export interface GrammyWebhookAdapterOptions {
  readonly fakeToken: string;
  readonly injectedBotInfo: UserFromGetMe;
  readonly onForbiddenNetworkCall?: ((detail: string) => void) | undefined;
}

export type UpdateDispatch = (update: object) => Promise<void>;
export type UpdateErrorSink = (error: unknown) => boolean | void;

type Middleware = (
  request: unknown,
  response: unknown,
  next: (error?: unknown) => void
) => void;

const HANDLED_UPDATE_FILTERS = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'callback_query',
  'my_chat_member',
  'chat_member',
  'business_message'
] as const;

export class GrammyWebhookAdapter {
  readonly #handler: Middleware;
  #dispatch: UpdateDispatch | undefined;
  #errorSink: UpdateErrorSink | undefined;
  #networkCalls = 0;

  constructor(options: GrammyWebhookAdapterOptions) {
    const bot = new Bot(options.fakeToken, {
      botInfo: options.injectedBotInfo
    });
    bot.api.config.use((previous, method) => {
      this.#networkCalls += 1;
      options.onForbiddenNetworkCall?.(
        `GRAMMY_API_CALL_${String(method)}`
      );
      void previous;
      return Promise.reject(new Error('GRAMMY_NETWORK_FORBIDDEN'));
    });
    for (const filter of HANDLED_UPDATE_FILTERS) {
      bot.on(filter, (context) => {
        const dispatch = this.#dispatch;
        if (dispatch === undefined) return Promise.resolve();
        return dispatch(context.update as object).catch((error: unknown) => {
          if (this.#errorSink?.(error) === true) {
            // The sink already wrote the HTTP response; rethrow so the
            // grammY callback does not attempt a second (200) response.
            throw error;
          }
        });
      });
    }
    this.#handler = webhookCallback(bot, 'express') as unknown as Middleware;
  }

  public setDispatch(dispatch: UpdateDispatch): void {
    this.#dispatch = dispatch;
  }

  public setErrorSink(sink: UpdateErrorSink): void {
    this.#errorSink = sink;
  }

  public networkCallCount(): number {
    return this.#networkCalls;
  }

  public handle(
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void
  ): void {
    this.#handler(request, response, next);
  }
}
