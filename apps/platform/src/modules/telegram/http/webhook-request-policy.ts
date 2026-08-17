import { verifyWebhookSecret } from './webhook-secret.verifier.js';

export interface PolicyRequestShape {
  readonly headers: Record<string, unknown>;
  readonly secure: boolean;
  readonly protocol: string;
}

export interface WebhookRequestPolicyOptions {
  readonly expectedSecret: string;
  readonly trustedProxyEnabled: boolean;
}

export type WebhookPolicyRejectionCode =
  | 'WEBHOOK_HTTPS_REQUIRED'
  | 'WEBHOOK_SECRET_INVALID'
  | 'WEBHOOK_CONTENT_TYPE_INVALID';

export type WebhookPolicyResult =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'rejected'; readonly code: WebhookPolicyRejectionCode };

function isRequestSecure(
  request: PolicyRequestShape,
  trustConfigured: boolean
): boolean {
  if (request.secure || request.protocol === 'https') return true;
  if (!trustConfigured) return false;
  const forwardedProto = request.headers['x-forwarded-proto'];
  return (
    typeof forwardedProto === 'string' &&
    forwardedProto.split(',')[0]?.trim() === 'https'
  );
}

export class WebhookRequestPolicy {
  readonly #options: WebhookRequestPolicyOptions;

  constructor(options: WebhookRequestPolicyOptions) {
    this.#options = options;
  }

  public check(request: PolicyRequestShape): WebhookPolicyResult {
    if (!isRequestSecure(request, this.#options.trustedProxyEnabled)) {
      return { kind: 'rejected', code: 'WEBHOOK_HTTPS_REQUIRED' };
    }
    const secret: unknown = request.headers['x-telegram-bot-api-secret-token'];
    if (typeof secret !== 'string') {
      return { kind: 'rejected', code: 'WEBHOOK_SECRET_INVALID' };
    }
    if (!verifyWebhookSecret(secret, this.#options.expectedSecret)) {
      return { kind: 'rejected', code: 'WEBHOOK_SECRET_INVALID' };
    }
    const contentType = request.headers['content-type'];
    if (
      typeof contentType !== 'string' ||
      !contentType.toLowerCase().startsWith('application/json')
    ) {
      return { kind: 'rejected', code: 'WEBHOOK_CONTENT_TYPE_INVALID' };
    }
    return { kind: 'allowed' };
  }
}
