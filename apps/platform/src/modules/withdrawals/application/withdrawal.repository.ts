import type {
  SignerPolicySnapshot,
  Uid,
  WithdrawalApprovalDecision,
  WithdrawalApprovalSnapshot,
  WithdrawalOrderSnapshot
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export interface CreateWithdrawalOrderInput {
  readonly orderRef: string;
  readonly uid: Uid;
  readonly assetCode: string;
  readonly amount: string;
  readonly feeAmount: string;
  readonly destinationAddress: string;
  readonly freezeLedgerTransactionId: string;
}

export interface RecordApprovalInput {
  readonly withdrawalId: string;
  readonly adminId: string;
  readonly level: number;
  readonly decision: WithdrawalApprovalDecision;
  readonly reason?: string | null;
}

export interface InsertSignerPolicyInput {
  readonly policyVersion: number;
  readonly network: string;
  readonly hotWalletAddress: string;
  readonly feeAmount: string;
  readonly minAutoAmount: string;
  readonly maxAmount: string;
}

export interface WithdrawalOrderRepository {
  createOrder(
    context: TransactionContext,
    input: CreateWithdrawalOrderInput
  ): Promise<WithdrawalOrderSnapshot>;
  findByOrderRef(
    context: TransactionContext,
    orderRef: string
  ): Promise<WithdrawalOrderSnapshot | null>;
  findById(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<WithdrawalOrderSnapshot | null>;
  markPendingApproval(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<boolean>;
  markApproved(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<boolean>;
  markSigning(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<boolean>;
  markBroadcast(
    context: TransactionContext,
    input: { withdrawalId: string; broadcastTxid: string }
  ): Promise<boolean>;
  markConfirmed(
    context: TransactionContext,
    input: {
      withdrawalId: string;
      settlementLedgerTransactionId: string;
    }
  ): Promise<boolean>;
  markRejected(
    context: TransactionContext,
    input: { withdrawalId: string; approverAdminId: string; reason: string }
  ): Promise<boolean>;
  markFailed(
    context: TransactionContext,
    input: { withdrawalId: string; reason: string }
  ): Promise<boolean>;
  markExpired(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<boolean>;
  markRefunded(
    context: TransactionContext,
    input: {
      withdrawalId: string;
      settlementLedgerTransactionId: string;
    }
  ): Promise<boolean>;
  findExpirable(
    context: TransactionContext,
    input: { readonly staleBefore: Date; readonly limit: number }
  ): Promise<readonly WithdrawalOrderSnapshot[]>;
}

export interface WithdrawalApprovalRepository {
  record(
    context: TransactionContext,
    input: RecordApprovalInput
  ): Promise<WithdrawalApprovalSnapshot>;
  findByWithdrawal(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<readonly WithdrawalApprovalSnapshot[]>;
  countApproved(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<number>;
}

export interface SignerPolicyRepository {
  findActive(
    context: TransactionContext,
    network: string
  ): Promise<SignerPolicySnapshot | null>;
  insert(
    context: TransactionContext,
    input: InsertSignerPolicyInput
  ): Promise<SignerPolicySnapshot>;
}
