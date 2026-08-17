import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const SHA1_BLOCK = 20;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(text: string): Uint8Array {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('TOTP_BASE32_INVALID');
  }
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of text) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('TOTP_BASE32_INVALID');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

export function generateTotpSecret(): Uint8Array {
  return new Uint8Array(randomBytes(20));
}

function hotp(secret: Uint8Array, counter: number): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBytes.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', secret).update(counterBytes).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totpCode(
  secret: Uint8Array,
  atTimeMilliseconds: number
): string {
  const counter = Math.floor(atTimeMilliseconds / 1000 / STEP_SECONDS);
  return hotp(secret, counter);
}

export function verifyTotp(
  secret: Uint8Array,
  code: unknown,
  atTimeMilliseconds: number,
  window = 1
): boolean {
  if (
    typeof code !== 'string' ||
    !/^[0-9]{6}$/u.test(code) ||
    secret.byteLength < SHA1_BLOCK - 8
  ) {
    return false;
  }
  const counter = Math.floor(atTimeMilliseconds / 1000 / STEP_SECONDS);
  const provided = Buffer.from(code, 'utf8');
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = Buffer.from(hotp(secret, counter + drift), 'utf8');
    if (timingSafeEqual(provided, expected)) return true;
  }
  return false;
}

Object.freeze({ base32Encode, base32Decode, generateTotpSecret, totpCode, verifyTotp });
