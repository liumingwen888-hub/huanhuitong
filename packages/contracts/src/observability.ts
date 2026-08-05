export type ApplicationServiceName = 'xht-platform' | 'xht-worker';

export type SafeLogEvent =
  | 'app_configuration_loaded'
  | 'app_configuration_rejected'
  | 'telemetry_disabled'
  | 'telemetry_configured'
  | 'process_started'
  | 'process_stopped';

export type SafeLogErrorCategory =
  | 'configuration_invalid'
  | 'secret_reference_invalid'
  | 'secret_resolution_failed'
  | 'telemetry_initialization_failed'
  | 'invalid_log_entry';

export interface SafeLogContext {
  readonly correlation_id?: string;
  readonly route?: 'bootstrap' | 'configuration' | 'telemetry';
  readonly outcome?: 'success' | 'rejected' | 'disabled' | 'configured' | 'stopped';
  readonly error_category?: SafeLogErrorCategory;
  readonly duration_ms?: number;
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
