import type {
  ResolveOrCreateUidCommand,
  ResolveOrCreateUidResult,
  TelegramUserSeenV1,
  Uid,
  UidCreatedV1
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type { OutboxEnvelopeInput } from '../../reliability/outbox/outbox.repository.js';
import type { OutboxRepository } from '../../reliability/outbox/outbox.repository.js';
import { createRegistrationKey } from '../domain/identity.types.js';
import type { RegistrationKey } from '../domain/identity.types.js';
import type {
  IdentityIdFactory
} from './identity-event-factory.js';
import {
  createTelegramUserSeenV1,
  createUidCreatedV1
} from './identity-event-factory.js';
import type {
  IdentityRepository,
  RegistrationIdempotencyRepository
} from './identity.repository.js';

export type ResolveOrCreateUidOutcome =
  | ResolveOrCreateUidResult
  | { readonly status: 'in_progress' };

function toOutboxEnvelope(
  event: UidCreatedV1 | TelegramUserSeenV1,
  sourceMessageId: string
): OutboxEnvelopeInput {
  return Object.freeze({
    id: event.eventId,
    topic: event.type,
    eventKey:
      event.type === 'identity.uid-created.v1'
        ? `uid-created:${event.uid}`
        : `telegram-seen:${sourceMessageId}`,
    occurredAt: event.occurredAt,
    correlationId: event.correlationId,
    payload: event
  });
}

export class ResolveOrCreateUid {
  readonly #identities: IdentityRepository;
  readonly #registrations: RegistrationIdempotencyRepository;
  readonly #outbox: OutboxRepository;
  readonly #ids: IdentityIdFactory;

  constructor(
    identities: IdentityRepository,
    registrations: RegistrationIdempotencyRepository,
    outbox: OutboxRepository,
    ids: IdentityIdFactory
  ) {
    this.#identities = identities;
    this.#registrations = registrations;
    this.#outbox = outbox;
    this.#ids = ids;
  }

  public async execute(
    transaction: TransactionContext,
    command: ResolveOrCreateUidCommand
  ): Promise<ResolveOrCreateUidOutcome> {
    const existing = await this.#identities.findActiveBinding(transaction, {
      channelType: command.channelType,
      externalUserId: command.externalUserId
    });
    if (existing !== null) {
      await this.#identities.upsertProfileSnapshot(transaction, existing.uid, {
        username: command.username,
        displayName: command.displayName
      });
      const identityEvent = createTelegramUserSeenV1(
        this.#ids,
        existing,
        command
      );
      await this.#outbox.enqueue(transaction, toOutboxEnvelope(identityEvent, command.sourceMessageId));
      return {
        uid: existing.uid,
        bindingId: existing.bindingId,
        created: false,
        identityEvent
      };
    }

    const key: RegistrationKey = createRegistrationKey(
      command.channelType,
      command.externalUserId
    );
    const acquired = await this.#registrations.tryAcquire(transaction, key);
    if (acquired !== 'acquired') {
      if (acquired === 'in_progress') {
        return { status: 'in_progress' };
      }
      const completed = await this.#registrations.findCompleted(
        transaction,
        key
      );
      if (completed === null) {
        return { status: 'in_progress' };
      }
      const binding = await this.#identities.findActiveBinding(transaction, {
        channelType: command.channelType,
        externalUserId: command.externalUserId
      });
      if (binding === null) {
        return { status: 'in_progress' };
      }
      const identityEvent = createTelegramUserSeenV1(
        this.#ids,
        binding,
        command
      );
      await this.#outbox.enqueue(
        transaction,
        toOutboxEnvelope(identityEvent, command.sourceMessageId)
      );
      return {
        uid: binding.uid,
        bindingId: binding.bindingId,
        created: false,
        identityEvent
      };
    }

    const uid = await this.#identities.createUser(transaction);
    await this.#identities.createMembership(transaction, uid);
    await this.#identities.upsertProfileSnapshot(transaction, uid, {
      username: command.username,
      displayName: command.displayName
    });
    const bindingId = await this.#identities.createActiveBinding(
      transaction,
      uid,
      { channelType: command.channelType, externalUserId: command.externalUserId }
    );
    await this.#registrations.complete(transaction, key, uid as Uid);
    const identityEvent = createUidCreatedV1(
      this.#ids,
      { uid, bindingId },
      command
    );
    await this.#outbox.enqueue(transaction, toOutboxEnvelope(identityEvent, command.sourceMessageId));
    return { uid, bindingId, created: true, identityEvent };
  }
}
