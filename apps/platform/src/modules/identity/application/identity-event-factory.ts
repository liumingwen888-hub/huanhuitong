import { randomUUID } from 'node:crypto';
import type {
  ActiveChannelBindingSnapshot,
  ResolveOrCreateUidCommand,
  TelegramUserSeenV1,
  Uid,
  UidCreatedV1
} from '@xht/contracts';

export interface IdentityIdFactory {
  newEventId(): string;
}

export const injectedIdentityIdFactory: IdentityIdFactory = {
  newEventId: () => randomUUID()
};

export function createUidCreatedV1(
  ids: IdentityIdFactory,
  identity: { readonly uid: Uid; readonly bindingId: string },
  command: ResolveOrCreateUidCommand
): UidCreatedV1 {
  return Object.freeze({
    type: 'identity.uid-created.v1',
    eventId: ids.newEventId(),
    uid: identity.uid,
    bindingId: identity.bindingId,
    occurredAt: command.occurredAt,
    correlationId: command.correlationId
  });
}

export function createTelegramUserSeenV1(
  ids: IdentityIdFactory,
  binding: ActiveChannelBindingSnapshot,
  command: ResolveOrCreateUidCommand
): TelegramUserSeenV1 {
  return Object.freeze({
    type: 'identity.telegram-user-seen.v1',
    eventId: ids.newEventId(),
    uid: binding.uid,
    bindingId: binding.bindingId,
    occurredAt: command.occurredAt,
    correlationId: command.correlationId
  });
}
