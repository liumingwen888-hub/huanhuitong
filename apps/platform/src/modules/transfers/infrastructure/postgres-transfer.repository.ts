import type {
  ClaimLinkSnapshot,
  RedPacketClaimSnapshot,
  RedPacketSnapshot,
  TransferOrderSnapshot,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import { TransferError } from '../domain/transfer.errors.js';
import type {
  ClaimLinkRepository,
  CreateTransferOrderInput,
  RedPacketRepository,
  TransferOrderRepository
} from '../application/transfer.repository.js';

interface TransferRow {
  transfer_id: string;
  order_ref: string;
  sender_uid: string;
  recipient_uid: string;
  asset_code: string;
  amount: string;
  fee_amount: string;
  status: string;
  ledger_transaction_id: string | null;
  failure_reason: string | null;
}

function toTransferSnapshot(row: TransferRow): TransferOrderSnapshot {
  return Object.freeze({
    transferId: row.transfer_id,
    orderRef: row.order_ref,
    senderUid: row.sender_uid as Uid,
    recipientUid: row.recipient_uid as Uid,
    assetCode: row.asset_code,
    amount: row.amount,
    feeAmount: row.fee_amount,
    status: row.status as TransferOrderSnapshot['status'],
    ledgerTransactionId: row.ledger_transaction_id,
    failureReason: row.failure_reason
  });
}

const TRANSFER_SELECT = `SELECT transfer_id, order_ref, sender_uid, recipient_uid,
  asset_code, amount::text AS amount, fee_amount::text AS fee_amount,
  status, ledger_transaction_id::text AS ledger_transaction_id, failure_reason`;

export class PostgresTransferOrderRepository implements TransferOrderRepository {
  public async createOrder(
    context: TransactionContext,
    input: CreateTransferOrderInput
  ): Promise<TransferOrderSnapshot> {
    if (input.senderUid === input.recipientUid) {
      throw new TransferError('TRANSFER_SAME_SENDER_RECIPIENT');
    }
    const result = await context.executeSql<TransferRow>(
      `${TRANSFER_SELECT}
         FROM transfer_orders WHERE order_ref = $1`,
      [input.orderRef]
    );
    if (result.rows.length > 0) {
      return toTransferSnapshot(result.rows[0]!);
    }
    const inserted = await context.executeSql<TransferRow>(
      `INSERT INTO transfer_orders
         (order_ref, sender_uid, recipient_uid, asset_code, amount, fee_amount)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5::bigint, $6::bigint)
       ON CONFLICT (order_ref) DO NOTHING
       RETURNING ${TRANSFER_SELECT.replace('SELECT', '').trim()}`,
      [
        input.orderRef,
        input.senderUid,
        input.recipientUid,
        input.assetCode,
        input.amount,
        input.feeAmount
      ]
    );
    if (inserted.rows.length === 1) {
      return toTransferSnapshot(inserted.rows[0]!);
    }
    const raced = await context.executeSql<TransferRow>(
      `${TRANSFER_SELECT}
         FROM transfer_orders WHERE order_ref = $1`,
      [input.orderRef]
    );
    return toTransferSnapshot(raced.rows[0]!);
  }

  public async findByOrderRef(
    context: TransactionContext,
    orderRef: string
  ): Promise<TransferOrderSnapshot | null> {
    const result = await context.executeSql<TransferRow>(
      `${TRANSFER_SELECT} FROM transfer_orders WHERE order_ref = $1`,
      [orderRef]
    );
    return result.rows[0] ? toTransferSnapshot(result.rows[0]) : null;
  }

  public async markExecuted(
    context: TransactionContext,
    input: { transferId: string; ledgerTransactionId: string }
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE transfer_orders
          SET status = 'EXECUTED',
              ledger_transaction_id = $2::uuid,
              executed_at = clock_timestamp()
        WHERE transfer_id = $1::uuid AND status = 'PENDING'
        RETURNING transfer_id`,
      [input.transferId, input.ledgerTransactionId]
    );
    return result.rows.length === 1;
  }

  public async markFailed(
    context: TransactionContext,
    input: { transferId: string; reason: string }
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE transfer_orders
          SET status = 'FAILED',
              failure_reason = $2
        WHERE transfer_id = $1::uuid AND status = 'PENDING'
        RETURNING transfer_id`,
      [input.transferId, input.reason]
    );
    return result.rows.length === 1;
  }
}

