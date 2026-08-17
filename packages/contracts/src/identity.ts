declare const uidBrand: unique symbol;
export type Uid = string & { readonly [uidBrand]: 'Uid' };

export type ChannelType = 'telegram';

export interface ResolveOrCreateUidCommand {
  readonly channelType: ChannelType;
  readonly externalUserId: string;
  readonly sourceMessageId: string;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly correlationId: string;
  readonly occurredAt: string;
}

export interface UidCreatedV1 {
  readonly type: 'identity.uid-created.v1';
  readonly eventId: string;
  readonly uid: Uid;
  readonly bindingId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
}

export interface TelegramUserSeenV1 {
  readonly type: 'identity.telegram-user-seen.v1';
  readonly eventId: string;
  readonly uid: Uid;
  readonly bindingId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
}

export interface ResolveOrCreateUidResult {
  readonly uid: Uid;
  readonly bindingId: string;
  readonly created: boolean;
  readonly identityEvent: UidCreatedV1 | TelegramUserSeenV1;
}

export interface ActiveChannelBindingSnapshot {
  readonly bindingId: string;
  readonly uid: Uid;
  readonly channelType: ChannelType;
  readonly externalUserId: string;
}

export type RegistrationAcquisition =
  | 'acquired'
  | 'in_progress'
  | 'completed';

export type IdentityContractErrorCode =
  | 'IDENTITY_COMMAND_INVALID'
  | 'IDENTITY_BINDING_CONFLICT'
  | 'IDENTITY_USER_STATUS_INVALID'
  | 'IDENTITY_REGISTRATION_KEY_INVALID';
