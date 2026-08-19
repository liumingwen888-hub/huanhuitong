import type { DepositContractErrorCode } from '@xht/contracts';

const authentic = new WeakSet<DepositError>();

export class DepositError extends Error {
  public readonly code: DepositContractErrorCode;
  public readonly retryable = false as const;

  constructor(code: DepositContractErrorCode) {
    super(code);
    this.name = 'DepositError';
    this.code = code;
    Object.defineProperty(this, 'stack', {
      value: `DepositError: ${code}`,
      enumerable: false,
      writable: false,
      configurable: false
    });
    authentic.add(this);
    Object.freeze(this);
  }
}

export function isAuthenticDepositError(value: unknown): value is DepositError {
  return (
    typeof value === 'object' &&
    value !== null &&
    authentic.has(value as DepositError)
  );
}
