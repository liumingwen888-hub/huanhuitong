import type { MarketDirectionSnapshot } from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type {
  InsertMarketConfigInput,
  MarketRepository
} from '../application/market.repository.js';

interface MarketRow {
  market_key: string;
  config_version: number;
  sell_asset_code: string;
  buy_asset_code: string;
  quote_scale: number;
  spread_bp: number;
  min_sell_amount: string;
  max_sell_amount: string;
  quote_ttl_seconds: number;
  deviation_tolerance_bp: number;
  activated_at: Date;
}

function toSnapshot(row: MarketRow): MarketDirectionSnapshot {
  return Object.freeze({
    marketKey: row.market_key,
    configVersion: row.config_version,
    sellAssetCode: row.sell_asset_code,
    buyAssetCode: row.buy_asset_code,
    quoteScale: row.quote_scale,
    spreadBp: row.spread_bp,
    minSellAmount: row.min_sell_amount,
    maxSellAmount: row.max_sell_amount,
    quoteTtlSeconds: row.quote_ttl_seconds,
    deviationToleranceBp: row.deviation_tolerance_bp,
    activatedAt: row.activated_at.toISOString()
  });
}

const MARKET_COLUMNS = `market_key, config_version, sell_asset_code,
  buy_asset_code, quote_scale, spread_bp, min_sell_amount::text
    AS min_sell_amount, max_sell_amount::text AS max_sell_amount,
  quote_ttl_seconds, deviation_tolerance_bp, activated_at`;

export class PostgresMarketRepository implements MarketRepository {
  public async findActive(
    context: TransactionContext,
    marketKey: string
  ): Promise<MarketDirectionSnapshot | null> {
    const result = await context.executeSql<MarketRow>(
      `SELECT ${MARKET_COLUMNS} FROM market_configs
       WHERE market_key = $1 ORDER BY config_version DESC LIMIT 1`,
      [marketKey]
    );
    return result.rows[0] ? toSnapshot(result.rows[0]) : null;
  }

  public async listActive(
    context: TransactionContext
  ): Promise<readonly MarketDirectionSnapshot[]> {
    const result = await context.executeSql<MarketRow>(
      `SELECT DISTINCT ON (market_key) ${MARKET_COLUMNS}
         FROM market_configs
        ORDER BY market_key, config_version DESC`
    );
    return result.rows.map(toSnapshot);
  }

  public async insert(
    context: TransactionContext,
    input: InsertMarketConfigInput
  ): Promise<MarketDirectionSnapshot> {
    const result = await context.executeSql<MarketRow>(
      `INSERT INTO market_configs
         (market_key, config_version, sell_asset_code, buy_asset_code,
          quote_scale, spread_bp, min_sell_amount, max_sell_amount,
          quote_ttl_seconds, deviation_tolerance_bp)
       VALUES ($1, $2, $3, $4, $5, $6, $7::bigint, $8::bigint, $9, $10)
       RETURNING ${MARKET_COLUMNS}`,
      [
        input.marketKey,
        input.configVersion,
        input.sellAssetCode,
        input.buyAssetCode,
        input.quoteScale,
        input.spreadBp,
        input.minSellAmount,
        input.maxSellAmount,
        input.quoteTtlSeconds,
        input.deviationToleranceBp
      ]
    );
    return toSnapshot(result.rows[0]!);
  }
}
