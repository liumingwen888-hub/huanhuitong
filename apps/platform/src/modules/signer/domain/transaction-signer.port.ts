import type { CanonicalSigningFields } from './canonical-digest.js';

export interface WithdrawalSigningRequest extends CanonicalSigningFields {
  readonly canonicalDigest: string;
}

export interface WithdrawalSigningResult {
  readonly signatureRef: string;
  readonly algorithm: string;
}

/**
 * The only signing surface the withdrawals domain may depend on. Real
 * implementations combine the active signer policy with a vault-backed
 * key; nothing in this contract exposes key material.
 */
export interface TransactionSignerPort {
  sign(request: WithdrawalSigningRequest): Promise<WithdrawalSigningResult>;
}
