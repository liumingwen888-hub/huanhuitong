import { randomUUID } from 'node:crypto';
import type {
  LedgerAccountId,
  RedPacketSnapshot,
  Uid
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { RedPacketRepository } from './transfer.repository.js';

export interface CreatePacketInput {
  readonly creatorUid: Uid;
  readonly assetCode: string;
  readonly totalAmount: string;
  readonly packetCount: number;
}

export type ClaimPacketResult =
  | { readonly kind: 'claimed'; readonly amount: string }
  | { readonly kind: 'already_claimed' }
  | { readonly kind: 'depleted' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'failed'; readonly reason: string };

const EXPIRY_MILLIS = 24 * 60 * 60 * 1000;

/**
 * Multi-portion red packet lifecycle: creation freezes the total from the
 * creator; each claim releases one portion to a unique claimer; when all
 * portions are claimed the packet is DEPLETED; expired packets refund
 * only the remaining unclaimed amount.
 */
export class RedPacketService {
  readonly #unitOfWork: UnitOfWork;
  readonly #packets: RedPacketRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;

  constructor(
    unitOfWork: UnitOfWork,
    packets: RedPacketRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#packets = packets;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
  }

  public async createPacket(
    input: CreatePacketInput
  ): Promise<RedPacketSnapshot> {
    if (
      !Number.isSafeInteger(input.packetCount) ||
      input.packetCount < 1 ||
      input.packetCount > 100
    ) {
      throw new Error('PACKET_COUNT_INVALID');
    }
    const total = BigInt(input.totalAmount);
    if (total <= 0n || total % BigInt(input.packetCount) !== 0n) {
      throw new Error('AMOUNT_NOT_DIVISIBLE');
    }
    const creatorAccount = await this.#ensureUserAccount(
      input.creatorUid,
      input.assetCode
    );
    const liabilityAccount = await this.#ensureClaimLiability(
      input.assetCode
    );
    const packet = await this.#unitOfWork.execute((context) =>
      this.#packets.createPacket(context, {
        creatorUid: input.creatorUid,
        totalAmount: input.totalAmount,
        packetCount: input.packetCount,
        assetCode: input.assetCode,
        expiresAt: new Date(Date.now() + EXPIRY_MILLIS)
      })
    );
    await this.#poster.post({
      idempotencyKey: `RED_PACKET:${packet.packetId}:FREEZE:0`,
      transactionType: 'RED_PACKET',
      occurredAt: new Date().toISOString(),
      lines: [
        { accountId: creatorAccount, direction: 'DEBIT', amount: input.totalAmount },
        { accountId: liabilityAccount, direction: 'CREDIT', amount: input.totalAmount }
      ]
    });
    await this.#notify(input.creatorUid, 'telegram.red-packet-created.v1', {
      packetId: packet.packetId,
      totalAmount: input.totalAmount,
      packetCount: input.packetCount
    });
    return packet;
  }

  public async claimPacket(
    packetId: string,
    claimerUid: Uid
  ): Promise<ClaimPacketResult> {
    const packet = await this.#unitOfWork.execute((context) =>
      this.#packets.findById(context, packetId)
    );
    if (packet === null) return { kind: 'not_found' };
    if (packet.status === 'DEPLETED') return { kind: 'depleted' };
    if (packet.status !== 'ACTIVE') return { kind: 'expired' };
    if (Date.parse(packet.expiresAt) <= Date.now()) {
      await this.#expireAndRefundRemaining(packet);
      return { kind: 'expired' };
    }
    const claims = await this.#unitOfWork.execute((context) =>
      this.#packets.findClaims(context, packetId)
    );
    if (claims.some((c) => c.claimerUid === claimerUid)) {
      return { kind: 'already_claimed' };
    }
    if (claims.length >= packet.packetCount) {
      return { kind: 'depleted' };
    }
    const perPerson = BigInt(packet.totalAmount) / BigInt(packet.packetCount);
    try {
      const liabilityAccount = await this.#ensureClaimLiability(
        packet.assetCode
      );
      const claimerAccount = await this.#ensureUserAccount(
        claimerUid,
        packet.assetCode
      );
      const posting = await this.#poster.post({
        idempotencyKey: `RED_PACKET:${packetId}:CLAIM:${claimerUid}`,
        transactionType: 'CLAIM',
        occurredAt: new Date().toISOString(),
        lines: [
          { accountId: liabilityAccount, direction: 'DEBIT', amount: perPerson.toString() },
          { accountId: claimerAccount, direction: 'CREDIT', amount: perPerson.toString() }
        ]
      });
      const result = await this.#unitOfWork.execute((context) =>
        this.#packets.claimPacket(context, {
          packetId,
          claimerUid,
          amount: perPerson.toString(),
          ledgerTransactionId: posting.transactionId
        })
      );
      if (!result.claimed) {
        return { kind: 'already_claimed' };
      }
      await this.#notify(claimerUid, 'telegram.red-packet-received.v1', {
        packetId,
        amount: perPerson.toString(),
        assetCode: packet.assetCode
      });
      return { kind: 'claimed', amount: perPerson.toString() };
    } catch (error) {
      return {
        kind: 'failed',
        reason: error instanceof Error ? error.message : 'UNKNOWN'
      };
    }
  }

  async #expireAndRefundRemaining(
    packet: RedPacketSnapshot
  ): Promise<void> {
    const claims = await this.#unitOfWork.execute((context) =>
      this.#packets.findClaims(context, packet.packetId)
    );
    const claimedTotal = claims.reduce(
      (sum, claim) => sum + BigInt(claim.amount),
      0n
    );
    const remaining = BigInt(packet.totalAmount) - claimedTotal;
    if (remaining <= 0n) return;
    const liabilityAccount = await this.#ensureClaimLiability(
      packet.assetCode
    );
    const creatorAccount = await this.#ensureUserAccount(
      packet.creatorUid,
      packet.assetCode
    );
    await this.#poster.post({
      idempotencyKey: `RED_PACKET:${packet.packetId}:REFUND:0`,
      transactionType: 'RED_PACKET',
      occurredAt: new Date().toISOString(),
      lines: [
        { accountId: liabilityAccount, direction: 'DEBIT', amount: remaining.toString() },
        { accountId: creatorAccount, direction: 'CREDIT', amount: remaining.toString() }
      ]
    });
    await this.#unitOfWork.execute((context) =>
      context.executeSql(
        `UPDATE red_packets SET status = 'EXPIRED'
          WHERE packet_id = $1::uuid AND status = 'ACTIVE'`,
        [packet.packetId]
      )
    );
    await this.#notify(packet.creatorUid, 'telegram.red-packet-expired.v1', {
      packetId: packet.packetId,
      refundedAmount: remaining.toString()
    });
  }

  async #ensureUserAccount(
    uid: Uid,
    assetCode: string
  ): Promise<LedgerAccountId> {
    return this.#unitOfWork.execute((context) =>
      this.#accounts
        .openUserAccount(context, {
          ownerUid: uid,
          assetCode,
          purpose: 'USER_AVAILABLE',
          idempotencyKey: `open:${uid}:${assetCode}`
        })
        .then((account) => account.accountId)
    );
  }

  async #ensureClaimLiability(assetCode: string): Promise<LedgerAccountId> {
    const existing = await this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = 'CLAIM_LIABILITY' LIMIT 1`,
        [assetCode]
      );
      return rows.rows[0]?.account_id ?? null;
    });
    if (existing !== null) return existing as LedgerAccountId;
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ account_id: string }>(
        `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
         VALUES (NULL, $1, 'CLAIM_LIABILITY')
         ON CONFLICT (owner_uid, asset_code, purpose) DO NOTHING
         RETURNING account_id`,
        [assetCode]
      );
      if (rows.rows.length === 1) {
        return rows.rows[0]!.account_id as LedgerAccountId;
      }
      const raced = await context.executeSql<{ account_id: string }>(
        `SELECT account_id FROM ledger_accounts
          WHERE owner_uid IS NULL AND asset_code = $1
            AND purpose = 'CLAIM_LIABILITY' LIMIT 1`,
        [assetCode]
      );
      return raced.rows[0]!.account_id as LedgerAccountId;
    });
  }

  async #notify(
    uid: Uid,
    topic: string,
    details: Record<string, unknown>
  ): Promise<void> {
    const eventId = randomUUID();
    await this.#unitOfWork.execute((context) =>
      this.#outbox.enqueue(context, {
        id: eventId,
        topic,
        eventKey: `${topic}:${eventId}`,
        occurredAt: new Date().toISOString(),
        correlationId: randomUUID(),
        payload: { type: topic, eventId, uid, ...details }
      })
    );
  }
}
