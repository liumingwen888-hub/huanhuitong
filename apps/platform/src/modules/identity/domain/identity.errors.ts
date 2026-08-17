import type { IdentityContractErrorCode } from '@xht/contracts';

const authenticIdentityErrors = new WeakSet<IdentityError>();

export class IdentityError extends Error {
  public readonly code: IdentityContractErrorCode;
  public readonly retryable = false as const;

  constructor(code: IdentityContractErrorCode) {
    super(code);
    this.name = 'IdentityError';
    this.code = code;
    Object.defineProperty(this, 'stack', {
      value: `IdentityError: ${code}`,
      enumerable: false,
      writable: false,
      configurable: false
    });
    authenticIdentityErrors.add(this);
    Object.freeze(this);
  }
}

export function isAuthenticIdentityError(
  value: unknown
): value is IdentityError {
  return typeof value === 'object' && value !== null &&
    authenticIdentityErrors.has(value as IdentityError);
}
