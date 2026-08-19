import type { SafeLogContext, SafeLogEvent } from '@xht/contracts';

export type SafeLoggingErrorCode =
  | 'EVENT_NOT_ALLOWED'
  | 'CONTEXT_NOT_OBJECT'
  | 'UNKNOWN_FIELD'
  | 'REQUIRED_FIELD_MISSING'
  | 'EVENT_POLICY_MISMATCH'
  | 'NESTED_VALUE'
  | 'VALUE_TYPE_NOT_ALLOWED'
  | 'STRING_TOO_LONG'
  | 'CONTROL_CHARACTER'
  | 'VALUE_NOT_ALLOWED';

export class SafeLoggingError extends Error {
  public constructor(public readonly code: SafeLoggingErrorCode) {
    super(code);
    this.name = 'SafeLoggingError';
  }
}

export interface SafeLogEntry {
  readonly event: SafeLogEvent;
  readonly context: Readonly<Record<string, string | number>>;
}

type ContextKey = keyof SafeLogContext;
interface EventPolicy {
  readonly required: readonly ContextKey[];
  readonly optional: readonly ContextKey[];
  readonly route: NonNullable<SafeLogContext['route']>;
  readonly outcome: NonNullable<SafeLogContext['outcome']>;
}

const eventPolicies = {
  app_configuration_loaded: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'configuration', outcome: 'success'
  },
  app_configuration_rejected: {
    required: ['route', 'outcome', 'error_category'], optional: ['correlation_id'],
    route: 'configuration', outcome: 'rejected'
  },
  telemetry_disabled: {
    required: ['route', 'outcome'], optional: ['correlation_id'],
    route: 'telemetry', outcome: 'disabled'
  },
  telemetry_configured: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'telemetry', outcome: 'configured'
  },
  process_started: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'bootstrap', outcome: 'success'
  },
  process_stopped: {
    required: ['route', 'outcome'], optional: ['correlation_id', 'duration_ms'],
    route: 'bootstrap', outcome: 'stopped'
  },
  telegram_webhook_processed: {
    required: ['route', 'outcome', 'update_id'],
    optional: [
      'correlation_id', 'uid', 'telegram_user_ref', 'inbox_id', 'outbox_id',
      'duration_ms'
    ],
    route: 'telegram.start', outcome: 'processed'
  },
  telegram_webhook_rejected: {
    required: [
      'route', 'outcome', 'error_category', 'correlation_id', 'update_id'
    ],
    optional: ['inbox_id', 'retry_count'],
    route: 'telegram.start', outcome: 'rejected'
  },
  withdrawal_broadcast_unknown: {
    required: ['route', 'outcome'],
    optional: ['correlation_id'],
    route: 'withdrawals', outcome: 'unknown'
  }
} as const satisfies Record<SafeLogEvent, EventPolicy>;

const routes = new Set([
  'bootstrap', 'configuration', 'telemetry', 'telegram.start'
]);
const outcomes = new Set([
  'success', 'rejected', 'disabled', 'configured', 'stopped', 'processed'
]);
const errorCategories = new Set([
  'configuration_invalid', 'secret_reference_invalid', 'secret_resolution_failed',
  'telemetry_initialization_failed', 'telegram_update_invalid', 'invalid_log_entry'
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TELEGRAM_USER_REF_PATTERN = /^tgur-v[1-9][0-9]{0,8}:[A-Za-z0-9_-]{43}$/;
const NUMERIC_KEYS = new Set(['duration_ms', 'retry_count']);

const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/;

function validateString(key: string, value: string): void {
  if (value.length > 128) throw new SafeLoggingError('STRING_TOO_LONG');
  if (controlCharacters.test(value)) throw new SafeLoggingError('CONTROL_CHARACTER');
  if (key === 'correlation_id' && !/^corr_[A-Za-z0-9_-]{1,59}$/.test(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (key === 'route' && !routes.has(value)) throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  if (key === 'outcome' && !outcomes.has(value)) throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  if (key === 'error_category' && !errorCategories.has(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (key === 'update_id' && !/^[0-9]{1,20}$/.test(value)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (
    (key === 'uid' || key === 'inbox_id' || key === 'outbox_id') &&
    !UUID_PATTERN.test(value)
  ) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (
    key === 'telegram_user_ref' &&
    !TELEGRAM_USER_REF_PATTERN.test(value)
  ) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
}

function validateNumber(key: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
  }
  if (key === 'duration_ms' && (value < 0 || value > 600_000)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
  if (key === 'retry_count' && (value < 0 || value > 1000)) {
    throw new SafeLoggingError('VALUE_NOT_ALLOWED');
  }
}

export function validateSafeLogEntry(event: unknown, context: unknown = {}): SafeLogEntry {
  if (typeof event !== 'string' || !Object.hasOwn(eventPolicies, event)) {
    throw new SafeLoggingError('EVENT_NOT_ALLOWED');
  }
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new SafeLoggingError('CONTEXT_NOT_OBJECT');
  }
  const prototype = Object.getPrototypeOf(context);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SafeLoggingError('CONTEXT_NOT_OBJECT');
  }
  const typedEvent = event as SafeLogEvent;
  const policy = eventPolicies[typedEvent];
  const allowed = new Set<string>([...policy.required, ...policy.optional]);
  const selected: Record<string, string | number> = {};
  for (const key of Reflect.ownKeys(context)) {
    if (typeof key !== 'string' || !allowed.has(key)) throw new SafeLoggingError('UNKNOWN_FIELD');
    const descriptor = Object.getOwnPropertyDescriptor(context, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
    }
    const value = descriptor.value as unknown;
    if (NUMERIC_KEYS.has(key) && typeof value !== 'number') {
      throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
    }
    if (typeof value === 'object' && value !== null) throw new SafeLoggingError('NESTED_VALUE');
    if (typeof value === 'string') validateString(key, value);
    else if (typeof value === 'number') validateNumber(key, value);
    else throw new SafeLoggingError('VALUE_TYPE_NOT_ALLOWED');
    selected[key] = value;
  }
  for (const key of policy.required) {
    if (!Object.hasOwn(selected, key)) throw new SafeLoggingError('REQUIRED_FIELD_MISSING');
  }
  if (selected.route !== policy.route || selected.outcome !== policy.outcome) {
    throw new SafeLoggingError('EVENT_POLICY_MISMATCH');
  }
  return { event: typedEvent, context: Object.freeze(selected) };
}
