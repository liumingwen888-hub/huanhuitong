# Canonical fragment: apps/platform/src/modules/reliability/inbox/inbox.types.ts

[返回 fragments 索引](00-index.md)

<!-- XHT-T5-CANONICAL-BEGIN target="apps/platform/src/modules/reliability/inbox/inbox.types.ts" sequence="1" -->
```ts
import type {
  InboxDigestKeyVersion,
  InboxDigestSet
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export const INBOX_CLAIM_LEASE_MILLISECONDS = 30_000 as const;

export type InboxStatus =
  | 'RECEIVED'
  | 'CLAIMED'
  | 'PROCESSED'
  | 'CONFLICT'
  | 'FAILED';

export interface InboxClaimCommand {
  readonly consumer: string;
  readonly externalMessageId: string;
  readonly digests: InboxDigestSet;
  readonly correlationId: string;
  readonly claimant: string;
  readonly receivedAt: Date;
}

export interface InboxClaimLease {
  readonly inboxId: string;
  readonly claimant: string;
  readonly generation: number;
  readonly claimedUntil: Date;
}

export type InboxClaimResult =
  | {
      readonly kind: 'claimed';
      readonly inboxId: string;
      readonly lease: InboxClaimLease;
      readonly reclaimed: boolean;
    }
  | {
      readonly kind: 'duplicate_same_payload';
      readonly inboxId: string;
      readonly status: InboxStatus;
    }
  | {
      readonly kind: 'conflict';
      readonly inboxId: string;
    }
  | {
      readonly kind: 'digest_key_unavailable';
      readonly inboxId: string;
      readonly requiredKeyVersion: InboxDigestKeyVersion;
    };

export interface MarkInboxProcessedCommand {
  readonly lease: InboxClaimLease;
}

export interface InboxRepository {
  claim(
    context: TransactionContext,
    command: InboxClaimCommand
  ): Promise<InboxClaimResult>;
  markProcessed(
    context: TransactionContext,
    command: MarkInboxProcessedCommand
  ): Promise<boolean>;
}

export type InboxRepositoryErrorCode =
  | 'INBOX_COMMAND_INVALID'
  | 'INBOX_ROW_DISAPPEARED'
  | 'INBOX_STATE_INVALID';

const authenticInboxRepositoryErrors = new WeakSet<object>();

export class InboxRepositoryError extends Error {
  readonly retryable = false as const;

  constructor(readonly code: InboxRepositoryErrorCode) {
    super(code);
    this.name = 'InboxRepositoryError';
    Object.defineProperty(this, 'stack', {
      value: `InboxRepositoryError: ${code}`,
      enumerable: false,
      writable: false,
      configurable: false
    });
    authenticInboxRepositoryErrors.add(this);
    Object.freeze(this);
  }
}

Object.freeze(InboxRepositoryError.prototype);

export function isAuthenticInboxRepositoryError(
  value: unknown
): value is InboxRepositoryError {
  return (
    typeof value === 'object' &&
    value !== null &&
    authenticInboxRepositoryErrors.has(value) &&
    Object.isFrozen(value) &&
    value instanceof InboxRepositoryError &&
    Object.getPrototypeOf(value) === InboxRepositoryError.prototype
  );
}
```
<!-- XHT-T5-CANONICAL-END target="apps/platform/src/modules/reliability/inbox/inbox.types.ts" sequence="1" -->
