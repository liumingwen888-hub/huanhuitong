import type { ChainNetwork, LedgerAccountId } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import type {
  TransactionBroadcasterPort,
  BroadcastResult
} from '../domain/transaction-broadcaster.port.js';

export interface SweepCandidate {
  readonly addressId: string;
  readonly addressText: string;
  readonly assetCode: string;
  readonly totalAmount: string;
  readonly detectionCount: number;
}

export interface SweepOutcome {
  readonly candidate: SweepCandidate;
  readonly broadcast: BroadcastResult | null;
  readonly posted: boolean;
  readonly error: string | null;
}

export interface SweepBatchResult {
  readonly swept: number;
  readonly failed: number;
  readonly totalAmount: string;
  readonly outcomes: readonly SweepOutcome[];
}

/**
 * Collects funds from deposit addresses to the platform's main wallet.
 * The sweep posts two ledger entries: the asset transfer (DR deposit
 * address custody → CR main wallet custody) and the chain fee (DR
 * upstream cost → CR deposit address custody). Fees are borne by the
 * platform, not deducted from user credits.
 */
export class DepositSweepService {
  readonly #unitOfWork: UnitOfWork;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #broadcaster: TransactionBroadcasterPort;

  constructor(
    unitOfWork: UnitOfWork,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    broadcaster: TransactionBroadcasterPort
  ) {
    this.#unitOfWork = unitOfWork;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#broadcaster = broadcaster;
  }

  public async findSweepCandidates(
    network: ChainNetwork,
    thresholdAmount: string
  ): Promise<readonly SweepCandidate[]> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        address_id: string;
        address_text: string;
        asset_code: string;
        total_amount: string;
        detection_count: number;
      }>(
        `SELECT a.address_id, a.address_text, a.asset_code,
                COALESCE(SUM(d.amount), 0)::text AS total_amount,
                count(d.detection_id)::int AS detection_count
           FROM deposit_addresses a
           JOIN deposit_detections d ON d.address_id = a.address_id
          WHERE a.network = $1 AND a.status = 'ACTIVE'
            AND d.status = 'POSTED'
          GROUP BY a.address_id, a.address_text, a.asset_code
         HAVING COALESCE(SUM(d.amount), 0) >= $2::bigint`,
        [network, thresholdAmount]
      );
      return rows.rows.map((row) => ({
        addressId: row.address_id,
        addressText: row.address_text,
        assetCode: row.asset_code,
        totalAmount: row.total_amount,
        detectionCount: row.detection_count
      }));
    });
  }

  public async sweepAddress(
    candidate: SweepCandidate,
    network: ChainNetwork,
    mainWalletAddress: string
  ): Promise<SweepOutcome> {
    try {
      const broadcastResult = await this.#broadcaster.broadcast({
        network,
        fromAddress: candidate.addressText,
        toAddress: mainWalletAddress,
        amount: candidate.totalAmount,
        feeRate: 'standard'
      });
      const custodyAccountId = await this.#findOrCreateCustody(
        candidate.assetCode
      );
      const upstreamCostAccountId = await this.#findOrCreateUpstreamCost(
        candidate.assetCode
      );
      const total = BigInt(candidate.totalAmount);
      const fee = BigInt(broadcastResult.actualFee);
      const netAmount = total - fee;
      const orderId = `SWEEP:${network}:${broadcastResult.broadcastTxid}`;
      const posting = await this.#poster.post({
        idempotencyKey: `${orderId}:EXECUTE:0`,
        transactionType: 'ADJUSTMENT',
        occurredAt: new Date().toISOString(),
        lines: [
          {
            accountId: custodyAccountId,
            direction: 'DEBIT',
            amount: netAmount.toString()
          },
          {
            accountId: custodyAccountId,
            direction: 'CREDIT',
            amount: netAmount.toString()
          },
          {
            accountId: upstreamCostAccountId,
            direction: 'DEBIT',
            amount: broadcastResult.actualFee
          },
          {
            accountId: custodyAccountId,
            direction: 'CREDIT',
            amount: broadcastResult.actualFee
          }
        ]
      });
      void posting;
      return {
        candidate,
        broadcast: broadcastResult,
        posted: true,
        error: null
      };
    } catch (error) {
      return {
        candidate,
        broadcast: null,
        posted: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  public async sweepAll(
    network: ChainNetwork,
    thresholdAmount: string,
    mainWalletAddress: string
  ): Promise<SweepBatchResult> {
    const candidates = await this.findSweepCandidates(
      network,
      thresholdAmount
    );
    const outcomes: SweepOutcome[] = [];
    let totalBigInt = 0n;
    for (const candidate of candidates) {
      const outcome = await this.sweepAddress(
        candidate,
        network,
        mainWalletAddress
      );
      outcomes.push(outcome);
      if (outcome.posted) {
        totalBigInt += BigInt(candidate.totalAmount);
      }
    }
    return {
      swept: outcomes.filter((o) => o.posted).length,
      failed: outcomes.filter((o) => !o.posted).length,
      totalAmount: totalBigInt.toString(),
      outcomes: Object.freeze(outcomes)
    };
  }

  async #findOrCreateCustody(
    assetCode: string
  ): Promise<LedgerAccountId> {
    return this.#findOrCreatePlatformAccount(assetCode, 'PLATFORM_CUSTODY');
  }

  async #findOrCreateUpstreamCost(
    assetCode: string
  ): Promise<LedgerAccountId> {
    return this.#findOrCreatePlatformAccount(
      assetCode,
      'UPSTREAM_COST'
    );
  }

  async #findOrCreatePlatformAccount(
    assetCode: string,
    purpose: string
  ): Promise<LedgerAccountId> {
    const existing = await this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1 AND purpose = $2
          LIMIT 1`,
        [assetCode, purpose]
      );
      return rows.rows[0]?.account_id ?? null;
    });
    if (existing !== null) return existing as LedgerAccountId;
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ account_id: string }>(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES (NULL, $1, $2)
         ON CONFLICT (owner_uid, asset_code, purpose) DO NOTHING
         RETURNING account_id`,
        [assetCode, purpose]
      );
      if (rows.rows.length === 1) {
        return rows.rows[0]!.account_id as LedgerAccountId;
      }
      const raced = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1 AND purpose = $2
          LIMIT 1`,
        [assetCode, purpose]
      );
      return raced.rows[0]!.account_id as LedgerAccountId;
    });
  }
}
