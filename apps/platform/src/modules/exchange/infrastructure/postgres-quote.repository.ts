import type { QuoteSnapshot, QuoteStatus } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type {
  InsertQuoteInput,
  QuoteRepository
} from '../application/quote.repository.js';

interface QuoteRow {
  quote_id: string;
  market_key: string;
  config_version: number;
  sell_amount: string;
  reference_rate: string;
  buy_amount: string;
  source_id: string;
  status: string;
  expires_at: Date;
  created_at: Date;
}

function toSnapshot(row: QuoteRow): QuoteSnapshot {
  return Object.freeze({
    quoteId: row.quote_id,
    marketKey: row.market_key,
    configVersion: row.config_version,
    sellAmount: row.sell_amount,
    referenceRate: row.reference_rate,
    buyAmount: row.buy_amount,
    sourceId: row.source_id,
    status: row.status as QuoteStatus,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString()
  });
}

const QUOTE_COLUMNS = `quote_id, market_key, config_version,
  sell_amount::text AS sell_amount, reference_rate,
  buy_amount::text AS buy_amount, source_id, status, expires_at, created_at`;

export class PostgresQuoteRepository implements QuoteRepository {
  public async insert(
    context: TransactionContext,
    input: InsertQuoteInput
  ): Promise<QuoteSnapshot> {
    const result = await context.executeSql<QuoteRow>(
      `INSERT INTO quotes
         (market_key, config_version, sell_amount, reference_rate,
          buy_amount, source_id, expires_at)
       VALUES ($1, $2, $3::bigint, $4, $5::bigint, $6, $7)
       RETURNING ${QUOTE_COLUMNS}`,
      [
        input.marketKey,
        input.configVersion,
        input.sellAmount,
        input.referenceRate,
        input.buyAmount,
        input.sourceId,
        input.expiresAt
      ]
    );
    return toSnapshot(result.rows[0]!);
  }

  public async findById(
    context: TransactionContext,
    quoteId: string
  ): Promise<QuoteSnapshot | null> {
    const result = await context.executeSql<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS} FROM quotes WHERE quote_id = $1::uuid`,
      [quoteId]
    );
    return result.rows[0] ? toSnapshot(result.rows[0]) : null;
  }

  public async consumeActive(
    context: TransactionContext,
    quoteId: string
  ): Promise<QuoteSnapshot | null> {
    const result = await context.executeSql<QuoteRow>(
      `UPDATE quotes SET status = 'CONSUMED'
        WHERE quote_id = $1::uuid
          AND status = 'ACTIVE'
          AND expires_at > clock_timestamp()
        RETURNING ${QUOTE_COLUMNS}`,
      [quoteId]
    );
    return result.rows[0] ? toSnapshot(result.rows[0]) : null;
  }

  public async expireElapsed(
    context: TransactionContext,
    limit: number
  ): Promise<readonly string[]> {
    const result = await context.executeSql<{ quote_id: string }>(
      `UPDATE quotes SET status = 'EXPIRED'
        WHERE quote_id IN (
          SELECT quote_id FROM quotes
            WHERE status = 'ACTIVE' AND expires_at <= clock_timestamp()
            ORDER BY expires_at LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING quote_id::text AS quote_id`,
      [limit]
    );
    return result.rows.map((row) => row.quote_id);
  }
}
