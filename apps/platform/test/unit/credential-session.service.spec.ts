import { describe, expect, it } from 'vitest';
import {
  CredentialSessionRegistry,
  CredentialSessionRegistryError
} from '../../src/modules/security/application/credential-session.registry.js';

describe('credential session registry', () => {
  it('S3U01: close zeroes both buffers and removes the entry', () => {
    const registry = new CredentialSessionRegistry();
    registry.open('s1', 'credential-setup');
    const entry = registry.get('s1');
    expect(entry).toBeDefined();
    entry!.primary.appendDigit('1');
    entry!.primary.appendDigit('2');
    entry!.confirmation.appendDigit('1');
    registry.close('s1');
    expect(registry.get('s1')).toBeUndefined();
    expect(entry!.primary.length).toBe(0);
    expect(entry!.confirmation.length).toBe(0);
    expect(registry.size).toBe(0);
  });

  it('S3U02: an unknown session never accepts digits (restart semantics)', () => {
    const registry = new CredentialSessionRegistry();
    expect(() => registry.require('missing')).toThrowError(
      CredentialSessionRegistryError
    );
    expect(() => registry.consumeNonce('missing', 'n1')).toThrowError(
      'SESSION_NOT_IN_MEMORY'
    );
  });

  it('S3U03: each nonce is consumed exactly once', () => {
    const registry = new CredentialSessionRegistry();
    registry.open('s1', 'credential-setup');
    expect(() => registry.consumeNonce('s1', 'n1')).not.toThrow();
    expect(() => registry.consumeNonce('s1', 'n1')).toThrowError(
      'SESSION_NONCE_REUSED'
    );
    expect(() => registry.consumeNonce('s1', 'n2')).not.toThrow();
  });

  it('S3U04: concurrent same-nonce attempts allow exactly one winner', () => {
    const registry = new CredentialSessionRegistry();
    registry.open('s1', 'credential-setup');
    // consumeNonce is synchronous, so serialize deterministically:
    const outcomes: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      try {
        registry.consumeNonce('s1', 'same-nonce-b');
        outcomes.push('won');
      } catch {
        outcomes.push('rejected');
      }
    }
    expect(outcomes.filter((o) => o === 'won')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'rejected')).toHaveLength(7);
  });
});
