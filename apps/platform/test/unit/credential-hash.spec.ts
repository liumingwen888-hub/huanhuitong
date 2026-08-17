import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_HASH_FORMAT,
  CredentialHashFormatError,
  hashCredentialDigits,
  verifyCredentialDigits
} from '../../src/modules/security/domain/credential-hash.js';

function digitBuffer(digits: string): Uint8Array {
  const bytes = new Uint8Array(digits.length);
  for (let index = 0; index < digits.length; index += 1) {
    bytes[index] = digits.charCodeAt(index);
  }
  return bytes;
}

describe('credential hashing (scrypt v1)', () => {
  it('S2U11: hashes carry the frozen four-segment scrypt format', async () => {
    const hashed = await hashCredentialDigits(digitBuffer('135790'));
    expect(hashed.paramVersion).toBe(1);
    expect(hashed.hashV1).toMatch(CREDENTIAL_HASH_FORMAT);
    expect(hashed.hashV1.startsWith('scrypt$ln=32768,r=8,p=1$')).toBe(true);
  });

  it('S2U12: salts are unique — two hashes of the same digits differ', async () => {
    const first = await hashCredentialDigits(digitBuffer('135790'));
    const second = await hashCredentialDigits(digitBuffer('135790'));
    expect(first.hashV1).not.toBe(second.hashV1);
  });

  it('S2U13: verification accepts the right digits and rejects the wrong ones', async () => {
    const hashed = await hashCredentialDigits(digitBuffer('135790'));
    expect(
      await verifyCredentialDigits(digitBuffer('135790'), hashed.hashV1)
    ).toBe(true);
    expect(
      await verifyCredentialDigits(digitBuffer('135791'), hashed.hashV1)
    ).toBe(false);
    expect(
      await verifyCredentialDigits(digitBuffer('1357'), hashed.hashV1)
    ).toBe(false);
  });

  it('S2U14: malformed stored hashes fail closed with a stable error', async () => {
    for (const bad of [
      'plaintext',
      'scrypt$ln=32768$r=8',
      'bcrypt$ln=32768,r=8,p=1$abc$def',
      ''
    ]) {
      await expect(
        verifyCredentialDigits(digitBuffer('1'), bad)
      ).rejects.toBeInstanceOf(CredentialHashFormatError);
    }
  });
});
