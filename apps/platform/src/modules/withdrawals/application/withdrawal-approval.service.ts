import { randomUUID } from 'node:crypto';
import type {
  Uid,
  WithdrawalApprovalDecision,
  WithdrawalContractErrorCode,
  WithdrawalOrderSnapshot
} from '@xht/contracts';
import {
  UnitOfWorkError,
  type UnitOfWork
} from '../../../infrastructure/database/unit-of-work.js';
import type {
  AdminAuthorizer,
  ConfigStore
} from '../../crosscutting/application/crosscutting.services.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type {
  WithdrawalApprovalRepository,
  WithdrawalOrderRepository
} from './withdrawal.repository.js';

export interface ApprovalDecisionCommand {
  readonly withdrawalId: string;
  readonly adminId: string;
  readonly decision: WithdrawalApprovalDecision;
  readonly reason?: string;
}

export type ApprovalDecisionResult =
  | { readonly outcome: 'APPROVED'; readonly order: WithdrawalOrderSnapshot }
  | {
      readonly outcome: 'AWAITING_SECOND_APPROVAL';
      readonly order: WithdrawalOrderSnapshot;
    }
  | { readonly outcome: 'REJECTED'; readonly order: WithdrawalOrderSnapshot }
  | { readonly outcome: 'SUPERSEDED'; readonly order: WithdrawalOrderSnapshot }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: WithdrawalContractErrorCode;
    };

const REQUIRED_ROLE = 'FINANCE_OFFICER';
const APPROVAL_CONFIG_KEY = 'withdrawal.approval';

/**
 * Maker-Checker approval for manual-track withdrawal orders: verifies the
 * admin holds the required active role, records the decision exactly once
 * per admin (UNIQUE-enforced), applies amount-graded approval thresholds
 * (missing configuration fails closed to dual approval), and moves the
 * order through CAS transitions so concurrent decisions converge to
 * exactly one state change.
 */
export class WithdrawalApprovalService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: WithdrawalOrderRepository;
  readonly #approvals: WithdrawalApprovalRepository;
  readonly #authorizer: AdminAuthorizer;
  readonly #config: ConfigStore;
  readonly #outbox: OutboxRepository;

  constructor(
    unitOfWork: UnitOfWork,
    orders: WithdrawalOrderRepository,
    approvals: WithdrawalApprovalRepository,
    authorizer: AdminAuthorizer,
    config: ConfigStore,
    outbox: OutboxRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#approvals = approvals;
    this.#authorizer = authorizer;
    this.#config = config;
    this.#outbox = outbox;
  }

  public async decide(
    command: ApprovalDecisionCommand
  ): Promise<ApprovalDecisionResult> {
    const authorized = await this.#authorizer.isAuthorized(
      command.adminId,
      REQUIRED_ROLE
    );
    if (!authorized) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_UNAUTHORIZED' };
    }
    if (command.decision === 'REJECT' && !command.reason) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_COMMAND_INVALID' };
    }
    const order = await this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, command.withdrawalId)
    );
    if (order === null) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_ORDER_NOT_FOUND' };
    }
    if (order.status !== 'PENDING_APPROVAL') {
      return {
        outcome: 'DENIED',
        reasonCode: 'WITHDRAWAL_NOT_PENDING_APPROVAL'
      };
    }
    const priorVotes = await this.#unitOfWork.execute((context) =>
      this.#approvals.findByWithdrawal(context, command.withdrawalId)
    );
    if (priorVotes.some((vote) => vote.adminId === command.adminId)) {
      return {
        outcome: 'DENIED',
        reasonCode: 'WITHDRAWAL_DUPLICATE_APPROVAL'
      };
    }
    try {
      await this.#unitOfWork.execute((context) =>
        this.#approvals.record(context, {
          withdrawalId: command.withdrawalId,
          adminId: command.adminId,
          level: 1,
          decision: command.decision,
          reason: command.reason ?? null
        })
      );
    } catch (error: unknown) {
      // After the pre-check above, a wrapped callback failure here can
      // only be the UNIQUE race of the same admin voting twice.
      if (isWrappedCallbackFailure(error)) {
        return {
          outcome: 'DENIED',
          reasonCode: 'WITHDRAWAL_DUPLICATE_APPROVAL'
        };
      }
      throw error;
    }
    if (command.decision === 'REJECT') {
      const rejected = await this.#unitOfWork.execute((context) =>
        this.#orders.markRejected(context, {
          withdrawalId: command.withdrawalId,
          approverAdminId: command.adminId,
          reason: command.reason ?? 'REJECTED_BY_APPROVER'
        })
      );
      const current = await this.#reload(command.withdrawalId, order);
      if (!rejected) {
        return { outcome: 'SUPERSEDED', order: current };
      }
      await this.#notifyUser('telegram.withdrawal-rejected.v1', current);
      return { outcome: 'REJECTED', order: current };
    }
    const requiredVotes = await this.#requiredVotesFor(order);
    const approvedCount = await this.#unitOfWork.execute((context) =>
      this.#approvals.countApproved(context, command.withdrawalId)
    );
    if (approvedCount < requiredVotes) {
      await this.#notifyAdmins(order, command.adminId);
      return { outcome: 'AWAITING_SECOND_APPROVAL', order };
    }
    const approved = await this.#unitOfWork.execute((context) =>
      this.#orders.markApproved(context, command.withdrawalId)
    );
    const current = await this.#reload(command.withdrawalId, order);
    if (!approved) {
      return { outcome: 'SUPERSEDED', order: current };
    }
    await this.#notifyUser('telegram.withdrawal-approved.v1', current);
    return { outcome: 'APPROVED', order: current };
  }

  async #requiredVotesFor(order: WithdrawalOrderSnapshot): Promise<number> {
    let dualThreshold = 0n;
    try {
      const config = await this.#config.current(APPROVAL_CONFIG_KEY);
      const raw = (config.payload as {
        dualApprovalThreshold?: unknown;
      }).dualApprovalThreshold;
      if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) {
        dualThreshold = BigInt(raw);
      }
    } catch {
      // fail-closed: missing or unreadable configuration means every
      // manual-track order requires dual approval
    }
    return BigInt(order.amount) >= dualThreshold ? 2 : 1;
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
    await this.#enqueue(topic, order.orderRef, {
      type: topic,
      uid: order.uid,
      orderRef: order.orderRef,
      assetCode: order.assetCode,
      amount: order.amount,
      status: order.status
    });
  }

  async #notifyAdmins(
    order: WithdrawalOrderSnapshot,
    decidingAdminId: string
  ): Promise<void> {
    const topic = 'admin.withdrawal-approval-recorded.v1';
    await this.#enqueue(topic, `${order.orderRef}:${decidingAdminId}`, {
      type: topic,
      uid: order.uid as Uid,
      orderRef: order.orderRef,
      assetCode: order.assetCode,
      amount: order.amount,
      decidedBy: decidingAdminId,
      awaiting: 'SECOND_APPROVAL'
    });
  }

  async #enqueue(
    topic: string,
    eventKey: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const eventId = randomUUID();
    await this.#unitOfWork.execute((context) =>
      this.#outbox.enqueue(context, {
        id: eventId,
        topic,
        eventKey: `${topic}:${eventKey}`,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        payload
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
