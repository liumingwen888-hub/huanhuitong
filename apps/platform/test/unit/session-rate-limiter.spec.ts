import { describe, expect, it } from 'vitest';
import { SessionRateLimiter } from '../../src/modules/security/application/session-rate-limiter.js';

describe('session rate limiter (token bucket)', () => {
  it('S4U01: allows up to the window limit then blocks until reset', () => {
    let clock = 1_000_000;
    const limiter = new SessionRateLimiter({
      maxPerWindow: 3,
      windowMillis: 60_000,
      now: () => clock
    });
    expect(limiter.allow('uid-1')).toBe(true);
    expect(limiter.allow('uid-1')).toBe(true);
    expect(limiter.allow('uid-1')).toBe(true);
    expect(limiter.allow('uid-1')).toBe(false);
    clock += 60_001;
    expect(limiter.allow('uid-1')).toBe(true);
  });

  it('S4U02: buckets are isolated per uid', () => {
    const limiter = new SessionRateLimiter({
      maxPerWindow: 1,
      windowMillis: 60_000,
      now: () => 5_000_000
    });
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    expect(limiter.allow('b')).toBe(true);
  });
});
