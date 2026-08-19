import type {
  PayoutProviderPort,
  ProviderQueryResult,
  ProviderSubmitInput,
  ProviderSubmitResult
} from './payout-provider.port.js';

/**
 * Configurable fake payout provider: submissions are deduplicated by
 * the provider idempotency key — a replayed key returns the FIRST
 * outcome and never creates a second payment. This mirrors the
 * idempotency contract real provider adapters must implement and is
 * the third layer of the double-pay defense.
 */
export class FakeBankProvider implements PayoutProviderPort {
  readonly #results = new Map<string, ProviderSubmitResult>();
  readonly #queryStates = new Map<string, ProviderQueryResult>();
  readonly submits: ProviderSubmitInput[] = [];
  #defaultResult: ProviderSubmitResult = { status: 'ACCEPTED' };
  #shouldThrow = false;

  public setDefaultResult(result: ProviderSubmitResult): void {
    this.#defaultResult = result;
  }

  public setShouldThrow(shouldThrow: boolean): void {
    this.#shouldThrow = shouldThrow;
  }

  public setQueryState(
    providerIdempotencyKey: string,
    result: ProviderQueryResult
  ): void {
    this.#queryStates.set(providerIdempotencyKey, result);
  }

  public async submit(
    input: ProviderSubmitInput
  ): Promise<ProviderSubmitResult> {
    this.submits.push(input);
    if (this.#shouldThrow) {
      throw new Error('PROVIDER_OUTCOME_UNKNOWN');
    }
    const existing = this.#results.get(input.providerIdempotencyKey);
    if (existing !== undefined) {
      return existing;
    }
    const result = this.#defaultResult;
    this.#results.set(input.providerIdempotencyKey, result);
    return result;
  }

  public async query(
    providerIdempotencyKey: string
  ): Promise<ProviderQueryResult> {
    return this.#queryStates.get(providerIdempotencyKey) ??
      { status: 'UNKNOWN' };
  }

  /** number of logically distinct submissions (deduplicated) */
  public get distinctSubmissions(): number {
    return this.#results.size;
  }
}

Object.freeze(FakeBankProvider.prototype);
