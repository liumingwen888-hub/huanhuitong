import type { Uid } from './identity.js';

export type TransferOrderStatus =
  | 'PENDING'
  | 'EXECUTED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUNDED';

export type ClaimLinkStatus =
  | 'ACTIVE'
  | 'CLAIMED'
  | 'EXPIRED'
  | 'REFUNDED';

export type RedPacketStatus =
  | 'ACTIVE'
  | 'DEPLETED'
  | 'EXPIRED'
  | 'REFUNDED';

export interface TransferOrderSnapshot {
  readonly transferId: string;
  readonly orderRef: string;
  readonly senderUid: Uid;
  readonly recipientUid: Uid;
  readonly assetCode: string;
  readonly amount: string;
  readonly feeAmount: string;
  readonly status: TransferOrderStatus;
  readonly ledgerTransactionId: string | null;
  readonly failureReason: string | null;
}

export interface ClaimLinkSnapshot {
  readonly linkId: string;
  readonly claimCode: string;
  readonly creatorUid: Uid;
  readonly amount: string;
  readonly assetCode: string;
  readonly status: ClaimLinkStatus;
  readonly claimerUid: Uid | null;
  readonly expiresAt: string;
  readonly claimedAt: string | null;
}

export interface RedPacketSnapshot {
  readonly packetId: string;
  readonly creatorUid: Uid;
  readonly totalAmount: string;
  readonly packetCount: number;
  readonly assetCode: string;
  readonly status: RedPacketStatus;
  readonly expiresAt: string;
}

export interface RedPacketClaimSnapshot {
  readonly claimId: string;
  readonly packetId: string;
  readonly claimerUid: Uid;
  readonly amount: string;
  readonly claimedAt: string;
}

export type TransferContractErrorCode =
  | 'TRANSFER_COMMAND_INVALID'
  | 'TRANSFER_ORDER_NOT_FOUND'
  | 'TRANSFER_ALREADY_EXECUTED'
  | 'TRANSFER_SAME_SENDER_RECIPIENT'
  | 'CLAIM_LINK_NOT_FOUND'
  | 'CLAIM_LINK_ALREADY_CLAIMED'
  | 'CLAIM_LINK_EXPIRED'
  | 'RED_PACKET_NOT_FOUND'
  | 'RED_PACKET_DEPLETED'
  | 'RED_PACKET_EXPIRED'
  | 'RED_PACKET_ALREADY_CLAIMED';
