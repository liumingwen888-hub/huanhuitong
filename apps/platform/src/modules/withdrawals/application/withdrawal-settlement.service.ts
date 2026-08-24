import { randomUUID } from 'node:crypto';
import type {
  ChainNetwork,
  LedgerAccountId,
  Uid,
  WithdrawalContractErrorCode,
  WithdrawalOrderSnapshot,
  MetricsPort,
} from '@xht/contracts';
import { NOOP_METRICS } from '../../../infrastructure/telemetry/compose-metrics.js';
import {
  UnitOfWorkError,
  type UnitOfWork
} from '../../../infrastructure/database/unit-of-work.js';
import type {
  ConfigStore
} from '../../crosscutting/application/crosscutting.services.js';
import type {
  BroadcastStatus,
  TransactionBroadcasterPort
} from '../../deposits/domain/transaction-broadcaster.port.js';
import { LedgerError } from '../../ledger/domain/ledger.errors.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import {
  withdrawalFailed,
  withdrawalSucceeded
} from '../../ledger/templates/posting-templates.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { WithdrawalOrderRepository } from './withdrawal.repository.js';

export type WithdrawalSettlementResult =
  | { readonly outcome: 'CONFIRMED'; readonly order: WithdrawalOrderSnapshot }
  | { readonly outcome: 'NOT_READY'; readonly chainStatus: BroadcastStatus }
  | {
      readonly outcome: 'SETTLE_REJECTED';
      readonly reasonCode: WithdrawalContractErrorCode;
    }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: WithdrawalContractErrorCode;
    };

export type WithdrawalReleaseResult =
  | { readonly outcome: 'REFUNDED'; readonly order: WithdrawalOrderSnapshot }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: WithdrawalContractErrorCode;
    };

export type WithdrawalExpireResult =
  | { readonly outcome: 'EXPIRED'; readonly withdrawalIds: readonly string[] }
  | { readonly outcome: 'SKIPPED_NO_CONFIG' };

/**
 * Final settlement for withdrawals. Success re-queries the chain port
 * for an authoritative CONFIRMED before posting the S3-6 settlement
 * template; a fee the user cannot cover leaves the order in BROADCAST
 * (funds already left on chain — fail closed, never partial fees).
 * Release returns frozen funds to available for REJECTED / FAILED /
 * EXPIRED orders. The two closure paths are mutually exclusive by
 * template idempotency action and by V8 state CAS.
 */
