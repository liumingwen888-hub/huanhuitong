import type { Uid } from './identity.js';

export type WithdrawalOrderStatus =
  | 'FROZEN'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SIGNING'
  | 'BROADCAST'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUNDED';

export type WithdrawalApprovalDecision = 'APPROVE' | 'REJECT';

export interface WithdrawalOrderSnapshot {
  readonly withdrawalId: string;
  readonly orderRef: string;
  readonly uid: Uid;
  readonly assetCode: string;
  readonly amount: string;
  readonly feeAmount: string;
  readonly destinationAddress: string;
  readonly status: WithdrawalOrderStatus;
  readonly freezeLedgerTransactionId: string;
  readonly settlementLedgerTransactionId: string | null;
  readonly broadcastTxid: string | null;
  readonly approverAdminId: string | null;
  readonly rejectionReason: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
}

export interface WithdrawalApprovalSnapshot {
  readonly approvalId: string;
  readonly withdrawalId: string;
  readonly adminId: string;
  readonly level: number;
  readonly decision: WithdrawalApprovalDecision;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface SignerPolicySnapshot {
  readonly policyVersion: number;
  readonly network: string;
  readonly hotWalletAddress: string;
  readonly feeAmount: string;
  readonly minAutoAmount: string;
  readonly maxAmount: string;
  readonly activatedAt: string;
}

export interface WithdrawalCommand {
  readonly orderRef: string;
  readonly uid: Uid;
  readonly assetCode: string;
  readonly amount: string;
  readonly destinationAddress: string;
}

export type WithdrawalCommandResult =
  | { readonly outcome: 'ACCEPTED'; readonly order: WithdrawalOrderSnapshot }
  | {
      readonly outcome: 'REJECTED';
      readonly reasonCode: WithdrawalContractErrorCode;
    };

export type WithdrawalContractErrorCode =
  | 'WITHDRAWAL_COMMAND_INVALID'
  | 'WITHDRAWAL_ORDER_NOT_FOUND'
  | 'WITHDRAWAL_INVALID_TRANSITION'
  | 'WITHDRAWAL_ALREADY_CLOSED'
  | 'WITHDRAWAL_POLICY_NOT_FOUND'
  | 'WITHDRAWAL_AMOUNT_ABOVE_MAX'
  | 'WITHDRAWAL_DUPLICATE_APPROVAL';
