import type { ChainNetwork, Uid } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { DepositDetectionRepository } from './deposit.repository.js';
import type { ReverseTransactionService } from '../../ledger/application/reverse-transaction.service.js';
import type { ChainScannerPort } from '../domain/chain-scanner.port.js';

export interface ConfirmedDetection {
  readonly detectionId: string;
  readonly addressId: string;
  readonly uid: Uid;
  readonly assetCode: string;
  readonly amount: string;
  readonly networkTxid: string;
}

export interface ReorgOutcome {
  readonly processed: number;
  readonly reversed: number;
  readonly blocked: number;
  readonly markedUnknown: number;
}

export interface ConfirmationResult {
  readonly confirmed: number;
  readonly skipped: number;
}

/**
 * Advances deposit detections through the confirmation lifecycle:
 * DETECTED → CONFIRMED (when confirmations meet policy), and handles
 * chain reorgs by reversing posted ledger entries or blocking
 * unconfirmed-but-detected deposits. UNKNOWN outcomes are never
 * auto-reversed or auto-repaid — they are marked for human review.
 */
export class DepositConfirmationService {
  readonly #unitOfWork: UnitOfWork;
  readonly #detections: DepositDetectionRepository;
  readonly #reverser: ReverseTransactionService | null;
  readonly #scanner: ChainScannerPort | null;

  constructor(
    unitOfWork: UnitOfWork,
    detections: DepositDetectionRepository,
    reverser?: ReverseTransactionService,
    scanner?: ChainScannerPort
  ) {
    this.#unitOfWork = unitOfWork;
    this.#detections = detections;
    this.#reverser = reverser ?? null;
    this.#scanner = scanner ?? null;
  }

  public async processConfirmations(
    network: ChainNetwork
  ): Promise<ConfirmationResult> {
    const confirmedList = await this.#findConfirmedByNetwork(network);
    let confirmed = 0;
    let skipped = 0;
    for (const detection of confirmedList) {
      const transitioned = await this.#unitOfWork.execute((context) =>
        this.#detections.transitionStatus(
          context,
          detection.detectionId,
          'DETECTED',
          'CONFIRMED'
        )
      );
      if (transitioned) confirmed += 1;
      else skipped += 1;
    }
    return { confirmed, skipped };
  }

  public async processReorg(
    network: ChainNetwork,
    orphanedTxids: readonly string[]
  ): Promise<ReorgOutcome> {
    let reversed = 0;
    let blocked = 0;
    let markedUnknown = 0;
    for (const txid of orphanedTxids) {
      const detection = await this.#findDetectionByTxid(network, txid);
      if (detection === null) continue;
      if (detection.status === 'POSTED') {
        if (this.#reverser !== null && detection.ledgerTransactionId !== null) {
          await this.#reverser.reverse({
            originalTransactionId: detection.ledgerTransactionId,
            idempotencyKey: `REORG:${network}:${txid}`
          });
          await this.#transition(detection.detectionId, 'POSTED', 'REORG_DETECTED');
          reversed += 1;
        } else {
          await this.#transition(detection.detectionId, 'POSTED', 'REORG_DETECTED');
          markedUnknown += 1;
        }
      } else if (detection.status === 'CONFIRMED') {
        await this.#transition(detection.detectionId, 'CONFIRMED', 'REORG_DETECTED');
        blocked += 1;
      } else if (detection.status === 'DETECTED') {
        await this.#transition(detection.detectionId, 'DETECTED', 'REORG_DETECTED');
        blocked += 1;
      }
    }
    return {
      processed: orphanedTxids.length,
      reversed,
      blocked,
      markedUnknown
    };
  }

  public async refreshConfirmations(
    network: ChainNetwork
  ): Promise<number> {
    if (this.#scanner === null) return 0;
    const pending = await this.#findPendingDetections(network);
    let updated = 0;
    for (const detection of pending) {
      const tx = await this.#scanner.getTransactionsForAddress(
        network,
        detection.addressText,
        '0',
        '999999999999'
      );
      const match = tx.find(
        (t) => t.networkTxid === detection.networkTxid
      );
      if (match !== undefined && match.confirmations > detection.confirmations) {
        await this.#updateConfirmations(
          detection.detectionId,
          match.confirmations
        );
        updated += 1;
      }
    }
    return updated;
  }

  async #findDetectionByTxid(
    network: ChainNetwork,
    networkTxid: string
  ): Promise<{
    detectionId: string;
    status: string;
    ledgerTransactionId: string | null;
  } | null> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        detection_id: string;
        status: string;
        ledger_transaction_id: string | null;
      }>(
        `SELECT d.detection_id, d.status, d.ledger_transaction_id
           FROM deposit_detections d
          WHERE d.network = $1 AND d.network_txid = $2
          LIMIT 1`,
        [network, networkTxid]
      );
      const row = rows.rows[0];
      return row === undefined
        ? null
        : {
            detectionId: row.detection_id,
            status: row.status,
            ledgerTransactionId: row.ledger_transaction_id
          };
    });
  }

  async #findPendingDetections(
    network: ChainNetwork
  ): Promise<
    readonly {
      detectionId: string;
      networkTxid: string;
      addressText: string;
      confirmations: number;
    }[]
  > {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        detection_id: string;
        network_txid: string;
        address_text: string;
        confirmations: number;
      }>(
        `SELECT d.detection_id, d.network_txid, a.address_text,
                d.confirmations
           FROM deposit_detections d
           JOIN deposit_addresses a ON a.address_id = d.address_id
          WHERE d.network = $1
            AND d.status IN ('DETECTED', 'CONFIRMED')
          ORDER BY d.detected_at`,
        [network]
      );
      return rows.rows.map((row) => ({
        detectionId: row.detection_id,
        networkTxid: row.network_txid,
        addressText: row.address_text,
        confirmations: row.confirmations
      }));
    });
  }

  async #transition(
    detectionId: string,
    from: string,
    to: string
  ): Promise<boolean> {
    return this.#unitOfWork.execute((context) =>
      this.#detections.transitionStatus(
        context,
        detectionId,
        from as never,
        to as never
      )
    );
  }

  async #updateConfirmations(
    detectionId: string,
    confirmations: number
  ): Promise<void> {
    await this.#unitOfWork.execute((context) => {
      return context.executeSql(
        `UPDATE deposit_detections
            SET confirmations = $2, updated_at = clock_timestamp()
          WHERE detection_id = $1::uuid`,
        [detectionId, confirmations]
      );
    });
  }

  async #findConfirmedByNetwork(
    network: ChainNetwork
  ): Promise<readonly ConfirmedDetection[]> {
    return this.#unitOfWork.execute((context) =>
      this.#detections.findConfirmedDetections(context, network)
    );
  }
}
