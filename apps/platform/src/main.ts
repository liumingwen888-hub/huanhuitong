import 'reflect-metadata';
import { trace } from '@opentelemetry/api';

const platformTracer = trace.getTracer('xht-platform');
void platformTracer;

export const platformProcessName = 'xht-platform' as const;
