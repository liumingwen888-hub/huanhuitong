import type {
  CredentialSessionPurpose,
  CredentialSessionStatus,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import { CredentialError } from '../domain/credential.errors.js';
import type {
  CreateSessionInput,
  CredentialSessionRepository,
  CredentialSessionRow
} from '../application/credential.repository.js';

export class PostgresCredentialSessionRepository
  implements CredentialSessionRepository
{
  public async createSession(
    context: TransactionContext,
    input: CreateSessionInput
  ): Promise<CredentialSessionRow> {
    if (input.purpose === 'authorize-payment') {
      if (
        input.orderRef === null ||
        input.orderRef === undefined ||
        input.amountSummary === null ||
        input.amountSummary === undefined ||
        input.assetSummary === null ||
        input.assetSummary === undefined
      ) {
        throw new CredentialError('CREDENTIAL_COMMAND_INVALID');
      }
    }
    const result = await context.executeSql<{
      session_id: string;
      expires_at: Date;
    }>(
      `INSERT INTO credential_sessions
         (uid, purpose, status, order_ref, amount_summary, asset_summary,
          action_nonce, expires_at)
       VALUES ($1::uuid, $2, 'OPEN', $3, $4, $5, $6::uuid, $7)
       RETURNING session_id, expires_at`,
      [
        input.uid,
        input.purpose,
        input.orderRef ?? null,
        input.amountSummary ?? null,
        input.assetSummary ?? null,
        input.actionNonce,
        input.expiresAt
      ]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new CredentialError('CREDENTIAL_STATE_INVALID');
    }
    return {
      sessionId: row.session_id,
      uid: input.uid,
      purpose: input.purpose,
      status: 'OPEN',
      orderRef: input.orderRef ?? null,
      amountSummary: input.amountSummary ?? null,
      assetSummary: input.assetSummary ?? null,
      actionNonce: input.actionNonce,
      expiresAt: new Date(row.expires_at).toISOString()
    };
  }

  public async findSession(
    context: TransactionContext,
    sessionId: string
  ): Promise<CredentialSessionRow | null> {
    const result = await context.executeSql<{
      uid: string;
      purpose: string;
      status: string;
      order_ref: string | null;
      amount_summary: string | null;
      asset_summary: string | null;
      action_nonce: string;
      expires_at: Date;
    }>(
      `SELECT uid, purpose, status, order_ref, amount_summary, asset_summary,
              action_nonce, expires_at
         FROM credential_sessions WHERE session_id = $1::uuid`,
      [sessionId]
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      sessionId,
      uid: row.uid as Uid,
      purpose: row.purpose as CredentialSessionPurpose,
      status: row.status as CredentialSessionStatus,
      orderRef: row.order_ref,
      amountSummary: row.amount_summary,
      assetSummary: row.asset_summary,
      actionNonce: row.action_nonce,
      expiresAt: new Date(row.expires_at).toISOString()
    };
  }

  public async hasOpenSession(
    context: TransactionContext,
    uid: Uid
  ): Promise<boolean> {
    const result = await context.executeSql<{ session_id: string }>(
      `SELECT session_id FROM credential_sessions
        WHERE uid = $1::uuid AND status = 'OPEN' LIMIT 1`,
      [uid]
    );
    return result.rows.length > 0;
  }

  public async transitionSession(
    context: TransactionContext,
    sessionId: string,
    from: CredentialSessionStatus,
    to: CredentialSessionStatus
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE credential_sessions
          SET status = $3, resolved_at = clock_timestamp()
        WHERE session_id = $1::uuid AND status = $2
        RETURNING session_id`,
      [sessionId, from, to]
    );
    return result.rows.length === 1;
  }
}
