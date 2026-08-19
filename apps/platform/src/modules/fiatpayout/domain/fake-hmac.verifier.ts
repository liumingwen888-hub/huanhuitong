import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CallbackSignaturePort,
  CallbackVerificationInput
} from './callback-signature.port.js';

/**
 * Real-HMAC fake verifier: secrets are configured per secret
 * reference and verification performs an actual HMAC-SHA256
 * comparison (constant-time), so tests sign payloads themselves and
 * the verification contract is genuinely exercised.
 */
export class FakeHmacVerifier implements CallbackSignaturePort {
  readonly #secrets = new Map<string, string>();

  public setSecret(secretRef: string, secret: string): void {
    this.#secrets.set(secretRef, secret);
  }

  public async verify(input: CallbackVerificationInput): Promise<boolean> {
    const secret = this.#secrets.get(input.secretRef);
    if (secret === undefined) {
      return false;
    }
    const expected = createHmac('sha256', secret)
      .update(input.payload)
      .digest('base64url');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(input.signature, 'utf8');
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }
}

Object.freeze(FakeHmacVerifier.prototype);
