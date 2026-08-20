import type { AdminSessionSnapshot } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';

export interface InsertAdminSessionInput {
  readonly adminId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface AdminSessionRepository {
  insert(
    context: TransactionContext,
    input: InsertAdminSessionInput
  ): Promise<AdminSessionSnapshot>;
  findByTokenHash(
    context: TransactionContext,
    tokenHash: string
  ): Promise<AdminSessionSnapshot | null>;
  revoke(
    context: TransactionContext,
    input: { readonly sessionId: string }
  ): Promise<boolean>;
  elevate(
    context: TransactionContext,
    input: { readonly sessionId: string; readonly elevatedUntil: Date }
  ): Promise<boolean>;
  revokeByTokenHash(
    context: TransactionContext,
    tokenHash: string
  ): Promise<boolean>;
  elevateByTokenHash(
    context: TransactionContext,
    input: { readonly tokenHash: string; readonly elevatedUntil: Date }
  ): Promise<boolean>;
}
