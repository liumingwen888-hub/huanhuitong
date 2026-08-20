import {
  TotpSecretUnavailableError,
  type TotpSecretPort
} from './totp-secret.port.js';

/**
 * Configurable fake secret store for tests: secrets are registered
 * per vault reference; unregistered references fail closed.
 */
export class FakeTotpSecretStore implements TotpSecretPort {
  readonly #secrets = new Map<string, string>();

  public setSecret(secretRef: string, base32Secret: string): void {
    this.#secrets.set(secretRef, base32Secret);
  }

  public async resolveSecret(secretRef: string): Promise<string> {
    const secret = this.#secrets.get(secretRef);
    if (secret === undefined) {
      throw new TotpSecretUnavailableError(secretRef);
    }
    return secret;
  }
}

Object.freeze(FakeTotpSecretStore.prototype);
