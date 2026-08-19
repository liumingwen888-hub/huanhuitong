import type {
  ClaimLinkSnapshot,
  RedPacketClaimSnapshot,
  RedPacketSnapshot,
  TransferOrderSnapshot,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export interface CreateTransferOrderInput {
  readonly orderRef: string;
  readonly senderUid: Uid;
  readonly recipientUid: Uid;
  readonly assetCode: string;
  readonly amount: string;
  readonly feeAmount: string;
}

export interface TransferOrderRepository {
  createOrder(
    context: TransactionContext,
    input: CreateTransferOrderInput
  ): Promise<TransferOrderSnapshot>;
  findByOrderRef(
    context: TransactionContext,
    orderRef: string
  ): Promise<TransferOrderSnapshot | null>;
  markExecuted(
    context: TransactionContext,
    input: {
      transferId: string;
      ledgerTransactionId: string;
    }
  ): Promise<boolean>;
  markFailed(
    context: TransactionContext,
    input: { transferId: string; reason: string }
  ): Promise<boolean>;
}

export interface ClaimLinkRepository {
  createLink(
    context: TransactionContext,
    input: {
      claimCode: string;
      creatorUid: Uid;
      amount: string;
      assetCode: string;
      expiresAt: Date;
    }
  ): Promise<ClaimLinkSnapshot>;
  findByCode(
    context: TransactionContext,
    claimCode: string
  ): Promise<ClaimLinkSnapshot | null>;
  markClaimed(
    context: TransactionContext,
    input: {
      linkId: string;
      claimerUid: Uid;
      ledgerTransactionId: string;
    }
  ): Promise<boolean>;
  markExpired(
    context: TransactionContext,
    linkId: string
  ): Promise<boolean>;
}

export interface RedPacketRepository {
  createPacket(
    context: TransactionContext,
    input: {
      creatorUid: Uid;
      totalAmount: string;
      packetCount: number;
      assetCode: string;
      expiresAt: Date;
    }
  ): Promise<RedPacketSnapshot>;
  findById(
    context: TransactionContext,
    packetId: string
  ): Promise<RedPacketSnapshot | null>;
  claimPacket(
    context: TransactionContext,
    input: {
      packetId: string;
      claimerUid: Uid;
      amount: string;
      ledgerTransactionId: string;
    }
  ): Promise<{ claimed: boolean; claimId: string }>;
  findClaims(
    context: TransactionContext,
    packetId: string
  ): Promise<readonly RedPacketClaimSnapshot[]>;
}
