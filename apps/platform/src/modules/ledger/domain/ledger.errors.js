const authentic = new WeakSet();
export class LedgerError extends Error {
    code;
    retryable = false;
    constructor(code) {
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
export function isAuthenticLedgerError(value) {
    return (typeof value === 'object' &&
        value !== null &&
        authentic.has(value));
}
//# sourceMappingURL=ledger.errors.js.map