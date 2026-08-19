import type { LedgerContractErrorCode } from '@xht/contracts';

const authentic = new WeakSet<LedgerError>();

export class LedgerError extends Error {
  public readonly code: LedgerContractErrorCode;
  public readonly retryable = false as const;

  constructor(code: LedgerContractErrorCode) {
    super(code);
    this.name = 'LedgerError';
    this.code = code;
    Object.defineProperty(this, 'stack', {
      value: `LedgerError: ${code}`,
      enumerable: false,
      writable: false,
      configurable: false
    });
    authentic.add(this);
    Object.freeze(this);
  }
}

export function isAuthenticLedgerError(value: unknown): value is LedgerError {
  return (
    typeof value === 'object' &&
    value !== null &&
    authentic.has(value as LedgerError)
  );
}
