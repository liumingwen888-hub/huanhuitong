import { randomUUID } from 'node:crypto';
import type {
  ChainNetwork,
  SafeLogger,
  WithdrawalContractErrorCode,
  WithdrawalOrderSnapshot
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type {
  BroadcastStatus,
  TransactionBroadcasterPort
} from '../../deposits/domain/transaction-broadcaster.port.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { WithdrawalSigningService } from './withdrawal-signing.service.js';
import type {
  SignerPolicyRepository,
  WithdrawalOrderRepository
} from './withdrawal.repository.js';

export type WithdrawalBroadcastResult =
  | {
      readonly outcome: 'BROADCAST';
      readonly order: WithdrawalOrderSnapshot;
      readonly broadcastTxid: string;
    }
  | { readonly outcome: 'UNKNOWN' }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: WithdrawalContractErrorCode;
    };

export type WithdrawalChainCheckResult =
  | {
      readonly outcome: 'CHAIN_STATUS';
      readonly chainStatus: BroadcastStatus;
      readonly readyForSettlement: boolean;
      readonly order: WithdrawalOrderSnapshot;
    }
  | { readonly outcome: 'FAILED_MARKED'; readonly order: WithdrawalOrderSnapshot }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: WithdrawalContractErrorCode;
    };

/**
 * Broadcasts signed withdrawals and monitors their on-chain status.
 * An unknown broadcast outcome (throw/timeout) performs zero state
 * writes: the order stays SIGNING and a retry replays the same
 * deterministic transaction, so double payment is structurally
 * impossible. Only an authoritative FAILED from the chain port moves
 * the order to FAILED.
 */
export class WithdrawalBroadcastService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: WithdrawalOrderRepository;
  readonly #policies: SignerPolicyRepository;
  readonly #signing: WithdrawalSigningService;
  readonly #broadcaster: TransactionBroadcasterPort;
  readonly #outbox: OutboxRepository;
  readonly #logger: SafeLogger | null;

  constructor(
    unitOfWork: UnitOfWork,
    orders: WithdrawalOrderRepository,
    policies: SignerPolicyRepository,
    signing: WithdrawalSigningService,
    broadcaster: TransactionBroadcasterPort,
    outbox: OutboxRepository,
    logger: SafeLogger | null = null
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#policies = policies;
    this.#signing = signing;
    this.#broadcaster = broadcaster;
    this.#outbox = outbox;
    this.#logger = logger;
  }

  public async broadcast(
    withdrawalId: string
  ): Promise<WithdrawalBroadcastResult> {
    const order = await this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, withdrawalId)
    );
    if (order === null) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_ORDER_NOT_FOUND' };
    }
    if (order.status !== 'APPROVED' && order.status !== 'SIGNING') {
      return {
        outcome: 'DENIED',
        reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
      };
    }
    const network = await this.#lookupNetwork(order.assetCode);
    const policy = network === null
      ? null
      : await this.#unitOfWork.execute((context) =>
          this.#policies.findActive(context, network)
        );
    if (network === null || policy === null) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_POLICY_NOT_FOUND' };
    }
    const signed = await this.#signing.signForBroadcast(withdrawalId);
    if (signed.outcome !== 'SIGNED') {
      return { outcome: 'DENIED', reasonCode: signed.reasonCode };
    }
    let txid: string;
    try {
      const result = await this.#broadcaster.broadcast({
        network,
        fromAddress: policy.hotWalletAddress,
        toAddress: order.destinationAddress,
        amount: order.amount,
        feeRate: order.feeAmount
      });
      txid = result.broadcastTxid;
    } catch (error: unknown) {
      // UNKNOWN outcome: no state write, no failure inference, no
      // notification — the order stays SIGNING and retries safely.
      this.#logger?.info('withdrawal_broadcast_unknown', {
        route: 'withdrawals',
        outcome: 'unknown'
      });
      return { outcome: 'UNKNOWN' };
    }
    const marked = await this.#unitOfWork.execute((context) =>
      this.#orders.markBroadcast(context, { withdrawalId, broadcastTxid: txid })
    );
    const current = await this.#reload(withdrawalId, order);
    if (!marked) {
      if (
        current.status === 'BROADCAST' &&
        current.broadcastTxid === txid
      ) {
        return {
          outcome: 'BROADCAST',
          order: current,
          broadcastTxid: txid
        };
      }
      return {
        outcome: 'DENIED',
        reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
      };
    }
    await this.#notifyUser('telegram.withdrawal-broadcast.v1', current);
    return { outcome: 'BROADCAST', order: current, broadcastTxid: txid };
  }

  public async checkOnChainStatus(
    withdrawalId: string
  ): Promise<WithdrawalChainCheckResult> {
    const order = await this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, withdrawalId)
    );
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
    const chainStatus = await this.#broadcaster.getStatus(
      network,
      order.broadcastTxid
    );
    if (chainStatus === 'FAILED') {
      const failed = await this.#unitOfWork.execute((context) =>
        this.#orders.markFailed(context, {
          withdrawalId,
          reason: 'CHAIN_REPORTED_FAILED'
        })
      );
      const current = await this.#reload(withdrawalId, order);
      if (!failed) {
        return {
          outcome: 'DENIED',
          reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
        };
      }
      await this.#notifyUser('telegram.withdrawal-failed.v1', current);
      return { outcome: 'FAILED_MARKED', order: current };
    }
    return {
      outcome: 'CHAIN_STATUS',
      chainStatus,
      readyForSettlement: chainStatus === 'CONFIRMED',
      order
    };
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

  async #reload(
    withdrawalId: string,
    fallback: WithdrawalOrderSnapshot
  ): Promise<WithdrawalOrderSnapshot> {
    return (await this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, withdrawalId)
    )) ?? fallback;
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
          status: order.status,
          broadcastTxid: order.broadcastTxid
        }
      })
    );
  }
}
