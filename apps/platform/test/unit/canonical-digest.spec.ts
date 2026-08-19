import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  type CanonicalSigningFields
} from '../../src/modules/signer/domain/canonical-digest.js';
import type {
  WithdrawalSigningRequest,
  WithdrawalSigningResult
} from '../../src/modules/signer/domain/transaction-signer.port.js';
import type { VaultSignInput, VaultSignature } from '../../src/modules/signer/domain/vault.port.js';

const base: CanonicalSigningFields = {
  withdrawalId: '9b01b7a2-1111-4222-8333-444455556666',
  orderRef: 'WD-TEST-001',
  network: 'TRON',
  fromAddress: 'THotWalletTest',
  toAddress: 'TDestinationTestAddress',
  amount: '500000',
  feeAmount: '1000'
};

describe('S6-4 canonical digest and signer surface', () => {
  it('S6WS05: any bound-field change changes the digest; key order does not', () => {
    const original = canonicalDigest(base);
    expect(canonicalDigest(base)).toBe(original);
    const mutations: Partial<CanonicalSigningFields>[] = [
      { withdrawalId: '9b01b7a2-1111-4222-8333-444455556667' },
      { orderRef: 'WD-TEST-002' },
      { network: 'ETHEREUM' as never },
      { fromAddress: 'TOtherHotWallet' },
      { toAddress: 'TOtherDestination' },
      { amount: '500001' },
      { feeAmount: '1001' }
    ];
    for (const mutation of mutations) {
      expect(canonicalDigest({ ...base, ...mutation })).not.toBe(original);
    }
    const reordered = canonicalDigest({
      feeAmount: base.feeAmount,
      amount: base.amount,
      toAddress: base.toAddress,
      fromAddress: base.fromAddress,
      network: base.network,
      orderRef: base.orderRef,
      withdrawalId: base.withdrawalId
    });
    expect(reordered).toBe(original);
  });

  it('S6WS06: serialized signer traffic carries no key material fields', () => {
    const request: WithdrawalSigningRequest = {
      ...base,
      canonicalDigest: canonicalDigest(base)
    };
    const result: WithdrawalSigningResult = {
      signatureRef: 'fake-sig:sha256:abc',
      algorithm: 'FAKE-ED25519'
    };
    const vaultInput: VaultSignInput = { keyRef: 'hot-wallet-v1', digest: request.canonicalDigest };
    const vaultSignature: VaultSignature = { signature: 'sig', algorithm: 'ED25519' };
    const serialized = JSON.stringify({
      request, result, vaultInput, vaultSignature
    });
    expect(
      serialized.match(/"(privatekey|private_key|private-key|secret|mnemonic|seed|keymaterial|wif)"/iu)
    ).toBeNull();
  });
});
