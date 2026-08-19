import type { WithdrawalContractErrorCode } from '@xht/contracts';

export class WithdrawalError extends Error {
  public readonly code: WithdrawalContractErrorCode;

  public constructor(code: WithdrawalContractErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'WithdrawalError';
    this.code = code;
  }
}
