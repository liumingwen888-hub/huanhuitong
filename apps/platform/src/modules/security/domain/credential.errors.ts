import type { CredentialContractErrorCode } from '@xht/contracts';

const authentic = new WeakSet<CredentialError>();

export class CredentialError extends Error {
  public readonly code: CredentialContractErrorCode;
  public readonly retryable = false as const;

  constructor(code: CredentialContractErrorCode) {
    super(code);
    this.name = 'CredentialError';
    this.code = code;
    Object.defineProperty(this, 'stack', {
      value: `CredentialError: ${code}`,
      enumerable: false,
      writable: false,
      configurable: false
    });
    authentic.add(this);
    Object.freeze(this);
  }
}

export function isAuthenticCredentialError(
  value: unknown
): value is CredentialError {
  return (
    typeof value === 'object' && value !== null && authentic.has(value as CredentialError)
  );
}
