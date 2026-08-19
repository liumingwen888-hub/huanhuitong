export type ApplicationServiceName = 'xht-platform' | 'xht-worker';

export type SafeLogEvent =
  | 'app_configuration_loaded'
  | 'app_configuration_rejected'
  | 'telemetry_disabled'
  | 'telemetry_configured'
  | 'process_started'
  | 'process_stopped'
  | 'telegram_webhook_processed'
  | 'telegram_webhook_rejected'
  | 'withdrawal_broadcast_unknown';

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
    | 'withdrawals';
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
