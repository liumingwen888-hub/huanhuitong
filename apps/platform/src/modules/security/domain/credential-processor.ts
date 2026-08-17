import { timingSafeEqual } from 'node:crypto';

const MAX_DIGITS = 12;
const DIGIT_PATTERN = /^[0-9]$/u;

export class CredentialBufferError extends Error {
  public readonly code:
    | 'CREDENTIAL_DIGIT_INVALID'
    | 'CREDENTIAL_BUFFER_FULL'
    | 'CREDENTIAL_BUFFER_EMPTY';
  constructor(code: CredentialBufferError['code']) {
    super(code);
    this.name = 'CredentialBufferError';
    this.code = code;
  }
}

/**
 * The only construct in the process that may hold payment-password digits.
 * Digits live in a zeroable byte buffer; borrowing zeroes the buffer in a
 * finally block, so no plaintext survives a completed operation.
 */
export class CredentialEntryBuffer {
  #bytes: Uint8Array = new Uint8Array(0);

  public get length(): number {
    return this.#bytes.length;
  }

  public appendDigit(character: unknown): number {
    if (
      typeof character !== 'string' ||
      !DIGIT_PATTERN.test(character)
    ) {
      this.zero();
      throw new CredentialBufferError('CREDENTIAL_DIGIT_INVALID');
    }
    if (this.#bytes.length >= MAX_DIGITS) {
      this.zero();
      throw new CredentialBufferError('CREDENTIAL_BUFFER_FULL');
    }
    const grown = new Uint8Array(this.#bytes.length + 1);
    grown.set(this.#bytes);
    grown[this.#bytes.length] = character.charCodeAt(0);
    this.#bytes.fill(0);
    this.#bytes = grown;
    return this.#bytes.length;
  }

  public zero(): void {
    this.#bytes.fill(0);
    this.#bytes = new Uint8Array(0);
  }

  public async withBytes<T>(
    consumer: (bytes: Uint8Array) => T | Promise<T>
  ): Promise<T> {
    if (this.#bytes.length === 0) {
      throw new CredentialBufferError('CREDENTIAL_BUFFER_EMPTY');
    }
    try {
      return await consumer(this.#bytes);
    } finally {
      this.#bytes.fill(0);
      this.#bytes = new Uint8Array(0);
    }
  }

  public snapshotEquals(other: CredentialEntryBuffer): boolean {
    if (this.#bytes.length === 0 || other.#bytes.length === 0) return false;
    if (this.#bytes.length !== other.#bytes.length) return false;
    return timingSafeEqual(this.#bytes, other.#bytes);
  }
}

Object.freeze(CredentialEntryBuffer.prototype);

export class CredentialProcessor {
  readonly primary: CredentialEntryBuffer = new CredentialEntryBuffer();
  readonly confirmation: CredentialEntryBuffer = new CredentialEntryBuffer();

  public entriesMatch(): boolean {
    return this.primary.snapshotEquals(this.confirmation);
  }

  public reset(): void {
    this.primary.zero();
    this.confirmation.zero();
  }

  public async withPrimaryDigits<T>(
    consumer: (bytes: Uint8Array) => T | Promise<T>
  ): Promise<T> {
    return this.primary.withBytes(consumer);
  }
}

Object.freeze(CredentialProcessor);
Object.freeze(CredentialProcessor.prototype);
