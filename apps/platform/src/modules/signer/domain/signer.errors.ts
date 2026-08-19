export type SignerErrorCode =
  | 'SIGNER_UNAVAILABLE'
  | 'SIGNER_DIGEST_MISMATCH';

export class SignerError extends Error {
  public readonly code: SignerErrorCode;

  public constructor(code: SignerErrorCode) {
    super(code);
    this.name = 'SignerError';
    this.code = code;
  }
}
