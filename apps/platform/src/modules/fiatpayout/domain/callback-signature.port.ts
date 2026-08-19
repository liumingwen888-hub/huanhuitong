export interface CallbackVerificationInput {
  readonly providerId: string;
  readonly secretRef: string;
  readonly payload: string;
  readonly signature: string;
}

/**
 * Provider callback signature boundary: callers pass the secret
 * REFERENCE (never key material) together with the raw payload and
 * the provider signature. Production implementations resolve the
 * reference through the vault boundary.
 */
export interface CallbackSignaturePort {
  verify(input: CallbackVerificationInput): Promise<boolean>;
}
