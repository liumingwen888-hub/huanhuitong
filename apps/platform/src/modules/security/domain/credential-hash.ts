import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions
} from 'node:crypto';

function scrypt(
  password: Uint8Array,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error !== null) reject(error);
      else resolve(derived);
    });
  });
}

export const SCRYPT_PARAM_VERSION = 1 as const;
export const SCRYPT_N = 32768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
const SALT_BYTES = 32;
const KEY_BYTES = 64;

export const CREDENTIAL_HASH_FORMAT =
  /^scrypt\$ln=32768,r=8,p=1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/u;

export interface HashedCredential {
  readonly hashV1: string;
  readonly paramVersion: number;
}

async function derive(
  digitBytes: Uint8Array,
  salt: Buffer,
  n: number,
  r: number,
  p: number
): Promise<Buffer> {
  return scrypt(digitBytes, salt, KEY_BYTES, { N: n, r, p, maxmem: 512 * 1024 * 1024 });
}

export async function hashCredentialDigits(
  digitBytes: Uint8Array
): Promise<HashedCredential> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(digitBytes, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return Object.freeze({
    hashV1: `scrypt$ln=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`,
    paramVersion: SCRYPT_PARAM_VERSION
  });
}

export class CredentialHashFormatError extends Error {
  public readonly code = 'CREDENTIAL_HASH_FORMAT_INVALID' as const;
  constructor() {
    super('CREDENTIAL_HASH_FORMAT_INVALID');
    this.name = 'CredentialHashFormatError';
  }
}

export async function verifyCredentialDigits(
  digitBytes: Uint8Array,
  storedHashV1: string
): Promise<boolean> {
  if (typeof storedHashV1 !== 'string' || !CREDENTIAL_HASH_FORMAT.test(storedHashV1)) {
    throw new CredentialHashFormatError();
  }
  const [algorithm, params, saltB64, keyB64] = storedHashV1.split('$');
  if (algorithm !== 'scrypt' || params === undefined || saltB64 === undefined || keyB64 === undefined) {
    throw new CredentialHashFormatError();
  }
  const parsed = new Map<string, number>();
  for (const part of params.split(',')) {
    const [key, value] = part.split('=');
    if (key === undefined || value === undefined || !/^\d+$/u.test(value)) {
      throw new CredentialHashFormatError();
    }
    parsed.set(key, Number(value));
  }
  const n = parsed.get('ln');
  const r = parsed.get('r');
  const p = parsed.get('p');
  if (n === undefined || r === undefined || p === undefined) {
    throw new CredentialHashFormatError();
  }
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await derive(digitBytes, salt, n, r, p);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
