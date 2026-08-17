import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  totpCode,
  verifyTotp
} from '../../src/modules/security/domain/totp.js';

const RFC_SECRET = new Uint8Array(
  '12345678901234567890'.split('').map((c) => c.charCodeAt(0))
);

describe('TOTP (RFC 6238, zero-dependency)', () => {
  it('S5U01: RFC 4226 vectors hold at their TOTP timestamps', () => {
    // T=59s -> counter 1 -> 287082 (RFC 4226 test vector, 6 digits)
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    // T=1111111109 -> 081804 per RFC 6238 appendix B (SHA1, 8 digits);
    // for 6 digits the leading two chars are dropped.
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
  });

  it('S5U02: the ±1 step window is accepted, ±2 is rejected', () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now - 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now + 90_000)).toBe(false);
  });

  it('S5U03: malformed codes fail closed', () => {
    const now = 1_700_000_000_000;
    for (const bad of ['12345', '1234567', 'abcdef', '', 123456, null]) {
      expect(verifyTotp(RFC_SECRET, bad, now)).toBe(false);
    }
  });

  it('S5U04: base32 roundtrips arbitrary bytes', () => {
    for (const length of [1, 5, 10, 20, 32]) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        bytes[index] = (index * 37 + 11) % 256;
      }
      const encoded = base32Encode(bytes);
      expect(base32Decode(encoded)).toEqual(bytes);
    }
    expect(() => base32Decode('1llegal!')).toThrowError('TOTP_BASE32_INVALID');
  });
});
