import { randomUUID } from 'node:crypto';
import type {
  ClaimLinkSnapshot,
  LedgerAccountId,
  Uid
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { LedgerAccountRepository } from '../../ledger/application/ledger.repository.js';
import type { PostMoneyService } from '../../ledger/application/post-money.service.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { ClaimLinkRepository } from './transfer.repository.js';

export interface CreateLinkInput {
  readonly creatorUid: Uid;
  readonly assetCode: string;
  readonly amount: string;
}

export type ClaimResult =
  | { readonly kind: 'claimed'; readonly link: ClaimLinkSnapshot }
  | { readonly kind: 'already_claimed'; readonly link: ClaimLinkSnapshot }
  | { readonly kind: 'expired'; readonly link: ClaimLinkSnapshot }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'failed'; readonly reason: string };

const EXPIRY_MILLIS = 24 * 60 * 60 * 1000;

/**
 * One-time claim link lifecycle: creation freezes the amount from the
 * creator into a platform claim liability account; claiming releases it
 * to the claimer; expired links are lazily refunded back to the creator.
 */
export class ClaimLinkService {
  readonly #unitOfWork: UnitOfWork;
  readonly #links: ClaimLinkRepository;
  readonly #accounts: LedgerAccountRepository;
  readonly #poster: PostMoneyService;
  readonly #outbox: OutboxRepository;

  constructor(
    unitOfWork: UnitOfWork,
    links: ClaimLinkRepository,
    accounts: LedgerAccountRepository,
    poster: PostMoneyService,
    outbox: OutboxRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#links = links;
    this.#accounts = accounts;
    this.#poster = poster;
    this.#outbox = outbox;
  }

  public async createLink(input: CreateLinkInput): Promise<ClaimLinkSnapshot> {
    const creatorAccount = await this.#ensureUserAccount(
      input.creatorUid,
      input.assetCode
    );
    const liabilityAccount = await this.#ensureClaimLiability(
      input.assetCode
    );
    const claimCode = `clm-${randomUUID().slice(0, 13)}`;
    const link = await this.#unitOfWork.execute((context) =>
      this.#links.createLink(context, {
        claimCode,
        creatorUid: input.creatorUid,
        amount: input.amount,
        assetCode: input.assetCode,
        expiresAt: new Date(Date.now() + EXPIRY_MILLIS)
      })
    );
    const eventId = randomUUID();
    await this.#poster.post({
      idempotencyKey: `CLAIM_LINK:${claimCode}:FREEZE:0`,
      transactionType: 'RED_PACKET',
      occurredAt: new Date().toISOString(),
      lines: [
        {
          accountId: creatorAccount,
          direction: 'DEBIT',
          amount: input.amount
        },
        {
          accountId: liabilityAccount,
          direction: 'CREDIT',
          amount: input.amount
        }
      ]
    });
    void eventId;
    await this.#notify(input.creatorUid, 'telegram.claim-link-created.v1', {
      claimCode,
      amount: input.amount,
      assetCode: input.assetCode
    });
    return link;
  }

  public async claim(
    claimCode: string,
    claimerUid: Uid
  ): Promise<ClaimResult> {
    const link = await this.#unitOfWork.execute((context) =>
      this.#links.findByCode(context, claimCode)
    );
    if (link === null) {
      return { kind: 'not_found' };
    }
    if (link.status === 'CLAIMED') {
      return { kind: 'already_claimed', link };
    }
    if (link.status !== 'ACTIVE') {
      return { kind: 'expired', link };
    }
    if (Date.parse(link.expiresAt) <= Date.now()) {
      await this.#expireAndRefund(link);
      return { kind: 'expired', link };
    }
    try {
      const liabilityAccount = await this.#ensureClaimLiability(
        link.assetCode
      );
      const claimerAccount = await this.#ensureUserAccount(
        claimerUid,
        link.assetCode
      );
      const posting = await this.#poster.post({
        idempotencyKey: `CLAIM_LINK:${claimCode}:CLAIM:0`,
        transactionType: 'CLAIM',
        occurredAt: new Date().toISOString(),
        lines: [
          {
            accountId: liabilityAccount,
            direction: 'DEBIT',
            amount: link.amount
          },
          {
            accountId: claimerAccount,
            direction: 'CREDIT',
            amount: link.amount
          }
        ]
      });
      const marked = await this.#unitOfWork.execute((context) =>
        this.#links.markClaimed(context, {
          linkId: link.linkId,
          claimerUid,
          ledgerTransactionId: posting.transactionId
        })
      );
      if (!marked) {
        return { kind: 'already_claimed', link };
      }
      await this.#notify(link.creatorUid, 'telegram.claim-claimed.v1', {
        claimCode,
        amount: link.amount
      });
      await this.#notify(claimerUid, 'telegram.claim-received.v1', {
        claimCode,
        amount: link.amount,
        assetCode: link.assetCode
      });
      return { kind: 'claimed', link };
    } catch (error) {
      return {
        kind: 'failed',
        reason: error instanceof Error ? error.message : 'UNKNOWN'
      };
    }
  }

  async #expireAndRefund(link: ClaimLinkSnapshot): Promise<void> {
    const liabilityAccount = await this.#ensureClaimLiability(
      link.assetCode
    );
    const creatorAccount = await this.#ensureUserAccount(
      link.creatorUid,
      link.assetCode
    );
    await this.#poster.post({
      idempotencyKey: `CLAIM_LINK:${link.claimCode}:REFUND:0`,
      transactionType: 'RED_PACKET',
      occurredAt: new Date().toISOString(),
      lines: [
        {
          accountId: liabilityAccount,
          direction: 'DEBIT',
          amount: link.amount
        },
        {
          accountId: creatorAccount,
          direction: 'CREDIT',
          amount: link.amount
        }
      ]
    });
    await this.#unitOfWork.execute((context) =>
      this.#links.markExpired(context, link.linkId)
    );
    await this.#notify(link.creatorUid, 'telegram.claim-link-expired.v1', {
      claimCode: link.claimCode,
      amount: link.amount
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
        payload: {
          type: topic,
          eventId,
          uid,
          ...details
        }
      })
    );
  }
}