export class WithdrawalSettlementService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: WithdrawalOrderRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #broadcaster: TransactionBroadcasterPort;
  readonly #outbox: OutboxRepository;
  readonly #config: ConfigStore;

  readonly #metrics: MetricsPort;

  constructor(
    unitOfWork: UnitOfWork,
    orders: WithdrawalOrderRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    broadcaster: TransactionBroadcasterPort,
    outbox: OutboxRepository,
    config: ConfigStore,
    metrics: MetricsPort = NOOP_METRICS
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#broadcaster = broadcaster;
    this.#outbox = outbox;
    this.#config = config;
    this.#metrics = metrics;
  }

  public async settleConfirmed(
    withdrawalId: string
  ): Promise<WithdrawalSettlementResult> {
    const order = await this.#load(withdrawalId);
    if (order === null) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_ORDER_NOT_FOUND' };
    }
    if (order.status !== 'BROADCAST' || order.broadcastTxid === null) {
      return {
        outcome: 'DENIED',
        reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
      };
    }
    const network = await this.#lookupNetwork(order.assetCode);
    if (network === null) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_POLICY_NOT_FOUND' };
    }
    // authoritative chain re-check: never trust a caller-provided flag
    const chainStatus = await this.#broadcaster.getStatus(
      network,
      order.broadcastTxid
    );
    if (chainStatus !== 'CONFIRMED') {
      return { outcome: 'NOT_READY', chainStatus };
    }
    const frozenAccountId = await this.#ensureUserAccount(
      order.uid,
      order.assetCode,
      'USER_FROZEN'
    );
    const availableAccountId = await this.#ensureUserAccount(
      order.uid,
      order.assetCode,
      'USER_AVAILABLE'
    );
    const custodyAccountId = await this.#ensurePlatformAccount(
      order.assetCode,
      'PLATFORM_CUSTODY'
    );
    const feeIncomeAccountId = await this.#ensurePlatformAccount(
      order.assetCode,
      'FEE_INCOME'
    );
    const template = withdrawalSucceeded({
      userAvailableAccountId: availableAccountId,
      userFrozenAccountId: frozenAccountId,
      custodyAccountId,
      feeIncomeAccountId,
      amount: order.amount,
      feeAmount: order.feeAmount,
      orderId: order.orderRef
    });
    if (!template.ok) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_COMMAND_INVALID' };
    }
    let settlementTransactionId: string;
    try {
      const posting = await this.#poster.post(template.command);
      settlementTransactionId = posting.transactionId;
    } catch (error: unknown) {
      if (
        (error instanceof LedgerError &&
          error.code === 'LEDGER_NEGATIVE_BALANCE') ||
        isWrappedCallbackFailure(error)
      ) {
        // fee cannot be covered: funds already left on chain, so the
        // order stays BROADCAST for operations — never partial fees
        return {
          outcome: 'SETTLE_REJECTED',
          reasonCode: 'WITHDRAWAL_INSUFFICIENT_FUNDS'
        };
      }
      throw error;
    }
    const confirmed = await this.#unitOfWork.execute((context) =>
      this.#orders.markConfirmed(context, {
        withdrawalId,
        settlementLedgerTransactionId: settlementTransactionId
      })
    );
    const current = await this.#reload(withdrawalId, order);
    if (!confirmed) {
      if (current.status === 'CONFIRMED') {
        return { outcome: 'CONFIRMED', order: current };
      }
      return {
        outcome: 'DENIED',
        reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
      };
    }
    this.#metrics.incrementCounter('withdrawal_settled_total', {
      domain: 'withdrawal', outcome: 'confirmed'
    });
    await this.#notifyUser('telegram.withdrawal-succeeded.v1', current);
    return { outcome: 'CONFIRMED', order: current };
  }

  public async release(
    withdrawalId: string
  ): Promise<WithdrawalReleaseResult> {
    const order = await this.#load(withdrawalId);
    if (order === null) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_ORDER_NOT_FOUND' };
    }
    if (
      order.status !== 'REJECTED' &&
      order.status !== 'FAILED' &&
      order.status !== 'EXPIRED'
    ) {
      return {
        outcome: 'DENIED',
        reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
      };
    }
    const frozenAccountId = await this.#ensureUserAccount(
      order.uid,
      order.assetCode,
      'USER_FROZEN'
    );
    const availableAccountId = await this.#ensureUserAccount(
      order.uid,
      order.assetCode,
      'USER_AVAILABLE'
    );
    const template = withdrawalFailed({
      userAvailableAccountId: availableAccountId,
      userFrozenAccountId: frozenAccountId,
      amount: order.amount,
      orderId: order.orderRef
    });
    if (!template.ok) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_COMMAND_INVALID' };
    }
    const posting = await this.#poster.post(template.command);
    const refunded = await this.#unitOfWork.execute((context) =>
      this.#orders.markRefunded(context, {
        withdrawalId,
        settlementLedgerTransactionId: posting.transactionId
      })
    );
    const current = await this.#reload(withdrawalId, order);
    if (!refunded) {
      if (current.status === 'REFUNDED') {
        return { outcome: 'REFUNDED', order: current };
      }
      return {
        outcome: 'DENIED',
        reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
      };
    }
    await this.#notifyUser('telegram.withdrawal-refunded.v1', current);
    return { outcome: 'REFUNDED', order: current };
  }

  public async expireStalePending(
    limit: number
  ): Promise<WithdrawalExpireResult> {
    let ttlSeconds: number | null = null;
    try {
      const config = await this.#config.current('withdrawal.approval');
      const raw = (config.payload as {
        pendingTtlSeconds?: unknown;
      }).pendingTtlSeconds;
      if (
        typeof raw === 'number' &&
        Number.isInteger(raw) &&
        raw > 0
      ) {
        ttlSeconds = raw;
      }
    } catch {
      ttlSeconds = null;
    }
    if (ttlSeconds === null) {
      // expiry moves money: without an authorized configuration no
      // order is ever expired
      return { outcome: 'SKIPPED_NO_CONFIG' };
    }
    const staleBefore = new Date(Date.now() - ttlSeconds * 1000);
    const stale = await this.#unitOfWork.execute((context) =>
      this.#orders.findExpirable(context, { staleBefore, limit })
    );
    const expired: string[] = [];
    for (const order of stale) {
      const marked = await this.#unitOfWork.execute((context) =>
        this.#orders.markExpired(context, order.withdrawalId)
      );
      if (marked) {
        expired.push(order.withdrawalId);
      }
    }
    return { outcome: 'EXPIRED', withdrawalIds: expired };
  }

  async #load(
    withdrawalId: string
  ): Promise<WithdrawalOrderSnapshot | null> {
    return this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, withdrawalId)
    );
  }

  async #reload(
    withdrawalId: string,
    fallback: WithdrawalOrderSnapshot
  ): Promise<WithdrawalOrderSnapshot> {
    return (await this.#load(withdrawalId)) ?? fallback;
  }

  async #lookupNetwork(assetCode: string): Promise<ChainNetwork | null> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ network: string }>(
        `SELECT network FROM asset_catalog WHERE asset_code = $1`,
        [assetCode]
      );
      const network = rows.rows[0]?.network;
      return network === undefined ? null : (network as ChainNetwork);
    });
  }

  async #ensureUserAccount(
    uid: Uid,
    assetCode: string,
    purpose: 'USER_AVAILABLE' | 'USER_FROZEN'
  ): Promise<LedgerAccountId> {
    return this.#unitOfWork.execute((context) =>
      this.#accounts
        .openUserAccount(context, {
          ownerUid: uid,
          assetCode,
          purpose,
          idempotencyKey: `open:${uid}:${assetCode}:${purpose}`
        })
        .then((account) => account.accountId)
    );
  }

  async #ensurePlatformAccount(
    assetCode: string,
    purpose: 'PLATFORM_CUSTODY' | 'FEE_INCOME'
  ): Promise<LedgerAccountId> {
    // owner_uid is NULL here and plain UNIQUE indexes never collide on
    // NULL, so ON CONFLICT DO NOTHING would insert a duplicate row on
    // every call — select first, insert with the conflict clause only
    // as a race backstop, then re-select.
    return this.#unitOfWork.execute(async (context) => {
      const existing = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = $2 LIMIT 1`,
        [assetCode, purpose]
      );
      if (existing.rows.length === 1) {
        return existing.rows[0]!.account_id as LedgerAccountId;
      }
      await context.executeSql(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES (NULL, $1, $2)
         ON CONFLICT (owner_uid, asset_code, purpose) DO NOTHING`,
        [assetCode, purpose]
      );
      const settled = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = $2 LIMIT 1`,
        [assetCode, purpose]
      );
      return settled.rows[0]!.account_id as LedgerAccountId;
    });
  }

  async #notifyUser(
    topic: string,
    order: WithdrawalOrderSnapshot
  ): Promise<void> {
    const eventId = randomUUID();
    await this.#unitOfWork.execute((context) =>
      this.#outbox.enqueue(context, {
        id: eventId,
        topic,
        eventKey: `${topic}:${order.orderRef}`,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        payload: {
          type: topic,
          uid: order.uid,
          orderRef: order.orderRef,
          assetCode: order.assetCode,
          amount: order.amount,
          status: order.status
        }
      })
    );
  }
}

function isWrappedCallbackFailure(error: unknown): boolean {
  return (
    error instanceof UnitOfWorkError &&
    error.code === 'TRANSACTION_CALLBACK_FAILED'
  );
}
