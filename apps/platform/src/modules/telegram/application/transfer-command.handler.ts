import type { Uid } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { TransferCommand } from './transfer-commands.js';
import { TRANSFER_REPLIES, type TransferReply } from './transfer-replies.js';
import type { TransferExecutionService } from '../../transfers/application/transfer-execution.service.js';
import type { ClaimLinkService } from '../../transfers/application/claim-link.service.js';
import type { RedPacketService } from '../../transfers/application/red-packet.service.js';
import type { BalanceQueryService } from '../../ledger/application/balance-query.service.js';

export interface TransferCommandInput {
  readonly command: TransferCommand;
  readonly externalUserId: string;
  readonly updateId: string;
}

export interface TransferCommandOutcome {
  readonly reply: TransferReply;
}

export class TransferCommandHandler {
  readonly #unitOfWork: UnitOfWork;
  readonly #transfers: TransferExecutionService;
  readonly #claims: ClaimLinkService;
  readonly #redPackets: RedPacketService;
  readonly #balances: BalanceQueryService;

  constructor(
    unitOfWork: UnitOfWork,
    transfers: TransferExecutionService,
    claims: ClaimLinkService,
    redPackets: RedPacketService,
    balances: BalanceQueryService
  ) {
    this.#unitOfWork = unitOfWork;
    this.#transfers = transfers;
    this.#claims = claims;
    this.#redPackets = redPackets;
    this.#balances = balances;
  }

  public async execute(input: TransferCommandInput): Promise<TransferCommandOutcome> {
    const uid = await this.#resolveUid(input.externalUserId);
    if (uid === null) {
      return { reply: 'internalError' };
    }
    try {
      return await this.#dispatch(uid, input.command, input.updateId);
    } catch {
      return { reply: 'internalError' };
    }
  }

  async #dispatch(
    uid: Uid,
    command: TransferCommand,
    updateId: string
  ): Promise<TransferCommandOutcome> {
    if (command.kind === 'balance') {
      return { reply: 'balanceNoAccount' };
    }
    if (command.kind === 'transfer') {
      const recipientUid = await this.#resolveUid(command.recipientExternalId);
      if (recipientUid === null) {
        return { reply: 'transferFailed' };
      }
      const result = await this.#transfers.execute({
        orderRef: `XFER:TG:${updateId}:0`,
        senderUid: uid,
        recipientUid,
        assetCode: 'USDT-TRC20',
        amount: command.amount
      });
      if (result.kind === 'executed' || result.kind === 'already_executed') {
        return { reply: 'transferSuccess' };
      }
      return { reply: 'transferFailed' };
    }
    if (command.kind === 'claim') {
      const result = await this.#claims.claim(command.claimCode, uid);
      if (result.kind === 'claimed') return { reply: 'claimSuccess' };
      if (result.kind === 'already_claimed') return { reply: 'claimAlreadyClaimed' };
      if (result.kind === 'expired') return { reply: 'claimExpired' };
      if (result.kind === 'not_found') return { reply: 'claimNotFound' };
      return { reply: 'internalError' };
    }
    // red-packet
    try {
      await this.#redPackets.createPacket({
        creatorUid: uid,
        assetCode: 'USDT-TRC20',
        totalAmount: command.totalAmount,
        packetCount: command.packetCount
      });
      return { reply: 'redPacketCreated' };
    } catch {
      return { reply: 'redPacketFailed' };
    }
  }

  async #resolveUid(externalUserId: string): Promise<Uid | null> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{ uid: string }>(
        `SELECT uid FROM channel_bindings
          WHERE channel_type='TELEGRAM' AND external_user_id=$1
            AND status='ACTIVE' LIMIT 1`,
        [externalUserId]
      );
      return (rows.rows[0]?.uid as Uid) ?? null;
    });
  }
}
