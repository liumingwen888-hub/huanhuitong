export type PayoutOrderStatus =
  | 'FUNDS_RESERVED'
  | 'SUBMITTING'
  | 'ACCEPTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'REFUNDED'
  | 'REVERSED';

export interface PayoutOrderSnapshot {
  readonly payoutOrderId: string;
  readonly orderRef: string;
  readonly uid: string;
  readonly sourceAssetCode: string;
  readonly route: string;
  readonly amount: string;
  readonly feeAmount: string;
  readonly beneficiaryRef: string;
  readonly beneficiaryDigest: string;
  readonly status: PayoutOrderStatus;
  readonly providerId: string;
  readonly providerConfigVersion: number;
  readonly providerIdempotencyKey: string;
  readonly freezeLedgerTransactionId: string;
  readonly settlementLedgerTransactionId: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
}

export interface ProviderConfigSnapshot {
  readonly providerId: string;
  readonly configVersion: number;
  readonly providerName: string;
  readonly route: string;
  readonly sourceAssetCode: string;
  readonly fixedFee: string;
  readonly minAmount: string;
  readonly maxAmount: string;
  readonly callbackSecretRef: string;
  readonly activatedAt: string;
}

export type PayoutContractErrorCode =
  | 'PAYOUT_COMMAND_INVALID'
  | 'PAYOUT_ORDER_NOT_FOUND'
  | 'PAYOUT_INVALID_TRANSITION'
  | 'PAYOUT_PROVIDER_CONFIG_NOT_FOUND'
  | 'PAYOUT_AMOUNT_OUT_OF_RANGE'
  | 'PAYOUT_INSUFFICIENT_FUNDS'
  | 'PAYOUT_RISK_DENIED'
  | 'PAYOUT_ALREADY_REQUESTED'
  | 'PAYOUT_PROVIDER_UNAVAILABLE'
  | 'PAYOUT_CALLBACK_VERIFICATION_FAILED'
  | 'PAYOUT_CALLBACK_REPLAY'
  | 'PAYOUT_UNKNOWN_PENDING_QUERY';

export interface PayoutCapabilitySnapshot {
  readonly providerId: string;
  readonly configVersion: number;
  readonly providerName: string;
  readonly route: string;
  readonly sourceAssetCode: string;
  readonly fixedFee: string;
  readonly minAmount: string;
  readonly maxAmount: string;
}

export interface PayoutQuoteSnapshot {
  readonly providerId: string;
  readonly configVersion: number;
  readonly route: string;
  readonly sourceAssetCode: string;
  readonly sourceAmount: string;
  readonly fee: string;
  readonly estimatedFiat: string;
  readonly estimate: true;
}