interface ClaimLinkRow {
  link_id: string;
  claim_code: string;
  creator_uid: string;
  amount: string;
  asset_code: string;
  status: string;
  claimer_uid: string | null;
  expires_at: Date;
  claimed_at: Date | null;
}

function toClaimSnapshot(row: ClaimLinkRow): ClaimLinkSnapshot {
  return Object.freeze({
    linkId: row.link_id,
    claimCode: row.claim_code,
    creatorUid: row.creator_uid as Uid,
    amount: row.amount,
    assetCode: row.asset_code,
    status: row.status as ClaimLinkSnapshot['status'],
    claimerUid: (row.claimer_uid as Uid) ?? null,
    expiresAt: new Date(row.expires_at).toISOString(),
    claimedAt:
      row.claimed_at === null
        ? null
        : new Date(row.claimed_at).toISOString()
  });
}

export class PostgresClaimLinkRepository implements ClaimLinkRepository {
  public async createLink(
    context: TransactionContext,
    input: {
      claimCode: string;
      creatorUid: Uid;
      amount: string;
      assetCode: string;
      expiresAt: Date;
    }
  ): Promise<ClaimLinkSnapshot> {
    const result = await context.executeSql<ClaimLinkRow>(
      `INSERT INTO claim_links
         (claim_code, creator_uid, amount, asset_code, expires_at)
       VALUES ($1, $2::uuid, $3::bigint, $4, $5)
       RETURNING link_id, claim_code, creator_uid, amount::text AS amount,
                 asset_code, status, claimer_uid, expires_at, claimed_at`,
      [
        input.claimCode,
        input.creatorUid,
        input.amount,
        input.assetCode,
        input.expiresAt
      ]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TransferError('TRANSFER_COMMAND_INVALID');
    }
    return toClaimSnapshot(row);
  }

  public async findByCode(
    context: TransactionContext,
    claimCode: string
  ): Promise<ClaimLinkSnapshot | null> {
    const result = await context.executeSql<ClaimLinkRow>(
      `SELECT link_id, claim_code, creator_uid, amount::text AS amount,
              asset_code, status, claimer_uid, expires_at, claimed_at
         FROM claim_links WHERE claim_code = $1`,
      [claimCode]
    );
    return result.rows[0] ? toClaimSnapshot(result.rows[0]) : null;
  }

  public async markClaimed(
    context: TransactionContext,
    input: {
      linkId: string;
      claimerUid: Uid;
      ledgerTransactionId: string;
    }
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE claim_links
          SET status = 'CLAIMED',
              claimer_uid = $2::uuid,
              claimed_at = clock_timestamp(),
              ledger_transaction_id = $3::uuid
        WHERE link_id = $1::uuid AND status = 'ACTIVE'
          AND expires_at > clock_timestamp()
        RETURNING link_id`,
      [input.linkId, input.claimerUid, input.ledgerTransactionId]
    );
    return result.rows.length === 1;
  }

  public async markExpired(
    context: TransactionContext,
    linkId: string
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE claim_links
          SET status = 'EXPIRED'
        WHERE link_id = $1::uuid AND status = 'ACTIVE'
          AND expires_at <= clock_timestamp()
        RETURNING link_id`,
      [linkId]
    );
    return result.rows.length === 1;
  }
}

interface PacketRow {
  packet_id: string;
  creator_uid: string;
  total_amount: string;
  packet_count: number;
  asset_code: string;
  status: string;
  expires_at: Date;
}

function toPacketSnapshot(row: PacketRow): RedPacketSnapshot {
  return Object.freeze({
    packetId: row.packet_id,
    creatorUid: row.creator_uid as Uid,
    totalAmount: row.total_amount,
    packetCount: row.packet_count,
    assetCode: row.asset_code,
    status: row.status as RedPacketSnapshot['status'],
    expiresAt: new Date(row.expires_at).toISOString()
  });
}

