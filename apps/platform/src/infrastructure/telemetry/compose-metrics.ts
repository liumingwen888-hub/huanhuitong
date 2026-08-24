import type { MetricsPort } from '@xht/contracts';

/** Shared no-op: keeps existing service tests untouched when no
 * metrics instance is injected. */
export const NOOP_METRICS: MetricsPort = Object.freeze({
  incrementCounter(): void {
    /* observability off */
  },
  recordHistogram(): void {
    /* observability off */
  }
});

Object.freeze(NOOP_METRICS);
