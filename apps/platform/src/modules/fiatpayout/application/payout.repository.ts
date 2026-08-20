import type {
  PayoutCapabilitySnapshot,
  PayoutOrderSnapshot,
  ProviderConfigSnapshot
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export interface CreatePayoutOrderInput {
  readonly orderRef: string;
  readonly uid: string;
  readonly sourceAssetCode: string;
  readonly route: string;
  readonly amount: string;
  readonly feeAmount: string;
  readonly beneficiaryRef: string;
  readonly beneficiaryDigest: string;
  readonly providerId: string;
  readonly providerConfigVersion: number;
  readonly providerIdempotencyKey: string;
  readonly freezeLedgerTransactionId: string;
}

export interface PayoutOrderRepository {
  createOrder(
    context: TransactionContext,
    input: CreatePayoutOrderInput
  ): Promise<PayoutOrderSnapshot>;
  findByOrderRef(
    context: TransactionContext,
    orderRef: string
  ): Promise<PayoutOrderSnapshot | null>;
  findById(
    context: TransactionContext,
    payoutOrderId: string
  ): Promise<PayoutOrderSnapshot | null>;
  findByProviderKey(
    context: TransactionContext,
    providerIdempotencyKey: string
  ): Promise<PayoutOrderSnapshot | null>;
  findUncertain(
    context: TransactionContext,
    limit: number
  ): Promise<readonly PayoutOrderSnapshot[]>;
  markSubmitting(
    context: TransactionContext,
    payoutOrderId: string
  ): Promise<boolean>;
  markAccepted(
    context: TransactionContext,
    payoutOrderId: string
  ): Promise<boolean>;
  markFailed(
    context: TransactionContext,
    input: { readonly payoutOrderId: string; readonly reason: string }
  ): Promise<boolean>;
  markSucceeded(
    context: TransactionContext,
    input: {
      readonly payoutOrderId: string;
      readonly settlementLedgerTransactionId: string;
    }
  ): Promise<boolean>;
  markRefunded(
    context: TransactionContext,
    input: {
      readonly payoutOrderId: string;
      readonly settlementLedgerTransactionId: string;
    }
  ): Promise<boolean>;
  markReversed(
    context: TransactionContext,
    input: {
      readonly payoutOrderId: string;
      readonly settlementLedgerTransactionId: string;
    }
  ): Promise<boolean>;
}

export interface ProviderConfigRepository {
  listCapabilities(
    context: TransactionContext
  ): Promise<readonly PayoutCapabilitySnapshot[]>;
  findLatestByProvider(
    context: TransactionContext,
    providerId: string
  ): Promise<ProviderConfigSnapshot | null>;
  findLatestByRoute(
    context: TransactionContext,
    route: string
  ): Promise<ProviderConfigSnapshot | null>;
  insert(
    context: TransactionContext,
    input: {
      readonly providerId: string;
      readonly configVersion: number;
      readonly providerName: string;
      readonly route: string;
      readonly sourceAssetCode: string;
      readonly fixedFee: string;
      readonly minAmount: string;
      readonly maxAmount: string;
      readonly callbackSecretRef: string;
    }
  ): Promise<ProviderConfigSnapshot>;
}
