import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';

export interface PayoutLinkageDiscrepancy {
  readonly kind: 'ORDER_LEDGER_LINKAGE';
  readonly orderRef: string;
  readonly detail: string;
}

export interface ReportMismatchDiscrepancy {
  readonly kind: 'REPORT_ORDER_MISMATCH';
  readonly providerIdempotencyKey: string;
  readonly reportedStatus: string;
  readonly orderStatus: string;
}

export interface OrphanReportDiscrepancy {
  readonly kind: 'ORPHAN_REPORT';
  readonly providerIdempotencyKey: string;
}

export type PayoutDiscrepancy =
  | PayoutLinkageDiscrepancy
  | ReportMismatchDiscrepancy
  | OrphanReportDiscrepancy;

export interface PayoutReconciliationReport {
  readonly discrepancies: readonly PayoutDiscrepancy[];
  readonly checkedAt: string;
}

interface LinkageRow {
  readonly order_ref: string;
  readonly status: string;
  readonly freezes: number;
  readonly settles: number;
  readonly releases: number;
  readonly reverses: number;
  readonly has_settlement_link: boolean;
}

const EXPECTED_BY_STATUS: Readonly<Record<string, {
  readonly freezes: number;
  readonly settles: number;
  readonly releases: number;
  readonly reverses: number;
  readonly link: boolean;
}>> = Object.freeze({
  FUNDS_RESERVED: { freezes: 1, settles: 0, releases: 0, reverses: 0, link: false },
  SUBMITTING: { freezes: 1, settles: 0, releases: 0, reverses: 0, link: false },
  ACCEPTED: { freezes: 1, settles: 0, releases: 0, reverses: 0, link: false },
  UNKNOWN: { freezes: 1, settles: 0, releases: 0, reverses: 0, link: false },
  FAILED: { freezes: 1, settles: 0, releases: 0, reverses: 0, link: false },
  SUCCEEDED: { freezes: 1, settles: 1, releases: 0, reverses: 0, link: true },
  REFUNDED: { freezes: 1, settles: 0, releases: 1, reverses: 0, link: true },
  REVERSED: { freezes: 1, settles: 1, releases: 0, reverses: 1, link: true }
});

/**
 * Read-only payout reconciliation: every order must carry the exact
 * posting shape its status implies (four mutually exclusive actions),
 * and provider reports in the callback inbox must not contradict the
 * order state — a reported FAILED on an already-settled order is the
 * most severe divergence signal and must surface, never auto-repair.
 */
export class PayoutReconciliationService {
  readonly #unitOfWork: UnitOfWork;

  constructor(unitOfWork: UnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  public async runAll(): Promise<PayoutReconciliationReport> {
    const discrepancies = [
      ...(await this.checkOrderLedgerLinkage()),
      ...(await this.checkProviderReportConsistency())
    ];
    return Object.freeze({
      discrepancies: Object.freeze(discrepancies),
      checkedAt: new Date().toISOString()
    });
  }

  public async checkOrderLedgerLinkage(): Promise<
    readonly PayoutLinkageDiscrepancy[]
  > {
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<LinkageRow>(
        `WITH tx_counts AS (
           SELECT key,
                  count(*) FILTER (
                    WHERE position(':FREEZE:' in idempotency_key) > 0)::int
                    AS freezes,
                  count(*) FILTER (
                    WHERE position(':SETTLE:' in idempotency_key) > 0)::int
                    AS settles,
                  count(*) FILTER (
                    WHERE position(':RELEASE:' in idempotency_key) > 0)::int
                    AS releases,
                  count(*) FILTER (
                    WHERE position(':REVERSE:' in idempotency_key) > 0)::int
                    AS reverses
             FROM (
               SELECT idempotency_key,
                      substring(idempotency_key
                        from 'FIAT_PAYOUT:([^:]+):') AS key
                 FROM ledger_transactions
                WHERE idempotency_key LIKE 'FIAT_PAYOUT:%'
             ) k
            GROUP BY key
         )
         SELECT o.order_ref, o.status,
                COALESCE(tc.freezes, 0) AS freezes,
                COALESCE(tc.settles, 0) AS settles,
                COALESCE(tc.releases, 0) AS releases,
                COALESCE(tc.reverses, 0) AS reverses,
                (o.settlement_ledger_transaction_id IS NOT NULL)
                  AS has_settlement_link
           FROM payout_orders o
           LEFT JOIN tx_counts tc ON tc.key = o.order_ref`
      )
    );
    const discrepancies: PayoutLinkageDiscrepancy[] = [];
    for (const row of rows.rows) {
      const expected = EXPECTED_BY_STATUS[row.status];
      if (expected === undefined) {
        discrepancies.push({
          kind: 'ORDER_LEDGER_LINKAGE',
          orderRef: row.order_ref,
          detail: `unknown status ${row.status}`
        });
        continue;
      }
      if (
        row.freezes !== expected.freezes ||
        row.settles !== expected.settles ||
        row.releases !== expected.releases ||
        row.reverses !== expected.reverses ||
        row.has_settlement_link !== expected.link
      ) {
        discrepancies.push({
          kind: 'ORDER_LEDGER_LINKAGE',
          orderRef: row.order_ref,
          detail: `status=${row.status} freeze=${row.freezes}` +
            ` settle=${row.settles} release=${row.releases}` +
            ` reverse=${row.reverses} link=${row.has_settlement_link}`
        });
      }
    }
    return discrepancies;
  }

  public async checkProviderReportConsistency(): Promise<
    readonly (ReportMismatchDiscrepancy | OrphanReportDiscrepancy)[]
  > {
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<{
        readonly provider_idempotency_key: string;
        readonly reported_status: string;
        readonly order_status: string | null;
      }>(
        `SELECT i.provider_idempotency_key, i.reported_status,
                o.status AS order_status
           FROM callback_inbox i
           LEFT JOIN payout_orders o
             ON o.provider_idempotency_key = i.provider_idempotency_key`
      )
    );
    const discrepancies: (
      | ReportMismatchDiscrepancy
      | OrphanReportDiscrepancy
    )[] = [];
    for (const row of rows.rows) {
      if (row.order_status === null) {
        discrepancies.push({
          kind: 'ORPHAN_REPORT',
          providerIdempotencyKey: row.provider_idempotency_key
        });
        continue;
      }
      const contradicts =
        (row.reported_status === 'FAILED' &&
          (row.order_status === 'SUCCEEDED' ||
            row.order_status === 'REVERSED')) ||
        (row.reported_status === 'SUCCEEDED' &&
          (row.order_status === 'FAILED' ||
            row.order_status === 'REFUNDED'));
      if (contradicts) {
        discrepancies.push({
          kind: 'REPORT_ORDER_MISMATCH',
          providerIdempotencyKey: row.provider_idempotency_key,
          reportedStatus: row.reported_status,
          orderStatus: row.order_status
        });
      }
    }
    return discrepancies;
  }
}
