import type { AdminSessionSnapshot } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type {
  AdminSessionRepository,
  InsertAdminSessionInput
} from '../application/admin-session.repository.js';

interface SessionRow {
  session_id: string;
  admin_id: string;
  created_at: Date;
  expires_at: Date;
  elevated_until: Date | null;
  revoked_at: Date | null;
}

function toSnapshot(row: SessionRow): AdminSessionSnapshot {
  return Object.freeze({
    sessionId: row.session_id,
    adminId: row.admin_id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    elevatedUntil: row.elevated_until?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null
  });
}

const SESSION_COLUMNS = `session_id, admin_id, created_at, expires_at,
  elevated_until, revoked_at`;

export class PostgresAdminSessionRepository
  implements AdminSessionRepository
{
  public async insert(
    context: TransactionContext,
    input: InsertAdminSessionInput
  ): Promise<AdminSessionSnapshot> {
    const result = await context.executeSql<SessionRow>(
      `INSERT INTO admin_sessions (admin_id, token_hash, expires_at)
       VALUES ($1::uuid, $2, $3)
       RETURNING ${SESSION_COLUMNS}`,
      [input.adminId, input.tokenHash, input.expiresAt]
    );
    return toSnapshot(result.rows[0]!);
  }

  public async findByTokenHash(
    context: TransactionContext,
    tokenHash: string
  ): Promise<AdminSessionSnapshot | null> {
    const result = await context.executeSql<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM admin_sessions
       WHERE token_hash = $1`,
      [tokenHash]
    );
    return result.rows[0] ? toSnapshot(result.rows[0]) : null;
  }

  public async revoke(
    context: TransactionContext,
    input: { readonly sessionId: string }
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE admin_sessions SET revoked_at = clock_timestamp()
        WHERE session_id = $1::uuid AND revoked_at IS NULL
        RETURNING session_id`,
      [input.sessionId]
    );
    return result.rows.length === 1;
  }

  public async revokeByTokenHash(
    context: TransactionContext,
    tokenHash: string
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE admin_sessions SET revoked_at = clock_timestamp()
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING session_id`,
      [tokenHash]
    );
    return result.rows.length === 1;
  }

  public async elevate(
    context: TransactionContext,
    input: { readonly sessionId: string; readonly elevatedUntil: Date }
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE admin_sessions SET elevated_until = $2
        WHERE session_id = $1::uuid AND revoked_at IS NULL
        RETURNING session_id`,
      [input.sessionId, input.elevatedUntil]
    );
    return result.rows.length === 1;
  }

  public async elevateByTokenHash(
    context: TransactionContext,
    input: { readonly tokenHash: string; readonly elevatedUntil: Date }
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE admin_sessions SET elevated_until = $2
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING session_id`,
      [input.tokenHash, input.elevatedUntil]
    );
    return result.rows.length === 1;
  }
}
