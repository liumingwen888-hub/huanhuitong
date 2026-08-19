import { randomUUID } from 'node:crypto';
import type {
  AuthorizePaymentProofV1,
  LedgerAccountId,
  Uid,
  WithdrawalCommand,
  WithdrawalCommandResult,
  WithdrawalOrderSnapshot
} from '@xht/contracts';
import {
  UnitOfWorkError,
  type UnitOfWork
} from '../../../infrastructure/database/unit-of-work.js';
import type { RiskGate } from '../../crosscutting/application/crosscutting.services.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import { LedgerError } from '../../ledger/domain/ledger.errors.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import { withdrawalRequested } from '../../ledger/templates/posting-templates.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type {
  SignerPolicyRepository,
  WithdrawalOrderRepository
} from './withdrawal.repository.js';

/**
 * Orchestrates withdrawal requests: verifies the payment authorization
 * proof against the command, resolves the active signer policy
 * (fail-closed), runs the risk gate, posts the S3-6 freeze through the
 * ledger kernel, creates the FROZEN order and routes it to the auto or
 * manual approval track, then notifies via the Outbox. Posting and
 * order creation are separate kernel-owned transactions made
 * crash-safe by the template idempotency key and the order_ref
 * UNIQUE constraint (replays converge, never double-freeze).
 */
