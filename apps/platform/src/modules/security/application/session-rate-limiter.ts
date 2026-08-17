export interface SessionRateLimiterOptions {
  readonly maxPerWindow: number;
  readonly windowMillis: number;
  readonly now?: () => number;
}

interface Bucket {
  tokens: number;
  resetAt: number;
}

/**
 * Per-uid token bucket for credential session creation. Process-local;
 * database constraints (single OPEN session, nonce uniqueness) provide the
 * durable backstop across processes.
 */
export class SessionRateLimiter {
  readonly #maxPerWindow: number;
  readonly #windowMillis: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(options: SessionRateLimiterOptions) {
    this.#maxPerWindow = options.maxPerWindow;
    this.#windowMillis = options.windowMillis;
    this.#now = options.now ?? (() => Date.now());
  }

  public allow(uid: string): boolean {
    const now = this.#now();
    const existing = this.#buckets.get(uid);
    if (existing === undefined || existing.resetAt <= now) {
      this.#buckets.set(uid, {
        tokens: this.#maxPerWindow - 1,
        resetAt: now + this.#windowMillis
      });
      return true;
    }
    if (existing.tokens <= 0) return false;
    existing.tokens -= 1;
    return true;
  }
}

Object.freeze(SessionRateLimiter.prototype);
