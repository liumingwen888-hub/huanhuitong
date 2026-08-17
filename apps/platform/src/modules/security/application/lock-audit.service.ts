import type { Uid } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type { CredentialRepository } from './credential.repository.js';

/**
 * Thin audit bridge: lock transitions are recorded in security_locks inside
 * the same transaction that mutates payment_credentials.
 */
export class SecurityLockAuditService {
  readonly #credentials: CredentialRepository;

  constructor(credentials: CredentialRepository) {
    this.#credentials = credentials;
  }

  public onLocked(
    context: TransactionContext,
    uid: Uid,
    reason: 'credential-failed-attempts' | 'recovery-open' | 'admin-hold'
  ): Promise<string> {
    return this.#credentials.recordSecurityLock(context, uid, reason);
  }

  public onReleased(
    context: TransactionContext,
    uid: Uid
  ): Promise<number> {
    return this.#credentials.releaseOpenSecurityLocks(context, uid);
  }
}

Object.freeze(SecurityLockAuditService.prototype);
