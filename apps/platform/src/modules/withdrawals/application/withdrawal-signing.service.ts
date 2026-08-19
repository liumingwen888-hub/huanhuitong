import type {
  ChainNetwork,
  WithdrawalContractErrorCode,
  WithdrawalOrderSnapshot
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { canonicalDigest } from '../../signer/domain/canonical-digest.js';
import type {
  TransactionSignerPort,
  WithdrawalSigningRequest
} from '../../signer/domain/transaction-signer.port.js';
import type {
  SignerPolicyRepository,
  WithdrawalOrderRepository
} from './withdrawal.repository.js';

export type WithdrawalSigningResult =
  | {
      readonly outcome: 'SIGNED';
      readonly order: WithdrawalOrderSnapshot;
      readonly signing: {
        readonly request: WithdrawalSigningRequest;
        readonly signatureRef: string;
        readonly algorithm: string;
      };
    }
  | {
      readonly outcome: 'DENIED';
      readonly reasonCode: WithdrawalContractErrorCode;
    };

/**
 * Orchestrates signing for approved withdrawals: APPROVED orders are
 * CAS-moved to SIGNING, a deterministic canonical request is assembled
 * (order facts plus the active policy's hot wallet) and handed to the
 * signer port. SIGNING orders may be re-signed idempotently after a
 * crash; signatures are not persisted — determinism plus broadcast
 * idempotency make re-signing safe.
 */
export class WithdrawalSigningService {
  readonly #unitOfWork: UnitOfWork;
  readonly #orders: WithdrawalOrderRepository;
  readonly #policies: SignerPolicyRepository;
  readonly #signer: TransactionSignerPort;

  constructor(
    unitOfWork: UnitOfWork,
    orders: WithdrawalOrderRepository,
    policies: SignerPolicyRepository,
    signer: TransactionSignerPort
  ) {
    this.#unitOfWork = unitOfWork;
    this.#orders = orders;
    this.#policies = policies;
    this.#signer = signer;
  }

  public async signForBroadcast(
    withdrawalId: string
  ): Promise<WithdrawalSigningResult> {
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
    if (network === null) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_POLICY_NOT_FOUND' };
    }
    const policy = await this.#unitOfWork.execute((context) =>
      this.#policies.findActive(context, network)
    );
    if (policy === null) {
      return { outcome: 'DENIED', reasonCode: 'WITHDRAWAL_POLICY_NOT_FOUND' };
    }
    if (order.status === 'APPROVED') {
      const moved = await this.#unitOfWork.execute((context) =>
        this.#orders.markSigning(context, withdrawalId)
      );
      if (!moved) {
        return {
          outcome: 'DENIED',
          reasonCode: 'WITHDRAWAL_INVALID_TRANSITION'
        };
      }
    }
    // order facts (amount, destination, fee) bind the signature;
    // network and hot wallet come from the active operational policy
    const request: WithdrawalSigningRequest = {
      withdrawalId: order.withdrawalId,
      orderRef: order.orderRef,
      network,
      fromAddress: policy.hotWalletAddress,
      toAddress: order.destinationAddress,
      amount: order.amount,
      feeAmount: order.feeAmount,
      canonicalDigest: canonicalDigest({
        withdrawalId: order.withdrawalId,
        orderRef: order.orderRef,
        network,
        fromAddress: policy.hotWalletAddress,
        toAddress: order.destinationAddress,
        amount: order.amount,
        feeAmount: order.feeAmount
      })
    };
    const signed = await this.#signer.sign(request);
    const current = await this.#unitOfWork.execute((context) =>
      this.#orders.findById(context, withdrawalId)
    );
    return {
      outcome: 'SIGNED',
      order: current ?? order,
      signing: {
        request,
        signatureRef: signed.signatureRef,
        algorithm: signed.algorithm
      }
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
}
