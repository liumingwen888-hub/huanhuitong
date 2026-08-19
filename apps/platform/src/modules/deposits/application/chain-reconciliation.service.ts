import type { ChainNetwork } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { ChainScannerPort } from '../domain/chain-scanner.port.js';

export interface ChainDiscrepancy {
  readonly addressId: string;
  readonly addressText: string;
  readonly assetCode: string;
  readonly chainBalance: string;
  readonly ledgerBalance: string;
  readonly difference: string;
}

export interface ChainReconciliationReport {
  readonly network: ChainNetwork;
  readonly addressesChecked: number;
  readonly discrepancyCount: number;
  readonly discrepancies: readonly ChainDiscrepancy[];
  readonly checkedAt: string;
}

/**
 * Compares on-chain address balances with ledger-implied balances.
 * Any discrepancy is reported and recorded as a risk decision alert;
 * discrepancies are never auto-repaired (human review required).
 */
export class ChainReconciliationService {
  readonly #unitOfWork: UnitOfWork;
  readonly #scanner: ChainScannerPort;

  constructor(unitOfWork: UnitOfWork, scanner: ChainScannerPort) {
    this.#unitOfWork = unitOfWork;
    this.#scanner = scanner;
  }

  public async reconcileAll(
    network: ChainNetwork
  ): Promise<ChainReconciliationReport> {
    const addresses = await this.#getActiveAddresses(network);
    const discrepancies: ChainDiscrepancy[] = [];
    for (const address of addresses) {
      const chainBalance = await this.#scanner.getAddressBalance(
        network,
        address.addressText
      );
      const ledgerBalance = await this.#getLedgerBalance(
        address.addressId
      );
      const chain = BigInt(chainBalance);
      const ledger = BigInt(ledgerBalance);
      if (chain !== ledger) {
        discrepancies.push({
          addressId: address.addressId,
          addressText: address.addressText,
          assetCode: address.assetCode,
          chainBalance,
          ledgerBalance,
          difference: (chain - ledger).toString()
        });
      }
    }
    const report: ChainReconciliationReport = Object.freeze({
      network,
      addressesChecked: addresses.length,
      discrepancyCount: discrepancies.length,
      discrepancies: Object.freeze(discrepancies),
      checkedAt: new Date().toISOString()
    });
    if (discrepancies.length > 0) {
      await this.#recordAlerts(report, network);
    }
    return report;
  }

  async #getActiveAddresses(
    network: ChainNetwork
  ): Promise<
    readonly {
      addressId: string;
      addressText: string;
      assetCode: string;
    }[]
  > {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        address_id: string;
        address_text: string;
        asset_code: string;
      }>(
        `SELECT address_id, address_text, asset_code
           FROM deposit_addresses
          WHERE network = $1 AND status = 'ACTIVE'`,
        [network]
      );
      return rows.rows.map((row) => ({
        addressId: row.address_id,
        addressText: row.address_text,
        assetCode: row.asset_code
      }));
    });
  }

  async #getLedgerBalance(addressId: string): Promise<string> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total
           FROM deposit_detections
          WHERE address_id = $1::uuid AND status = 'POSTED'`,
        [addressId]
      );
      return rows.rows[0]?.total ?? '0';
    });
  }

  async #recordAlerts(
    report: ChainReconciliationReport,
    network: ChainNetwork
  ): Promise<void> {
    for (const discrepancy of report.discrepancies) {
      await this.#unitOfWork.execute((context) =>
        context.executeSql(
          `INSERT INTO risk_decisions
             (uid, operation_type, allowed, reason_code, idempotency_key)
           VALUES (
             (SELECT uid FROM users WHERE status = 'ACTIVE' LIMIT 1),
             'INTERNAL_TRANSFER',
             false,
             'CHAIN_RECONCILIATION_DISCREPANCY',
             $1
           )
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [`chain-recon:${network}:${discrepancy.addressId}`]
        )
      );
    }
  }
}
