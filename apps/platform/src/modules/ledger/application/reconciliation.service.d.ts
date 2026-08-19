import type { LedgerAccountId } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { LedgerAccountRepository } from './ledger.repository.js';
export interface GlobalBalanceDiscrepancy {
    readonly kind: 'GLOBAL_BALANCE';
    readonly assetCode: string;
    readonly netSum: string;
}
export interface ProjectionDiscrepancy {
    readonly kind: 'PROJECTION_MISMATCH';
    readonly accountId: LedgerAccountId;
    readonly projected: string;
    readonly authoritative: string;
}
export interface AccountIntegrityDiscrepancy {
    readonly kind: 'ACCOUNT_INTEGRITY';
    readonly accountId: LedgerAccountId;
    readonly detail: string;
}
export type ReconciliationDiscrepancy = GlobalBalanceDiscrepancy | ProjectionDiscrepancy | AccountIntegrityDiscrepancy;
export interface ReconciliationReport {
    readonly discrepancies: readonly ReconciliationDiscrepancy[];
    readonly checkedAt: string;
}
/**
 * Read-only reconciliation over the ledger. Never mutates entries or
 * projections — discrepancies are surfaced for human review, never
 * auto-repaired.
 */
export declare class ReconciliationService {
    #private;
    constructor(unitOfWork: UnitOfWork, accounts: LedgerAccountRepository);
    runAll(): Promise<ReconciliationReport>;
    checkGlobalBalance(): Promise<readonly GlobalBalanceDiscrepancy[]>;
    checkProjectionConsistency(): Promise<readonly ProjectionDiscrepancy[]>;
    checkAccountIntegrity(): Promise<readonly AccountIntegrityDiscrepancy[]>;
    recordDiscrepancyAlerts(report: ReconciliationReport, windowKey: string): Promise<number>;
    findTransactionByOrderKey(orderType: string, orderId: string): Promise<string | null>;
}