export class PostgresRedPacketRepository implements RedPacketRepository {
  public async createPacket(
    context: TransactionContext,
    input: {
      creatorUid: Uid;
      totalAmount: string;
      packetCount: number;
      assetCode: string;
      expiresAt: Date;
    }
  ): Promise<RedPacketSnapshot> {
    const result = await context.executeSql<PacketRow>(
      `INSERT INTO red_packets
         (creator_uid, total_amount, packet_count, asset_code, expires_at)
       VALUES ($1::uuid, $2::bigint, $3, $4, $5)
       RETURNING packet_id, creator_uid, total_amount::text AS total_amount,
                 packet_count, asset_code, status, expires_at`,
      [
        input.creatorUid,
        input.totalAmount,
        input.packetCount,
        input.assetCode,
        input.expiresAt
      ]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TransferError('TRANSFER_COMMAND_INVALID');
    }
    return toPacketSnapshot(row);
  }

  public async findById(
    context: TransactionContext,
    packetId: string
  ): Promise<RedPacketSnapshot | null> {
    const result = await context.executeSql<PacketRow>(
      `SELECT packet_id, creator_uid, total_amount::text AS total_amount,
              packet_count, asset_code, status, expires_at
         FROM red_packets WHERE packet_id = $1::uuid`,
      [packetId]
    );
    return result.rows[0] ? toPacketSnapshot(result.rows[0]) : null;
  }

  public async claimPacket(
    context: TransactionContext,
    input: {
      packetId: string;
      claimerUid: Uid;
      amount: string;
      ledgerTransactionId: string;
    }
  ): Promise<{ claimed: boolean; claimId: string }> {
    if (input.claimerUid === (await this.getCreator(context, input.packetId))) {
      throw new TransferError('RED_PACKET_ALREADY_CLAIMED');
    }
    const result = await context.executeSql<{ claim_id: string }>(
      `INSERT INTO red_packet_claims
         (packet_id, claimer_uid, amount, ledger_transaction_id)
       VALUES ($1::uuid, $2::uuid, $3::bigint, $4::uuid)
       ON CONFLICT (packet_id, claimer_uid) DO NOTHING
       RETURNING claim_id`,
      [
        input.packetId,
        input.claimerUid,
        input.amount,
        input.ledgerTransactionId
      ]
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { claimed: false, claimId: '' };
    }
    const claimsCount = await context.executeSql<{ n: number }>(
      `SELECT count(*)::int AS n FROM red_packet_claims
        WHERE packet_id = $1::uuid`,
      [input.packetId]
    );
    const count = claimsCount.rows[0]?.n ?? 0;
    const packet = await this.findById(context, input.packetId);
    if (packet !== null && count >= packet.packetCount) {
      await context.executeSql(
        `UPDATE red_packets SET status = 'DEPLETED'
          WHERE packet_id = $1::uuid AND status = 'ACTIVE'`,
        [input.packetId]
      );
    }
    return { claimed: true, claimId: row.claim_id };
  }

  public async findClaims(
    context: TransactionContext,
    packetId: string
  ): Promise<readonly RedPacketClaimSnapshot[]> {
    const result = await context.executeSql<{
      claim_id: string;
      packet_id: string;
      claimer_uid: string;
      amount: string;
      claimed_at: Date;
    }>(
      `SELECT claim_id, packet_id, claimer_uid, amount::text AS amount, claimed_at
         FROM red_packet_claims WHERE packet_id = $1::uuid
        ORDER BY claimed_at`,
      [packetId]
    );
    return result.rows.map((row) => ({
      claimId: row.claim_id,
      packetId: row.packet_id,
      claimerUid: row.claimer_uid as Uid,
      amount: row.amount,
      claimedAt: new Date(row.claimed_at).toISOString()
    }));
  }

  private async getCreator(
    context: TransactionContext,
    packetId: string
  ): Promise<Uid | null> {
    const result = await context.executeSql<{ creator_uid: string }>(
      `SELECT creator_uid FROM red_packets WHERE packet_id = $1::uuid`,
      [packetId]
    );
    return (result.rows[0]?.creator_uid as Uid) ?? null;
  }
}
