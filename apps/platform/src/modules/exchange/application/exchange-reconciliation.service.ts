import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { parseDecimalRate } from '../domain/quote-math.js';

export interface OrderLedgerLinkageDiscrepancy {
  readonly kind: 'ORDER_LEDGER_LINKAGE';
  readonly orderRef: string;
  readonly detail: string;
}

export interface QuoteSnapshotDiscrepancy {
  readonly kind: 'QUOTE_SNAPSHOT_MISMATCH';
  readonly orderRef: string;
  readonly field: string;
}

export interface ClearingAccumulationDiscrepancy {
  readonly kind: 'CLEARING_ACCUMULATION';
  readonly assetCode: string;
  readonly expected: string;
  readonly actual: string;
}

export type ExchangeDiscrepancy =
  | OrderLedgerLinkageDiscrepancy
  | QuoteSnapshotDiscrepancy
  | ClearingAccumulationDiscrepancy;

export interface ClearingBalanceFact {
  readonly assetCode: string;
  readonly signed: string;
}

export interface MarketValueFact {
  readonly marketKey: string;
  readonly legValueDifference: string;
}

export interface ExchangeReconciliationReport {
  readonly discrepancies: readonly ExchangeDiscrepancy[];
  readonly clearingBalances: readonly ClearingBalanceFact[];
  readonly marketValueSummary: readonly MarketValueFact[];
  readonly checkedAt: string;
}

interface OrderLinkageRow {
  readonly order_ref: string;
  readonly status: string;
  readonly freezes: number;
  readonly settles: number;
  readonly releases: number;
  readonly has_settlement_link: boolean;
}

interface OrderQuoteRow {
  readonly order_ref: string;
  readonly sell_amount: string;
  readonly buy_amount: string;
  readonly quote_sell: string;
  readonly quote_buy: string;
  readonly market_key: string;
  readonly reference_rate: string;
  readonly status: string;
}

/**
 * Read-only reconciliation over exchange orders. Never mutates
 * entries, orders or projections — discrepancies are surfaced for
 * human review, never auto-repaired. Spread and rounding value is
 * summarized per market using each order's own quote-time reference
 * rate, so the summary is always recomputable from stored facts.
 */
export class ExchangeReconciliationService {
  readonly #unitOfWork: UnitOfWork;

  constructor(unitOfWork: UnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  public async runAll(): Promise<ExchangeReconciliationReport> {
    const discrepancies = [
      ...(await this.checkOrderLedgerLinkage()),
      ...(await this.checkQuoteSnapshotConsistency()),
      ...(await this.checkClearingAccumulation())
    ];
    const clearingBalances = await this.#clearingBalances();
    const marketValueSummary = await this.#marketValueSummary();
    return Object.freeze({
      discrepancies: Object.freeze(discrepancies),
      clearingBalances: Object.freeze(clearingBalances),
      marketValueSummary: Object.freeze(marketValueSummary),
      checkedAt: new Date().toISOString()
    });
  }

  public async checkOrderLedgerLinkage(): Promise<
    readonly OrderLedgerLinkageDiscrepancy[]
  > {
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<OrderLinkageRow>(
        `SELECT o.order_ref, o.status,
           (SELECT count(*)::int FROM ledger_transactions t
             WHERE t.idempotency_key LIKE 'EXCHANGE:'||o.order_ref||':FREEZE:%')
             AS freezes,
           (SELECT count(*)::int FROM ledger_transactions t
             WHERE t.idempotency_key LIKE 'EXCHANGE:'||o.order_ref||':SETTLE:%')
             AS settles,
           (SELECT count(*)::int FROM ledger_transactions t
             WHERE t.idempotency_key LIKE 'EXCHANGE:'||o.order_ref||':RELEASE:%')
             AS releases,
           (o.settlement_ledger_transaction_id IS NOT NULL)
             AS has_settlement_link
         FROM exchange_orders o`
      )
    );
    const discrepancies: OrderLedgerLinkageDiscrepancy[] = [];
    for (const row of rows.rows) {
      const expected =
        row.status === 'SETTLED'
          ? { freezes: 1, settles: 1, releases: 0, link: true }
          : row.status === 'REFUNDED'
            ? { freezes: 1, settles: 0, releases: 1, link: true }
            : { freezes: 1, settles: 0, releases: 0, link: false };
      if (
        row.freezes !== expected.freezes ||
        row.settles !== expected.settles ||
        row.releases !== expected.releases ||
        row.has_settlement_link !== expected.link
      ) {
        discrepancies.push({
          kind: 'ORDER_LEDGER_LINKAGE',
          orderRef: row.order_ref,
          detail: `status=${row.status} freeze=${row.freezes} settle=${row.settles}` +
            ` release=${row.releases} link=${row.has_settlement_link}`
        });
      }
    }
    return discrepancies;
  }

