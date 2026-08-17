import { SCRYPT_PARAM_VERSION } from '../domain/credential-hash.js';
import type { HashedCredential } from '../domain/credential-hash.js';

export function needsRehash(storedParamVersion: number): boolean {
  return storedParamVersion < SCRYPT_PARAM_VERSION;
}

export function isCurrentParamVersion(hashed: HashedCredential): boolean {
  return hashed.paramVersion === SCRYPT_PARAM_VERSION;
}

Object.freeze({ needsRehash, isCurrentParamVersion });
