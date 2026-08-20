/**
 * Resolves a TOTP secret by its vault reference. Key material never
 * crosses this boundary in the outward direction — callers hand in
 * the reference stored on admin_credentials and receive the secret
 * for verification only.
 */
export interface TotpSecretPort {
  resolveSecret(secretRef: string): Promise<string>;
}

export class TotpSecretUnavailableError extends Error {
  public constructor(secretRef: string) {
    super(`TOTP_SECRET_UNAVAILABLE:${secretRef}`);
    this.name = 'TotpSecretUnavailableError';
  }
}
