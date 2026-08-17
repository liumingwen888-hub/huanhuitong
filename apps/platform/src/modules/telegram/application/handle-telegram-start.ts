import type {
  HandleTelegramStartCommand,
  HandleTelegramStartResult,
  TelegramMainMenuRequestedV1
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { PublicUnitOfWorkError } from '../../../infrastructure/database/unit-of-work.js';
import type { InboxRepository } from '../../reliability/inbox/inbox.types.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import type { ResolveOrCreateUid } from '../../identity/application/resolve-or-create-uid.js';
import type { IdentityIdFactory } from '../../identity/application/identity-event-factory.js';
import {
  toIdentityCommand,
  toInboxClaimCommand
} from './telegram-start.mapper.js';

export class HandleTelegramStart {
  readonly #unitOfWork: UnitOfWork;
  readonly #inbox: InboxRepository;
  readonly #identities: ResolveOrCreateUid;
  readonly #outbox: OutboxRepository;
  readonly #ids: IdentityIdFactory;

  constructor(
    unitOfWork: UnitOfWork,
    inbox: InboxRepository,
    identities: ResolveOrCreateUid,
    outbox: OutboxRepository,
    ids: IdentityIdFactory
  ) {
    this.#unitOfWork = unitOfWork;
    this.#inbox = inbox;
    this.#identities = identities;
    this.#outbox = outbox;
    this.#ids = ids;
  }

  public execute(
    command: HandleTelegramStartCommand
  ): Promise<HandleTelegramStartResult> {
    return this.#unitOfWork.execute(async (transaction) => {
      const claim = await this.#inbox.claim(
        transaction,
        toInboxClaimCommand(command)
      );
      if (claim.kind !== 'claimed') {
        return claim;
      }
      const identity = await this.#identities.execute(
        transaction,
        toIdentityCommand(command)
      );
      if (!('uid' in identity)) {
        throw new PublicUnitOfWorkError('APPLICATION_IDENTITY_IN_PROGRESS');
      }
      const eventId = this.#ids.newEventId();
      const menuEvent: TelegramMainMenuRequestedV1 = {
        type: 'telegram.main-menu-requested.v1',
        eventId,
        uid: identity.uid,
        bindingId: identity.bindingId,
        menuVersion: 'main-menu-v1',
        occurredAt: command.receivedAt.toISOString(),
        correlationId: command.correlationId
      };
      await this.#outbox.enqueue(transaction, {
        id: eventId,
        topic: menuEvent.type,
        eventKey: `telegram:menu:${command.updateId}`,
        occurredAt: menuEvent.occurredAt,
        correlationId: command.correlationId,
        payload: menuEvent
      });
      const completed = await this.#inbox.markProcessed(transaction, {
        lease: claim.lease
      });
      if (!completed) {
        throw new PublicUnitOfWorkError('APPLICATION_INBOX_CLAIM_LOST');
      }
      return {
        kind: 'processed',
        uid: identity.uid,
        created: identity.created
      };
    });
  }
}
