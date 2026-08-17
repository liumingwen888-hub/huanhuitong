import type {
  CredentialPolicySnapshot,
  CredentialSessionPurpose,
  CredentialSessionStatus,
  PaymentCredentialSnapshot,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export interface UpsertCredentialInput {
  readonly uid: Uid;
  readonly hashV1: string;
  readonly hashAlgorithm: 'argon2id';
  readonly hashParamVersion: number;
}

export interface CredentialSessionRow {
  readonly sessionId: string;
  readonly uid: Uid;
  readonly purpose: CredentialSessionPurpose;
  readonly status: CredentialSessionStatus;
  readonly orderRef: string | null;
  readonly amountSummary: string | null;
  readonly assetSummary: string | null;
  readonly actionNonce: string;
  readonly expiresAt: string;
}

export interface CreateSessionInput {
  readonly uid: Uid;
  readonly purpose: CredentialSessionPurpose;
  readonly orderRef?: string | null;
  readonly amountSummary?: string | null;
  readonly assetSummary?: string | null;
  readonly actionNonce: string;
  readonly expiresAt: Date;
}

export interface CredentialRepository {
  findCredential(
    context: TransactionContext,
    uid: Uid
  ): Promise<PaymentCredentialSnapshot | null>;
  upsertActiveCredential(
    context: TransactionContext,
    input: UpsertCredentialInput
  ): Promise<void>;
  recordFailedAttempt(
    context: TransactionContext,
    uid: Uid,
    lockUntil: Date | null
  ): Promise<number>;
  activePolicy(
    context: TransactionContext
  ): Promise<CredentialPolicySnapshot>;
}

export interface CredentialSessionRepository {
  createSession(
    context: TransactionContext,
    input: CreateSessionInput
  ): Promise<CredentialSessionRow>;
  findSession(
    context: TransactionContext,
    sessionId: string
  ): Promise<CredentialSessionRow | null>;
  transitionSession(
    context: TransactionContext,
    sessionId: string,
    from: CredentialSessionStatus,
    to: CredentialSessionStatus
  ): Promise<boolean>;
}
