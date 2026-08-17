import { trace } from '@opentelemetry/api';
import { createWorker, type WorkerRuntime } from './bootstrap/create-worker.js';

const workerTracer = trace.getTracer('xht-worker');
void workerTracer;

export const workerProcessName = 'xht-worker' as const;

export { createWorker };
export type { WorkerRuntime };
