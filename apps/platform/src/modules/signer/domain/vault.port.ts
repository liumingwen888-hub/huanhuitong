export interface VaultSignInput {
  readonly keyRef: string;
  readonly digest: string;
}

export interface VaultSignature {
  readonly signature: string;
  readonly algorithm: string;
}

/**
 * HSM-style key boundary: callers submit a digest and receive a
 * signature. No method on this interface returns key material by
 * construction — that invariant is the point of the port.
 */
export interface VaultPort {
  sign(input: VaultSignInput): Promise<VaultSignature>;
}
