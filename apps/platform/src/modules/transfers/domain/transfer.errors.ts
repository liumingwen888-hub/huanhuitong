import type { TransferContractErrorCode } from '@xht/contracts';

const authentic = new WeakSet<TransferError>();

export class TransferError extends Error {
  public readonly code: TransferContractErrorCode;
  public readonly retryable = false as const;

  constructor(code: TransferContractErrorCode) {
    super(code);
    this.name = 'TransferError';
    this.code = code;
    Object.defineProperty(this, 'stack', {
      value: `TransferError: ${code}`,
      enumerable: false,
      writable: false,
      configurable: false
    });
    authentic.add(this);
    Object.freeze(this);
  }
}

export function isAuthenticTransferError(value: unknown): value is TransferError {
  return (
    typeof value === 'object' &&
    value !== null &&
    authentic.has(value as TransferError)
  );
}
