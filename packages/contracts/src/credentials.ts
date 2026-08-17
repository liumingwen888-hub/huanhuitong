import type { Uid } from './identity.js';

export type PaymentCredentialStatus =
  | 'NOT_SET'
  | 'ACTIVE'
  | 'LOCKED'
  | 'RESET_PENDING'
  | 'COOLDOWN'
  | 'REVOKED';

export type CredentialSessionPurpose =
  | 'credential-setup'
  | 'authorize-payment'
  | 'credential-reset';

export type CredentialSessionStatus =
  | 'OPEN'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED';

export type CredentialOperationType =
  | 'withdrawal'
  | 'exchange'
  | 'fiat-payout'
  | 'security-change';

export interface AuthorizePaymentProofV1 {
  readonly type: 'security.payment-authorized.v1';
  readonly uid: Uid;
  readonly operationType: CredentialOperationType;
  readonly orderRef: string;
  readonly amountSummary: string;
  readonly assetSummary: string;
  readonly expiresAt: string;
  readonly sessionId: string;
}

export interface CredentialPolicySnapshot {
  readonly policyVersion: number;
  readonly minDigits: number;
  readonly maxDigits: number;
  readonly maxFailedAttempts: number;
  readonly lockDurationSeconds: number;
  readonly escalationFactor: number;
  readonly cooldownSeconds: number;
}

export interface PaymentCredentialSnapshot {
  readonly uid: Uid;
  readonly status: PaymentCredentialStatus;
  readonly failedAttempts: number;
  readonly lockedUntil: string | null;
  readonly cooldownUntil: string | null;
}

export type CredentialContractErrorCode =
  | 'CREDENTIAL_COMMAND_INVALID'
  | 'CREDENTIAL_NOT_FOUND'
  | 'CREDENTIAL_STATE_INVALID'
  | 'CREDENTIAL_SESSION_NOT_FOUND'
  | 'CREDENTIAL_SESSION_STATE_INVALID';