  public async checkQuoteSnapshotConsistency(): Promise<
    readonly QuoteSnapshotDiscrepancy[]
  > {
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<OrderQuoteRow>(
        `SELECT o.order_ref, o.sell_amount::text AS sell_amount,
                o.buy_amount::text AS buy_amount,
                q.sell_amount::text AS quote_sell,
                q.buy_amount::text AS quote_buy
           FROM exchange_orders o
           JOIN quotes q ON q.quote_id = o.quote_id`
      )
    );
    const discrepancies: QuoteSnapshotDiscrepancy[] = [];
    for (const row of rows.rows) {
      if (row.sell_amount !== row.quote_sell) {
        discrepancies.push({
          kind: 'QUOTE_SNAPSHOT_MISMATCH',
          orderRef: row.order_ref,
          field: 'sell_amount'
        });
      }
      if (row.buy_amount !== row.quote_buy) {
        discrepancies.push({
          kind: 'QUOTE_SNAPSHOT_MISMATCH',
          orderRef: row.order_ref,
          field: 'buy_amount'
        });
      }
    }
    return discrepancies;
  }

  public async checkClearingAccumulation(): Promise<
    readonly ClearingAccumulationDiscrepancy[]
  > {
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<{
        asset_code: string;
        projected: string | null;
        recomputed: string | null;
      }>(
        `SELECT a.asset_code, b.signed_balance::text AS projected,
                COALESCE(x.recomputed, '0') AS recomputed
           FROM ledger_accounts a
           LEFT JOIN account_balances b ON b.account_id = a.account_id
           LEFT JOIN (
             SELECT e.account_id,
                    SUM(CASE e.direction WHEN 'DEBIT' THEN e.amount
                                          ELSE -e.amount END)::text
                      AS recomputed
               FROM ledger_entries e
               JOIN ledger_transactions t
                 ON t.transaction_id = e.transaction_id
              WHERE t.transaction_type = 'EXCHANGE'
              GROUP BY e.account_id
           ) x ON x.account_id = a.account_id
          WHERE a.owner_uid IS NULL AND a.purpose = 'CLEARING_DIFF'`
      )
    );
    const discrepancies: ClearingAccumulationDiscrepancy[] = [];
    for (const row of rows.rows) {
      const actual = row.projected ?? '0';
      const expected = row.recomputed ?? '0';
      if (BigInt(actual) !== BigInt(expected)) {
        discrepancies.push({
          kind: 'CLEARING_ACCUMULATION',
          assetCode: row.asset_code,
          expected,
          actual
        });
      }
    }
    return discrepancies;
  }

  async #clearingBalances(): Promise<readonly ClearingBalanceFact[]> {
    return this.#unitOfWork.execute((context) =>
      context.executeSql<{ asset_code: string; signed: string }>(
        `SELECT a.asset_code, b.signed_balance::text AS signed
           FROM account_balances b
           JOIN ledger_accounts a ON a.account_id = b.account_id
          WHERE a.owner_uid IS NULL AND a.purpose = 'CLEARING_DIFF'
          ORDER BY a.asset_code`
      ).then((result) =>
        result.rows.map((row) => ({
          assetCode: row.asset_code,
          signed: row.signed
        }))
      )
    );
  }

  async #marketValueSummary(): Promise<readonly MarketValueFact[]> {
    const rows = await this.#unitOfWork.execute((context) =>
      context.executeSql<{
        market_key: string;
        sell_amount: string;
        buy_amount: string;
        reference_rate: string;
        sell_asset: string;
        buy_asset: string;
      }>(
        `SELECT o.market_key, o.sell_amount::text AS sell_amount,
                o.buy_amount::text AS buy_amount,
                q.reference_rate, o.sell_asset_code AS sell_asset,
                o.buy_asset_code AS buy_asset
           FROM exchange_orders o
           JOIN quotes q ON q.quote_id = o.quote_id
          WHERE o.status = 'SETTLED'`
      )
    );
    if (rows.rows.length === 0) {
      return [];
    }
    const decimals = await this.#unitOfWork.execute((context) =>
      context.executeSql<{ asset_code: string; decimals: number }>(
        `SELECT asset_code, decimals FROM asset_catalog`
      )
    );
    const decimalsByAsset = new Map(
      decimals.rows.map((row) => [row.asset_code, row.decimals])
    );
    const differenceByMarket = new Map<string, bigint>();
    for (const row of rows.rows) {
      const sellDecimals = decimalsByAsset.get(row.sell_asset);
      const buyDecimals = decimalsByAsset.get(row.buy_asset);
      if (sellDecimals === undefined || buyDecimals === undefined) {
        continue;
      }
      const rate = parseDecimalRate(row.reference_rate);
      const shift =
        BigInt(10) **
        BigInt(Math.max(buyDecimals - sellDecimals, 0));
      const shiftDown =
        BigInt(10) **
        BigInt(Math.max(sellDecimals - buyDecimals, 0));
      const sellValueInBuyUnits =
        (BigInt(row.sell_amount) * rate.num * shift) /
        (rate.den * shiftDown);
      const difference = sellValueInBuyUnits - BigInt(row.buy_amount);
      differenceByMarket.set(
        row.market_key,
        (differenceByMarket.get(row.market_key) ?? 0n) + difference
      );
    }
    return [...differenceByMarket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([marketKey, difference]) => ({
        marketKey,
        legValueDifference: difference.toString()
      }));
  }
}
