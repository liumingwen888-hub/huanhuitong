import { randomUUID } from 'node:crypto';
import type {
  LedgerAccountId,
  TransferOrderSnapshot,
  Uid
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import { internalTransfer } from '../../ledger/templates/posting-templates.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type {
  TransferOrderRepository
} from './transfer.repository.js';

export interface TransferCommand {
  readonly orderRef: string;
  readonly senderUid: Uid;
  readonly recipientUid: Uid;
  readonly assetCode: string;
  readonly amount: string;
}

export type TransferResult =
  | { readonly kind: 'executed'; readonly order: TransferOrderSnapshot }
  | { readonly kind: 'already_executed'; readonly order: TransferOrderSnapshot }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Orchestrates user-to-user internal transfers: validates via the
 * risk gate, opens ledger accounts as needed, posts through the S3-6
 * template and S3-2 kernel, marks the order EXECUTED, and notifies
 * both parties via the Outbox.
 */
export class TransferExecutionService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: TransferOrderRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;

  constructor(
    unitOfWork: UnitOfWork,
    orders: TransferOrderRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
  }

  public async execute(command: TransferCommand): Promise<TransferResult> {
    const existing = await this.#unitOfWork.execute((context) =>
      this.#orders.findByOrderRef(context, command.orderRef)
    );
    if (existing !== null && existing.status === 'EXECUTED') {
      return { kind: 'already_executed', order: existing };
    }
    const order = existing ??
      await this.#unitOfWork.execute((context) =>
        this.#orders.createOrder(context, {
          orderRef: command.orderRef,
          senderUid: command.senderUid,
          recipientUid: command.recipientUid,
          assetCode: command.assetCode,
          amount: command.amount,
          feeAmount: '0'
        })
      );
    try {
      const senderAccount = await this.#ensureAccount(
        command.senderUid,
        command.assetCode
      );
      const recipientAccount = await this.#ensureAccount(
        command.recipientUid,
        command.assetCode
      );
      const feeIncomeAccount = await this.#ensureFeeIncome(
        command.assetCode
      );
      const template = internalTransfer({
        senderAvailableAccountId: senderAccount,
        recipientAvailableAccountId: recipientAccount,
        feeIncomeAccountId: feeIncomeAccount,
        amount: command.amount,
        feeAmount: '0',
        orderId: command.orderRef
      });
      if (!template.ok) {
        throw new Error(template.reason);
      }
      const posting = await this.#poster.post(template.command);
      const marked = await this.#unitOfWork.execute((context) =>
        this.#orders.markExecuted(context, {
          transferId: order.transferId,
          ledgerTransactionId: posting.transactionId
        })
      );
      if (!marked) {
        return { kind: 'failed', reason: 'ORDER_STATE_CONFLICT' };
      }
      await this.#notifyBoth(command);
      const updated = await this.#unitOfWork.execute((context) =>
        this.#orders.findByOrderRef(context, command.orderRef)
      );
      return {
        kind: 'executed',
        order: updated ?? order
      };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      await this.#unitOfWork.execute((context) =>
        this.#orders.markFailed(context, {
          transferId: order.transferId,
          reason: reason.slice(0, 200)
        })
      );
      return { kind: 'failed', reason };
    }
  }

  async #ensureAccount(
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

  async #ensureFeeIncome(assetCode: string): Promise<LedgerAccountId> {
    const existing = await this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = 'FEE_INCOME' LIMIT 1`,
        [assetCode]
      );
      return rows.rows[0]?.account_id ?? null;
    });
    if (existing !== null) return existing as LedgerAccountId;
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ account_id: string }>(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES (NULL, $1, 'FEE_INCOME')
         ON CONFLICT (owner_uid, asset_code, purpose) DO NOTHING
         RETURNING account_id`,
        [assetCode]
      );
      if (rows.rows.length === 1) {
        return rows.rows[0]!.account_id as LedgerAccountId;
      }
      const raced = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = 'FEE_INCOME' LIMIT 1`,
        [assetCode]
      );
      return raced.rows[0]!.account_id as LedgerAccountId;
    });
  }

  async #notifyBoth(command: TransferCommand): Promise<void> {
    for (const [topic, uid] of [
      ['telegram.transfer-sent.v1', command.senderUid],
      ['telegram.transfer-received.v1', command.recipientUid]
    ] as const) {
      const eventId = randomUUID();
      await this.#unitOfWork.execute((context) =>
        this.#outbox.enqueue(context, {
          id: eventId,
          topic,
          eventKey: `${topic}:${command.orderRef}`,
          occurredAt: new Date().toISOString(),
          correlationId: randomUUID(),
          payload: {
            type: topic,
            eventId,
            uid,
            orderRef: command.orderRef,
            assetCode: command.assetCode,
            amount: command.amount
          }
        })
      );
    }
  }
}
