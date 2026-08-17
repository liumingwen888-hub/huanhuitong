import type { CredentialSessionPurpose } from '@xht/contracts';
import {
  CredentialEntryBuffer,
  CredentialBufferError
} from '../domain/credential-processor.js';

export interface RegistryEntry {
  readonly purpose: CredentialSessionPurpose;
  readonly primary: CredentialEntryBuffer;
  readonly confirmation: CredentialEntryBuffer;
  readonly metadata: {
    operationType?: 'withdrawal' | 'exchange' | 'fiat-payout' | 'security-change';
  };
}

export class CredentialSessionRegistryError extends Error {
  public readonly code:
    | 'SESSION_NOT_IN_MEMORY'
    | 'SESSION_NONCE_REUSED';
  constructor(code: CredentialSessionRegistryError['code']) {
    super(code);
    this.name = 'CredentialSessionRegistryError';
    this.code = code;
  }
}

/**
 * In-process buffer registry for credential sessions. The database stays
 * authoritative: an OPEN row whose buffers are not in this registry (for
 * example after a restart) must never accept further digit input.
 */
export class CredentialSessionRegistry {
  readonly #entries = new Map<
    string,
    RegistryEntry & { readonly usedNonces: Set<string> }
  >();

  public open(sessionId: string, purpose: CredentialSessionPurpose): void {
    if (this.#entries.has(sessionId)) {
      throw new CredentialSessionRegistryError('SESSION_NOT_IN_MEMORY');
    }
    this.#entries.set(sessionId, {
      purpose,
      primary: new CredentialEntryBuffer(),
      confirmation: new CredentialEntryBuffer(),
      metadata: {},
      usedNonces: new Set<string>()
    });
  }

  public get(sessionId: string): RegistryEntry | undefined {
    return this.#entries.get(sessionId);
  }

  public require(sessionId: string): RegistryEntry & {
    readonly usedNonces: ReadonlySet<string>;
  } {
    const entry = this.#entries.get(sessionId);
    if (entry === undefined) {
      throw new CredentialSessionRegistryError('SESSION_NOT_IN_MEMORY');
    }
    return entry as RegistryEntry & { readonly usedNonces: ReadonlySet<string> };
  }

  public consumeNonce(sessionId: string, actionNonce: string): void {
    const entry = this.#entries.get(sessionId);
    if (entry === undefined) {
      throw new CredentialSessionRegistryError('SESSION_NOT_IN_MEMORY');
    }
    if (entry.usedNonces.has(actionNonce)) {
      throw new CredentialSessionRegistryError('SESSION_NONCE_REUSED');
    }
    entry.usedNonces.add(actionNonce);
  }

  public close(sessionId: string): void {
    const entry = this.#entries.get(sessionId);
    if (entry === undefined) return;
    entry.primary.zero();
    entry.confirmation.zero();
    entry.usedNonces.clear();
    this.#entries.delete(sessionId);
  }

  public get size(): number {
    return this.#entries.size;
  }
}

Object.freeze(CredentialSessionRegistry.prototype);
export { CredentialBufferError };
