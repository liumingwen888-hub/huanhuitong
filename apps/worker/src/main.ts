import { trace } from '@opentelemetry/api';

const workerTracer = trace.getTracer('xht-worker');
void workerTracer;

export const workerProcessName = 'xht-worker' as const;
