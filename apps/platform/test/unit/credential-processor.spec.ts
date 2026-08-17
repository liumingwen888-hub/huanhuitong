import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CredentialEntryBuffer,
  CredentialProcessor
} from '../../src/modules/security/domain/credential-processor.js';

describe('credential processor (the only plaintext holder)', () => {
  it('S2U01: appends digits and reports length', () => {
    const buffer = new CredentialEntryBuffer();
    expect(buffer.appendDigit('1')).toBe(1);
    expect(buffer.appendDigit('3')).toBe(2);
    expect(buffer.appendDigit('5')).toBe(3);
  });

  it('S2U02: rejects malformed input defensively', () => {
    const buffer = new CredentialEntryBuffer();
    for (const bad of ['x', '12', '', 5, null, { toString: () => '1' }]) {
      expect(() => buffer.appendDigit(bad as unknown as string)).toThrowError(
        'CREDENTIAL_DIGIT_INVALID'
      );
    }
    let full = new CredentialEntryBuffer();
    for (let index = 0; index < 12; index += 1) full.appendDigit('7');
    expect(() => full.appendDigit('7')).toThrowError('CREDENTIAL_BUFFER_FULL');
    full = null as never;
  });

  it('S2U03: withBytes zeroes the buffer after borrowing (no residue)', async () => {
    const buffer = new CredentialEntryBuffer();
    for (const digit of '135790') buffer.appendDigit(digit);
    let seenLength = 0;
    await buffer.withBytes((bytes) => {
      seenLength = bytes.length;
      return bytes.length;
    });
    expect(seenLength).toBe(6);
    await expect(buffer.withBytes(() => 1)).rejects.toThrowError(
      'CREDENTIAL_BUFFER_EMPTY'
    );
  });

  it('S2U04: malformed input zeroes any partially entered digits', () => {
    const buffer = new CredentialEntryBuffer();
    buffer.appendDigit('1');
    buffer.appendDigit('2');
    expect(() => buffer.appendDigit('bad' as unknown as string)).toThrow();
    expect(buffer.length).toBe(0);
  });

  it('S2U05: two-entry confirmation compares in constant-time fashion', () => {
    const processor = new CredentialProcessor();
    for (const digit of '2468') processor.primary.appendDigit(digit);
    for (const digit of '2468') processor.confirmation.appendDigit(digit);
    expect(processor.entriesMatch()).toBe(true);

    const other = new CredentialProcessor();
    for (const digit of '2468') other.primary.appendDigit(digit);
    for (const digit of '2469') other.confirmation.appendDigit(digit);
    expect(other.entriesMatch()).toBe(false);

    const mismatchedLength = new CredentialProcessor();
    mismatchedLength.primary.appendDigit('1');
    mismatchedLength.confirmation.appendDigit('1');
    mismatchedLength.confirmation.appendDigit('2');
    expect(mismatchedLength.entriesMatch()).toBe(false);
  });

  it('S2U06: processor sources never leak plaintext through logs or serialization', async () => {
    const projectRoot = resolve(import.meta.dirname, '../..');
    for (const file of [
      'src/modules/security/domain/credential-processor.ts',
      'src/modules/security/domain/credential-hash.ts',
      'src/modules/security/application/verify-payment-credential.ts'
    ]) {
      const source = await readFile(resolve(projectRoot, file), 'utf8');
      expect(
        source.match(
          /console\.|JSON\.stringify|logger\.|pino|throw new Error\((?!['"]CREDENTIAL)/u
        ) ?? []
      ).toEqual([]);
    }
  });
});
