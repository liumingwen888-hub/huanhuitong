import { trace } from '@opentelemetry/api';
import {
  TelemetryConfigurationError,
  type OtlpExporterFactory,
  type OtlpExporterRegistration,
  type TelemetryConfig,
  type TelemetryHandle,
  type TelemetrySpanName
} from '@xht/contracts';

export async function createPlatformTelemetry(
  config: TelemetryConfig,
  exporterFactory?: OtlpExporterFactory
): Promise<TelemetryHandle> {
  const tracer = trace.getTracer('xht-platform', '0.1.0');
  let registration: OtlpExporterRegistration | undefined;
  if (config.mode === 'otlp') {
    if (exporterFactory === undefined) {
      throw new TelemetryConfigurationError('EXPORTER_FACTORY_REQUIRED');
    }
    try {
      registration = await exporterFactory.register({
        serviceName: 'xht-platform', endpoint: config.endpoint
      });
    } catch {
      throw new TelemetryConfigurationError('EXPORTER_REGISTRATION_FAILED');
    }
  }
  let closed = false;
  let shutdownPromise: Promise<void> | undefined;
  return {
    enabled: config.mode === 'otlp',
    serviceName: 'xht-platform',
    startSpan(name: TelemetrySpanName) {
      if (closed) throw new TelemetryConfigurationError('TELEMETRY_CLOSED');
      const span = tracer.startSpan(name);
      return { end: () => span.end() };
    },
    shutdown(): Promise<void> {
      if (shutdownPromise !== undefined) return shutdownPromise;
      closed = true;
      shutdownPromise = Promise.resolve().then(async () => {
        try { await registration?.shutdown(); }
        catch { throw new TelemetryConfigurationError('EXPORTER_SHUTDOWN_FAILED'); }
      });
      return shutdownPromise;
    }
  };
}
