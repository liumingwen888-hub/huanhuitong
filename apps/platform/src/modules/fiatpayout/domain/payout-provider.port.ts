export interface ProviderSubmitInput {
  readonly providerIdempotencyKey: string;
  readonly route: string;
  readonly sourceAssetCode: string;
  readonly amount: string;
  readonly estimatedFiat: string;
  readonly beneficiaryRef: string;
  readonly beneficiaryDigest: string;
}

export interface ProviderSubmitAccepted {
  readonly status: 'ACCEPTED';
}

export interface ProviderSubmitRejected {
  readonly status: 'REJECTED';
  readonly reasonCode: string;
}

export type ProviderSubmitResult =
  | ProviderSubmitAccepted
  | ProviderSubmitRejected;

export type ProviderQueryStatus =
  | 'ACCEPTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN';

export interface ProviderQueryResult {
  readonly status: ProviderQueryStatus;
}

/**
 * The only payout-provider surface the fiatpayout domain may depend
 * on. A throwing submit means the outcome is UNKNOWN — callers must
 * not infer failure and must never create a second payment; retries
 * replay the same idempotency key, which providers deduplicate.
 */
export interface PayoutProviderPort {
  submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult>;
  query(providerIdempotencyKey: string): Promise<ProviderQueryResult>;
}
