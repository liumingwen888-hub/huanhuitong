import 'reflect-metadata';
import { trace } from '@opentelemetry/api';
import { createPlatformApp } from './bootstrap/create-platform-app.js';
export type { PlatformAppHandle } from './bootstrap/create-platform-app.js';

const platformTracer = trace.getTracer('xht-platform');
void platformTracer;

export const platformProcessName = 'xht-platform' as const;

export { createPlatformApp };
