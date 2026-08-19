import { createHash } from 'node:crypto';
import type { ChainNetwork } from '@xht/contracts';

export interface CanonicalSigningFields {
  readonly withdrawalId: string;
  readonly orderRef: string;
  readonly network: ChainNetwork;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly amount: string;
  readonly feeAmount: string;
}

/**
 * Deterministic digest over the signing-bound fields. Serialization is a
 * fixed-key JSON object, so the digest never depends on caller property
 * order and any bound-field change produces a different digest.
 */
export function canonicalDigest(fields: CanonicalSigningFields): string {
  const canonical = JSON.stringify({
    v: 1,
    withdrawalId: fields.withdrawalId,
    orderRef: fields.orderRef,
    network: fields.network,
    fromAddress: fields.fromAddress,
    toAddress: fields.toAddress,
    amount: fields.amount,
    feeAmount: fields.feeAmount
  });
  return `sha256:${createHash('sha256').update(canonical).digest('base64url')}`;
}

export function canonicalFieldsMatch(
  fields: CanonicalSigningFields,
  digest: string
): boolean {
  return canonicalDigest(fields) === digest;
}
