import { createHash, randomUUID } from 'node:crypto';
import type {
  AuthorizePaymentProofV1,
  LedgerAccountId,
  PayoutCommand,
  PayoutCommandResult,
  PayoutContractErrorCode,
  PayoutOrderSnapshot,
  Uid
} from '@xht/contracts';
import {
  UnitOfWorkError,
  type UnitOfWork
} from '../../../infrastructure/database/unit-of-work.js';
import type { RiskGate } from '../../crosscutting/application/crosscutting.services.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import { LedgerError } from '../../ledger/domain/ledger.errors.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import { fiatPayoutRequested } from '../../ledger/templates/posting-templates.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type {
  PayoutOrderRepository,
  ProviderConfigRepository
} from './payout.repository.js';

const BENEFICIARY_REF_PATTERN = /^[A-Za-z0-9-]{4,64}$/u;

/**
 * Orchestrates payout requests: verifies the payment proof against
 * the command (assetSummary binds the ROUTE — the source asset is
 * derived from provider config and never user-chosen), enforces
 * config limits and the risk gate, freezes the source funds through
 * the kernel, and creates the order with a server-computed
 * beneficiary digest and a deterministically derived provider
 * idempotency key so retries can never double-pay.
 */
export class PayoutRequestService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: PayoutOrderRepository;
  readonly #configs: ProviderConfigRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;
  readonly #riskGate: RiskGate;

  constructor(
    unitOfWork: UnitOfWork,
    orders: PayoutOrderRepository,
    configs: ProviderConfigRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository,
    riskGate: RiskGate
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#configs = configs;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
    this.#riskGate = riskGate;
  }

  public async request(
    command: PayoutCommand,
    proof: AuthorizePaymentProofV1
  ): Promise<PayoutCommandResult> {
    const bindingFailure = verifyProofBinding(command, proof);
    if (bindingFailure !== null) {
      return { outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID' };
    }
    if (!BENEFICIARY_REF_PATTERN.test(command.beneficiaryRef)) {
      return { outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID' };
    }
    const existing = await this.#unitOfWork.execute((context) =>
      this.#orders.findByOrderRef(context, command.orderRef)
    );
    if (existing !== null) {
      return { outcome: 'ALREADY_REQUESTED', order: existing };
    }
    const config = await this.#unitOfWork.execute((context) =>
      this.#configs.findLatestByRoute(context, command.route)
    );
    if (config === null) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND'
      };
    }
    if (!/^[0-9]{1,18}$/u.test(command.amount) || command.amount === '0') {
      return { outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID' };
    }
    if (
      BigInt(command.amount) < BigInt(config.minAmount) ||
      BigInt(command.amount) > BigInt(config.maxAmount)
    ) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_AMOUNT_OUT_OF_RANGE'
      };
    }
    const risk = await this.#riskGate.check({
      uid: command.uid,
      operationType: 'FIAT_PAYOUT',
      amount: command.amount,
      idempotencyKey: `PO:${command.orderRef}:RISK`
    });
    if (!risk.allowed) {
      return { outcome: 'REJECTED', reasonCode: 'PAYOUT_RISK_DENIED' };
    }
    const availableAccountId = await this.#ensureAccount(
      command.uid,
      config.sourceAssetCode,
      'USER_AVAILABLE'
    );
    const precheck = await this.#unitOfWork.execute((context) =>
      this.#accounts.accountBalance(context, availableAccountId)
    );
    // credit-normal: spendable funds are the negated signed balance
    if (-BigInt(precheck) < BigInt(command.amount)) {
      return {
        outcome: 'REJECTED',
        reasonCode: 'PAYOUT_INSUFFICIENT_FUNDS'
      };
    }
    const frozenAccountId = await this.#ensureAccount(
      command.uid,
      config.sourceAssetCode,
      'USER_FROZEN'
    );
    const template = fiatPayoutRequested({
      userAvailableAccountId: availableAccountId,
      userFrozenAccountId: frozenAccountId,
      amount: command.amount,
      orderId: command.orderRef
    });
    if (!template.ok) {
      return { outcome: 'REJECTED', reasonCode: 'PAYOUT_COMMAND_INVALID' };
    }
    let freezeTransactionId: string;
    try {
      const posting = await this.#poster.post(template.command);
      freezeTransactionId = posting.transactionId;
    } catch (error: unknown) {
      if (
        (error instanceof LedgerError &&
          error.code === 'LEDGER_NEGATIVE_BALANCE') ||
        (error instanceof UnitOfWorkError &&
          error.code === 'TRANSACTION_CALLBACK_FAILED')
      ) {
        return {
          outcome: 'REJECTED',
          reasonCode: 'PAYOUT_INSUFFICIENT_FUNDS'
        };
      }
      throw error;
    }
    const order = await this.#unitOfWork.execute((context) =>
      this.#orders.createOrder(context, {
        orderRef: command.orderRef,
        uid: command.uid,
        sourceAssetCode: config.sourceAssetCode,
        route: command.route,
        amount: command.amount,
        feeAmount: config.fixedFee,
        beneficiaryRef: command.beneficiaryRef,
        beneficiaryDigest: `sha256:${createHash('sha256')
          .update(command.beneficiaryRef)
          .digest('base64url')}`,
        providerId: config.providerId,
        providerConfigVersion: config.configVersion,
        providerIdempotencyKey: `PPO:${config.providerId}:${command.orderRef}`,
        freezeLedgerTransactionId: freezeTransactionId
      })
    );
    await this.#notify(order);
    return { outcome: 'ACCEPTED', order };
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

  async #notify(order: PayoutOrderSnapshot): Promise<void> {
    const topic = 'telegram.payout-requested.v1';
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
          route: order.route,
          sourceAssetCode: order.sourceAssetCode,
          amount: order.amount,
          status: order.status
        }
      })
    );
  }
}

function verifyProofBinding(
  command: PayoutCommand,
  proof: AuthorizePaymentProofV1
): string | null {
  if (proof.type !== 'security.payment-authorized.v1') {
    return 'PROOF_TYPE_INVALID';
  }
  if (proof.uid !== command.uid) {
    return 'PROOF_UID_MISMATCH';
  }
  if (proof.operationType !== 'fiat-payout') {
    return 'PROOF_OPERATION_TYPE_INVALID';
  }
  if (proof.orderRef !== command.orderRef) {
    return 'PROOF_ORDER_REF_MISMATCH';
  }
  if (proof.amountSummary !== command.amount) {
    return 'PROOF_AMOUNT_MISMATCH';
  }
  if (proof.assetSummary !== command.route) {
    return 'PROOF_ROUTE_MISMATCH';
  }
  const expiry = Date.parse(proof.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    return 'PROOF_EXPIRED';
  }
  return null;
}