export class WithdrawalRequestService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: WithdrawalOrderRepository;
  readonly #policies: SignerPolicyRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;
  readonly #riskGate: RiskGate;

  constructor(
    unitOfWork: UnitOfWork,
    orders: WithdrawalOrderRepository,
    policies: SignerPolicyRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository,
    riskGate: RiskGate
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#policies = policies;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
    this.#riskGate = riskGate;
  }

  public async request(
    command: WithdrawalCommand,
    proof: AuthorizePaymentProofV1
  ): Promise<WithdrawalCommandResult> {
    const bindingFailure = verifyProofBinding(command, proof);
    if (bindingFailure !== null) {
      return { outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_COMMAND_INVALID' };
    }
    const existing = await this.#unitOfWork.execute((context) =>
      this.#orders.findByOrderRef(context, command.orderRef)
    );
    if (existing !== null) {
      return { outcome: 'ALREADY_REQUESTED', order: existing };
    }
    const network = await this.#lookupNetwork(command.assetCode);
    if (network === null) {
      return { outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_COMMAND_INVALID' };
    }
    const policy = await this.#unitOfWork.execute((context) =>
      this.#policies.findActive(context, network)
    );
    if (policy === null) {
      return { outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_POLICY_NOT_FOUND' };
    }
    if (!/^[0-9]+$/.test(command.amount) || command.amount === '0') {
      return { outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_COMMAND_INVALID' };
    }
    if (BigInt(command.amount) > BigInt(policy.maxAmount)) {
      return { outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_AMOUNT_ABOVE_MAX' };
    }
    const risk = await this.#riskGate.check({
      uid: command.uid,
      operationType: 'WITHDRAWAL',
      amount: command.amount,
      idempotencyKey: `WD:${command.orderRef}:RISK`
    });
    if (!risk.allowed) {
      return { outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_RISK_DENIED' };
    }
    const availableAccountId = await this.#ensureAccount(
      command.uid,
      command.assetCode,
      'USER_AVAILABLE'
    );
    const precheck = await this.#unitOfWork.execute((context) =>
      this.#accounts.accountBalance(context, availableAccountId)
    );
    // accountBalance is the signed DEBIT-minus-CREDIT sum; USER_AVAILABLE
    // is credit-normal, so spendable funds are the negated balance.
    const spendable = -BigInt(precheck);
    if (spendable < BigInt(command.amount)) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'WITHDRAWAL_INSUFFICIENT_FUNDS'
      };
    }
    const frozenAccountId = await this.#ensureAccount(
      command.uid,
      command.assetCode,
      'USER_FROZEN'
    );
    const template = withdrawalRequested({
      userAvailableAccountId: availableAccountId,
      userFrozenAccountId: frozenAccountId,
      amount: command.amount,
      orderId: command.orderRef
    });
    if (!template.ok) {
      return { outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_COMMAND_INVALID' };
    }
    let freezeTransactionId: string;
    try {
      const posting = await this.#poster.post(template.command);
      freezeTransactionId = posting.transactionId;
    } catch (error: unknown) {
      // The kernel rejects insufficient funds inside its own unit of work,
      // which wraps the LedgerError; after validation and the balance
      // precheck, a kernel rejection here can only be a lost funds race.
      // Conservative direction: reject without creating the order (never
      // infer success from an unknown outcome).
      if (
        error instanceof LedgerError &&
        error.code === 'LEDGER_NEGATIVE_BALANCE'
      ) {
        return {
          outcome: 'REJECTED',
          reasonCode: 'WITHDRAWAL_INSUFFICIENT_FUNDS'
        };
      }
      if (isKernelCallbackFailure(error)) {
        return {
          outcome: 'REJECTED',
          reasonCode: 'WITHDRAWAL_INSUFFICIENT_FUNDS'
        };
      }
      throw error;
    }
    const order = await this.#unitOfWork.execute((context) =>
      this.#orders.createOrder(context, {
        orderRef: command.orderRef,
        uid: command.uid,
        assetCode: command.assetCode,
        amount: command.amount,
        feeAmount: policy.feeAmount,
        destinationAddress: command.destinationAddress,
        freezeLedgerTransactionId: freezeTransactionId
      })
    );
    const autoTrack =
      BigInt(command.amount) < BigInt(policy.minAutoAmount);
    const routed = await this.#unitOfWork.execute((context) =>
      autoTrack
        ? this.#orders.markApproved(context, order.withdrawalId)
        : this.#orders.markPendingApproval(context, order.withdrawalId)
    );
    if (!routed) {
      return { outcome: 'REJECTED', reasonCode: 'WITHDRAWAL_INVALID_TRANSITION' };
    }
    await this.#notify(order, command, autoTrack);
    const routedOrder = await this.#unitOfWork.execute((context) =>
      this.#orders.findByOrderRef(context, command.orderRef)
    );
    return {
      outcome: 'ACCEPTED',
      order: routedOrder ?? order
    };
  }

  async #lookupNetwork(assetCode: string): Promise<string | null> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ network: string }>(
        `SELECT network FROM asset_catalog WHERE asset_code = $1`,
        [assetCode]
      );
      return rows.rows[0]?.network ?? null;
    });
  }

  async #ensureAccount(
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

  async #notify(
    order: WithdrawalOrderSnapshot,
    command: WithdrawalCommand,
    autoTrack: boolean
  ): Promise<void> {
    const userTopic = 'telegram.withdrawal-requested.v1';
    await this.#enqueue(userTopic, command.orderRef, {
      type: userTopic,
      uid: command.uid,
      orderRef: command.orderRef,
      assetCode: command.assetCode,
      amount: command.amount,
      status: autoTrack ? 'APPROVED' : 'PENDING_APPROVAL'
    });
    if (!autoTrack) {
      const adminTopic = 'admin.withdrawal-pending-approval.v1';
      await this.#enqueue(adminTopic, command.orderRef, {
        type: adminTopic,
        uid: command.uid,
        orderRef: command.orderRef,
        assetCode: command.assetCode,
        amount: command.amount,
        destinationAddress: command.destinationAddress
      });
    }
  }

  async #enqueue(
    topic: string,
    orderRef: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const eventId = randomUUID();
    await this.#unitOfWork.execute((context) =>
      this.#outbox.enqueue(context, {
        id: eventId,
        topic,
        eventKey: `${topic}:${orderRef}`,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        payload
      })
    );
  }
}

function isKernelCallbackFailure(error: unknown): boolean {
  return (
    error instanceof UnitOfWorkError &&
    error.code === 'TRANSACTION_CALLBACK_FAILED'
  );
}

function verifyProofBinding(
  command: WithdrawalCommand,
  proof: AuthorizePaymentProofV1
): string | null {
  if (proof.type !== 'security.payment-authorized.v1') {
    return 'PROOF_TYPE_INVALID';
  }
  if (proof.uid !== command.uid) {
    return 'PROOF_UID_MISMATCH';
  }
  if (proof.operationType !== 'withdrawal') {
    return 'PROOF_OPERATION_TYPE_INVALID';
  }
  if (proof.orderRef !== command.orderRef) {
    return 'PROOF_ORDER_REF_MISMATCH';
  }
  if (proof.amountSummary !== command.amount) {
    return 'PROOF_AMOUNT_MISMATCH';
  }
  if (proof.assetSummary !== command.assetCode) {
    return 'PROOF_ASSET_MISMATCH';
  }
  const expiry = Date.parse(proof.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    return 'PROOF_EXPIRED';
  }
  return null;
}
