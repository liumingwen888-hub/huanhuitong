import { z } from 'zod';
import type { TelemetryConfig } from '@xht/contracts';
import { secretReferenceSchema, type SecretReference } from './secret-reference.js';

export type AppEnvironmentErrorCode = 'configuration_invalid';

export class AppEnvironmentError extends Error {
  public constructor(public readonly code: AppEnvironmentErrorCode) {
    super(code);
    this.name = 'AppEnvironmentError';
  }
}

const integerString = (minimum: number, maximum: number) => z.string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .transform(value => Number(value))
  .pipe(z.number().int().min(minimum).max(maximum));

const projectedSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL_REF: secretReferenceSchema,
  TELEGRAM_WEBHOOK_SECRET_REF: secretReferenceSchema,
  INBOX_DIGEST_KEYRING_REF: secretReferenceSchema,
  INBOX_RETENTION_SECONDS: integerString(86_400, 7_776_000),
  TELEGRAM_RETRY_WINDOW_SECONDS: integerString(1, 604_800),
  OTEL_EXPORTER: z.enum(['disabled', 'otlp']),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional()
}).strict().superRefine((value, context) => {
  if (value.OTEL_EXPORTER === 'disabled' && value.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined) {
    context.addIssue({ code: 'custom', path: ['OTEL_EXPORTER_OTLP_ENDPOINT'], message: 'endpoint forbidden' });
  }
  if (value.OTEL_EXPORTER === 'otlp') {
    if (value.OTEL_EXPORTER_OTLP_ENDPOINT === undefined) {
      context.addIssue({ code: 'custom', path: ['OTEL_EXPORTER_OTLP_ENDPOINT'], message: 'endpoint required' });
      return;
    }
    const endpoint = new URL(value.OTEL_EXPORTER_OTLP_ENDPOINT);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.username !== '' || endpoint.password !== '' || endpoint.search !== '' || endpoint.hash !== '' ||
      (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback))) {
      context.addIssue({ code: 'custom', path: ['OTEL_EXPORTER_OTLP_ENDPOINT'], message: 'unsafe endpoint' });
    }
  }
});

const knownEnvironmentKeys = [
  'NODE_ENV',
  'DATABASE_URL_REF',
  'TELEGRAM_WEBHOOK_SECRET_REF',
  'INBOX_DIGEST_KEYRING_REF',
  'INBOX_RETENTION_SECONDS',
  'TELEGRAM_RETRY_WINDOW_SECONDS',
  'OTEL_EXPORTER',
  'OTEL_EXPORTER_OTLP_ENDPOINT'
] as const;

export interface AppEnvironment {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly databaseUrlRef: SecretReference;
  readonly telegramWebhookSecretRef: SecretReference;
  readonly inboxDigestKeyringRef: SecretReference;
  readonly inboxRetentionSeconds: number;
  readonly telegramRetryWindowSeconds: number;
  readonly otel: TelemetryConfig;
}

export function parseEnvironment(input: NodeJS.ProcessEnv): AppEnvironment {
  const selected = Object.fromEntries(knownEnvironmentKeys
    .filter(key => input[key] !== undefined)
    .map(key => [key, input[key]]));
  const result = projectedSchema.safeParse(selected);
  if (!result.success) throw new AppEnvironmentError('configuration_invalid');
  const value = result.data;
  return {
    nodeEnv: value.NODE_ENV,
    databaseUrlRef: value.DATABASE_URL_REF,
    telegramWebhookSecretRef: value.TELEGRAM_WEBHOOK_SECRET_REF,
    inboxDigestKeyringRef: value.INBOX_DIGEST_KEYRING_REF,
    inboxRetentionSeconds: value.INBOX_RETENTION_SECONDS,
    telegramRetryWindowSeconds: value.TELEGRAM_RETRY_WINDOW_SECONDS,
    otel: value.OTEL_EXPORTER === 'disabled'
      ? { mode: 'disabled' }
      : { mode: 'otlp', endpoint: value.OTEL_EXPORTER_OTLP_ENDPOINT as string }
  };
}
