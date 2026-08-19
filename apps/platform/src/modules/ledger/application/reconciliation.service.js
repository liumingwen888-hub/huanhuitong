/**
 * Read-only reconciliation over the ledger. Never mutates entries or
 * projections — discrepancies are surfaced for human review, never
 * auto-repaired.
 */
export class ReconciliationService {
    #unitOfWork;
    #accounts;
    constructor(unitOfWork, accounts) {
        this.#unitOfWork = unitOfWork;
        this.#accounts = accounts;
    }
    async runAll() {
        const discrepancies = [
            ...(await this.checkGlobalBalance()),
            ...(await this.checkProjectionConsistency()),
            ...(await this.checkAccountIntegrity())
        ];
        return Object.freeze({
            discrepancies: Object.freeze(discrepancies),
            checkedAt: new Date().toISOString()
        });
    }
    async checkGlobalBalance() {
        return this.#unitOfWork.execute(async (context) => {
            const rows = await context.executeSql(`SELECT a.asset_code,
                COALESCE(SUM(
                  CASE e.direction WHEN 'DEBIT' THEN e.amount ELSE -e.amount END
                ), 0)::text AS net_sum
           FROM ledger_accounts a
           LEFT JOIN ledger_entries e ON e.account_id = a.account_id
          GROUP BY a.asset_code
         HAVING COALESCE(SUM(
                  CASE e.direction WHEN 'DEBIT' THEN e.amount ELSE -e.amount END
                ), 0) <> 0`);
            return rows.rows.map((row) => ({
                kind: 'GLOBAL_BALANCE',
                assetCode: row.asset_code,
                netSum: row.net_sum
            }));
        });
    }
    async checkProjectionConsistency() {
        return this.#unitOfWork.execute(async (context) => {
            const rows = await context.executeSql(`SELECT p.account_id,
                p.signed_balance::text AS projected,
                COALESCE((
                  SELECT SUM(CASE e.direction WHEN 'DEBIT' THEN e.amount
                                              ELSE -e.amount END)::text
                    FROM ledger_entries e WHERE e.account_id = p.account_id
                ), '0') AS authoritative
           FROM account_balances p`);
            const discrepancies = [];
            for (const row of rows.rows) {
                if (row.projected !== row.authoritative) {
                    discrepancies.push({
                        kind: 'PROJECTION_MISMATCH',
                        accountId: row.account_id,
                        projected: row.projected,
                        authoritative: row.authoritative
                    });
                }
            }
            return discrepancies;
        });
    }
    async checkAccountIntegrity() {
        return this.#unitOfWork.execute(async (context) => {
            const closed = await context.executeSql(`SELECT a.account_id, count(e.entry_id)::int AS n
           FROM ledger_accounts a
           JOIN ledger_entries e ON e.account_id = a.account_id
          WHERE a.status IN ('FROZEN', 'CLOSED')
            AND e.transaction_id IN (
              SELECT transaction_id FROM ledger_transactions
               WHERE created_at > a.created_at + interval '1 hour'
            )
          GROUP BY a.account_id`);
            return closed.rows.map((row) => ({
                kind: 'ACCOUNT_INTEGRITY',
                accountId: row.account_id,
                detail: `ACCOUNT_STATUS_${row.n > 0 ? 'LATE_ENTRIES' : 'CONSTRAINED'}`
            }));
        });
    }
    async recordDiscrepancyAlerts(report, windowKey) {
        if (report.discrepancies.length === 0)
            return 0;
        return this.#unitOfWork.execute(async (context) => {
            let recorded = 0;
            for (const discrepancy of report.discrepancies) {
                const result = await context.executeSql(`INSERT INTO risk_decisions
             (uid, operation_type, allowed, reason_code, idempotency_key)
           VALUES (
             (SELECT uid FROM users LIMIT 1),
             'INTERNAL_TRANSFER',
             false,
             'RECONCILIATION_DISCREPANCY',
             $1
           )
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING decision_id`, [`recon:${windowKey}:${discrepancy.kind}:${'accountId' in discrepancy
                        ? discrepancy.accountId
                        : discrepancy.assetCode}`]);
                if (result.rows.length === 1)
                    recorded += 1;
            }
            return recorded;
        });
    }
    async findTransactionByOrderKey(orderType, orderId) {
        return this.#unitOfWork.execute(async (context) => {
            const rows = await context.executeSql(`SELECT transaction_id FROM ledger_transactions
          WHERE idempotency_key LIKE $1
          LIMIT 1`, [`${orderType}:${orderId}:%`]);
            return rows.rows[0]?.transaction_id ?? null;
        });
    }
}
Object.freeze(ReconciliationService.prototype);
//# sourceMappingURL=reconciliation.service.js.map