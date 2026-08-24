export type ApplicationServiceName = 'xht-platform' | 'xht-worker';

export type MetricName =
  | 'ledger_posting_total'
  | 'ledger_posting_rejected_total'
  | 'withdrawal_requested_total'
  | 'withdrawal_settled_total'
  | 'exchange_settled_total'
  | 'payout_submitted_total'
  | 'payout_succeeded_total'
  | 'outbox_enqueued_total'
  | 'outbox_delivered_total'
  | 'inbox_duplicate_total'
  | 'admin_auth_failed_total'
  | 'admin_api_denied_total';

export type HistogramName =
  | 'ledger_posting_duration_ms'
  | 'api_request_duration_ms';

export interface MetricAttributes {
  readonly domain?: string;
  readonly outcome?: string;
  readonly route?: 'http' | 'telegram';
}

export interface MetricsPort {
  incrementCounter(
    name: MetricName,
    attributes?: MetricAttributes
  ): void;
  recordHistogram(
    name: HistogramName,
    valueMs: number,
    attributes?: MetricAttributes
  ): void;
}

export type SafeLogEvent =
  | 'app_configuration_loaded'
  | 'app_configuration_rejected'
  | 'telemetry_disabled'
  | 'telemetry_configured'
  | 'process_started'
  | 'process_stopped'
  | 'telegram_webhook_processed'
  | 'telegram_webhook_rejected'
  | 'withdrawal_broadcast_unknown'
  | 'ledger_posting_rejected'
  | 'payout_provider_unavailable'
  | 'backup_completed'
  | 'backup_failed'
  | 'restore_validated'
  | 'release_gate_passed'
  | 'release_gate_blocked';

export type SafeLogErrorCategory =
  | 'configuration_invalid'
  | 'secret_reference_invalid'
  | 'secret_resolution_failed'
  | 'telemetry_initialization_failed'
  | 'telegram_update_invalid'
  | 'invalid_log_entry';

export interface SafeLogContext {
  readonly correlation_id?: string;
  readonly update_id?: string;
  readonly uid?: string;
  readonly telegram_user_ref?: string;
  readonly inbox_id?: string;
  readonly outbox_id?: string;
  readonly route?:
    | 'bootstrap'
    | 'configuration'
    | 'telemetry'
    | 'telegram.start'
    | 'withdrawals'
    | 'ledger'
    | 'payouts'
    | 'operations';
  readonly outcome?:
    | 'success'
    | 'rejected'
    | 'disabled'
    | 'configured'
    | 'stopped'
    | 'processed'
    | 'unknown';
  readonly error_category?: SafeLogErrorCategory;
  readonly duration_ms?: number;
  readonly retry_count?: number;
}

export interface SafeLogger {
  info(event: SafeLogEvent, context?: SafeLogContext): void;
  warn(event: SafeLogEvent, context?: SafeLogContext): void;
  error(event: SafeLogEvent, context?: SafeLogContext): void;
}

export type TelemetryConfig =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'otlp'; readonly endpoint: string };

export type TelemetrySpanName =
  | 'process.bootstrap'
  | 'configuration.parse'
  | 'telemetry.initialize';

export interface TelemetrySpanHandle {
  end(): void;
}

export interface TelemetryHandle {
  readonly enabled: boolean;
  readonly serviceName: ApplicationServiceName;
  startSpan(name: TelemetrySpanName): TelemetrySpanHandle;
  shutdown(): Promise<void>;
}

export interface OtlpExporterRegistration {
  shutdown(): Promise<void>;
}

export interface OtlpExporterFactory {
  register(input: {
    readonly serviceName: ApplicationServiceName;
    readonly endpoint: string;
  }): Promise<OtlpExporterRegistration>;
}

export type TelemetryConfigurationErrorCode =
  | 'EXPORTER_FACTORY_REQUIRED'
  | 'EXPORTER_REGISTRATION_FAILED'
  | 'EXPORTER_SHUTDOWN_FAILED'
  | 'TELEMETRY_CLOSED';

export class TelemetryConfigurationError extends Error {
  public constructor(public readonly code: TelemetryConfigurationErrorCode) {
    super(code);
    this.name = 'TelemetryConfigurationError';
  }
}
