import { randomUUID } from 'node:crypto';
import type {
  ChainNetwork,
  LedgerAccountId,
  Uid
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import { depositConfirmed } from '../../ledger/templates/posting-templates.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';

export interface DepositPostingResult {
  readonly posted: number;
  readonly skipped: number;
  readonly failed: number;
}

interface ConfirmedDetectionRow {
  readonly detectionId: string;
  readonly uid: string;
  readonly assetCode: string;
  readonly amount: string;
  readonly networkTxid: string;
  readonly ledgerTransactionId: string | null;
}

/**
 * Orchestrates the final step of the deposit pipeline: takes CONFIRMED
 * detections, opens user ledger accounts as needed, posts via the S3-6
 * depositConfirmed template through the S3-2 posting kernel, marks
 * detections POSTED with their ledger transaction reference, and enqueues
 * a deposit-confirmed Outbox notification.
 */
export class DepositPostingService {
  readonly #unitOfWork: UnitOfWork;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;

  constructor(
    unitOfWork: UnitOfWork,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
  }

  public async postConfirmedDeposits(
    network: ChainNetwork
  ): Promise<DepositPostingResult> {
    const confirmed = await this.#findConfirmed(network);
    let posted = 0;
    let skipped = 0;
    let failed = 0;
    for (const detection of confirmed) {
      if (detection.ledgerTransactionId !== null) {
        skipped += 1;
        continue;
      }
      try {
        await this.#postSingle(detection, network);
        posted += 1;
      } catch (error) {
            await this.#markFailed(detection.detectionId);
        failed += 1;
      }
    }
    return { posted, skipped, failed };
  }

  async #postSingle(
    detection: ConfirmedDetectionRow,
    network: ChainNetwork
  ): Promise<void> {
    const uid = detection.uid as Uid;
    const userAccountId = await this.#ensureUserAvailable(
      uid,
      detection.assetCode
    );
    const custodyAccountId = await this.#ensureCustody(detection.assetCode);
    // per-detection idempotency: a multi-output chain tx credits two
    // deposit addresses and must post once per detection, not once
    // per txid — a shared (network, txid) key silently dropped the
    // second user's funds with no alert
    const orderId = `${network}:${detection.networkTxid}:${detection.detectionId}`;
    const templateResult = depositConfirmed({
      custodyAccountId,
      userAvailableAccountId: userAccountId,
      amount: detection.amount,
      orderId
    });
    if (!templateResult.ok) {
      throw new Error(`TEMPLATE_FAILED: ${templateResult.reason}`);
    }
    const posting = await this.#poster.post(templateResult.command);
    await this.#markPosted(detection.detectionId, posting.transactionId);
    if (posting.posted) {
      await this.#enqueueNotification(
        uid,
        detection.assetCode,
        detection.amount,
        orderId
      );
    }
  }

  async #ensureUserAvailable(
    uid: Uid,
    assetCode: string
  ): Promise<LedgerAccountId> {
    return this.#unitOfWork.execute((context) =>
      this.#accounts
        .openUserAccount(context, {
          ownerUid: uid,
          assetCode,
          purpose: 'USER_AVAILABLE',
          idempotencyKey: `open:${uid}:${assetCode}`
        })
        .then((account) => account.accountId)
    );
  }

  async #ensureCustody(assetCode: string): Promise<LedgerAccountId> {
    const existing = await this.#findPlatformAccount(
      assetCode,
      'PLATFORM_CUSTODY'
    );
    if (existing !== null) return existing;
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ account_id: string }>(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES (NULL, $1, 'PLATFORM_CUSTODY')
         ON CONFLICT (owner_uid, asset_code, purpose) DO NOTHING
         RETURNING account_id`,
        [assetCode]
      );
      if (rows.rows.length === 1) {
        return rows.rows[0]!.account_id as LedgerAccountId;
      }
      const raced = await this.#findPlatformAccount(assetCode, 'PLATFORM_CUSTODY');
      if (raced === null) throw new Error('CUSTODY_ACCOUNT_UNAVAILABLE');
      return raced;
    });
  }

  async #findPlatformAccount(
    assetCode: string,
    purpose: string
  ): Promise<LedgerAccountId | null> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1 AND purpose = $2
          LIMIT 1`,
        [assetCode, purpose]
      );
      return (rows.rows[0]?.account_id as LedgerAccountId) ?? null;
    });
  }

  async #findConfirmed(
    network: ChainNetwork
  ): Promise<readonly ConfirmedDetectionRow[]> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        detection_id: string;
        uid: string;
        asset_code: string;
        amount: string;
        network_txid: string;
        ledger_transaction_id: string | null;
      }>(
        `SELECT d.detection_id, a.uid, a.asset_code,
                d.amount::text AS amount, d.network_txid,
                d.ledger_transaction_id
           FROM deposit_detections d
           JOIN deposit_addresses a ON a.address_id = d.address_id
          WHERE d.network = $1 AND d.status = 'CONFIRMED'
          ORDER BY d.detected_at`,
        [network]
      );
      return rows.rows.map((row) => ({
        detectionId: row.detection_id,
        uid: row.uid,
        assetCode: row.asset_code,
        amount: row.amount,
        networkTxid: row.network_txid,
        ledgerTransactionId: row.ledger_transaction_id
      }));
    });
  }

  async #markPosted(
    detectionId: string,
    ledgerTransactionId: string
  ): Promise<void> {
    await this.#unitOfWork.execute((context) =>
      context.executeSql(
        `UPDATE deposit_detections
            SET status = 'POSTED',
                ledger_transaction_id = $2::uuid,
                updated_at = clock_timestamp()
          WHERE detection_id = $1::uuid AND status = 'CONFIRMED'`,
        [detectionId, ledgerTransactionId]
      )
    );
  }

  async #markFailed(detectionId: string): Promise<void> {
    await this.#unitOfWork.execute((context) =>
      context.executeSql(
        `UPDATE deposit_detections
            SET status = 'FAILED_POST', updated_at = clock_timestamp()
          WHERE detection_id = $1::uuid AND status = 'CONFIRMED'`,
        [detectionId]
      )
    );
  }

  async #enqueueNotification(
    uid: Uid,
    assetCode: string,
    amount: string,
    orderId: string
  ): Promise<void> {
    const eventId = randomUUID();
    await this.#unitOfWork.execute((context) =>
      this.#outbox.enqueue(context, {
        id: eventId,
        topic: 'telegram.deposit-confirmed.v1',
        eventKey: `deposit-confirmed:${orderId}`,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        payload: {
          type: 'telegram.deposit-confirmed.v1',
          eventId,
          uid,
          assetCode,
          amount,
          orderId
        }
      })
    );
  }
}
