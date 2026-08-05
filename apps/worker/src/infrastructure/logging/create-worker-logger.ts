import pino, { type DestinationStream } from 'pino';
import type { SafeLogContext, SafeLogEvent, SafeLogger } from '@xht/contracts';
import { validateSafeLogEntry } from '@xht/config';

export function createWorkerLogger(destination: DestinationStream): SafeLogger {
  const backend = pino({ base: { service: 'xht-worker' }, timestamp: false }, destination);
  const write = (level: 'info' | 'warn' | 'error', event: SafeLogEvent, context?: SafeLogContext): void => {
    const safe = validateSafeLogEntry(event, context ?? {});
    backend[level]({ event: safe.event, ...safe.context });
  };
  return {
    info: (event, context) => write('info', event, context),
    warn: (event, context) => write('warn', event, context),
    error: (event, context) => write('error', event, context)
  };
}
