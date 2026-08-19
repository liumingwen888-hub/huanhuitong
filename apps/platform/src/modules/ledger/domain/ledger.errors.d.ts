import type { LedgerContractErrorCode } from '@xht/contracts';
export declare class LedgerError extends Error {
    readonly code: LedgerContractErrorCode;
    readonly retryable: false;
    constructor(code: LedgerContractErrorCode);
}
export declare function isAuthenticLedgerError(value: unknown): value is LedgerError;
