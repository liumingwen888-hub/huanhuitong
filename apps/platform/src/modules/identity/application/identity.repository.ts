import type {
  ActiveChannelBindingSnapshot,
  RegistrationAcquisition,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type {
  ChannelIdentityQuery,
  ProfileSnapshotInput,
  RegistrationKey
} from '../domain/identity.types.js';

export interface IdentityRepository {
  findActiveBinding(
    context: TransactionContext,
    query: ChannelIdentityQuery
  ): Promise<ActiveChannelBindingSnapshot | null>;
  createUser(context: TransactionContext): Promise<Uid>;
  createMembership(context: TransactionContext, uid: Uid): Promise<string>;
  upsertProfileSnapshot(
    context: TransactionContext,
    uid: Uid,
    snapshot: ProfileSnapshotInput
  ): Promise<void>;
  createActiveBinding(
    context: TransactionContext,
    uid: Uid,
    query: ChannelIdentityQuery
  ): Promise<string>;
}

export interface RegistrationCompletion {
  readonly uid: Uid;
}

export interface RegistrationIdempotencyRepository {
  tryAcquire(
    context: TransactionContext,
    key: RegistrationKey
  ): Promise<RegistrationAcquisition>;
  complete(
    context: TransactionContext,
    key: RegistrationKey,
    uid: Uid
  ): Promise<boolean>;
  findCompleted(
    context: TransactionContext,
    key: RegistrationKey
  ): Promise<RegistrationCompletion | null>;
}
