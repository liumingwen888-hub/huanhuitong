import type {
  TransactionSignerPort,
  WithdrawalSigningRequest,
  WithdrawalSigningResult
} from './transaction-signer.port.js';
import { canonicalFieldsMatch } from './canonical-digest.js';
import { SignerError } from './signer.errors.js';

/**
 * Deterministic fake signer for tests: the same request always yields
 * the same signature reference, every request is recorded, and failures
 * are configurable. The digest is re-derived and checked so a tampered
 * request cannot be signed silently.
 */
export class FakeSigner implements TransactionSignerPort {
  #shouldFail = false;
  readonly requests: WithdrawalSigningRequest[] = [];

  public setShouldFail(fail: boolean): void {
    this.#shouldFail = fail;
  }

  public async sign(
    request: WithdrawalSigningRequest
  ): Promise<WithdrawalSigningResult> {
    this.requests.push(request);
    if (this.#shouldFail) {
      throw new SignerError('SIGNER_UNAVAILABLE');
    }
    if (!canonicalFieldsMatch(request, request.canonicalDigest)) {
      throw new SignerError('SIGNER_DIGEST_MISMATCH');
    }
    return {
      signatureRef: `fake-sig:${request.canonicalDigest}`,
      algorithm: 'FAKE-ED25519'
    };
  }
}

Object.freeze(FakeSigner.prototype);
