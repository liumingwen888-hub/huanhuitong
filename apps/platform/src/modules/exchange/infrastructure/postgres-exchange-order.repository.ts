import type {
  ExchangeOrderSnapshot,
  ExchangeOrderStatus
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type {
  CreateExchangeOrderInput,
  ExchangeOrderRepository
} from '../application/exchange-order.repository.js';

interface ExchangeOrderRow {
  exchange_order_id: string;
  order_ref: string;
  uid: string;
  quote_id: string;
  market_key: string;
  config_version: number;
  sell_asset_code: string;
  buy_asset_code: string;
  sell_amount: string;
  buy_amount: string;
  status: string;
  ledger_transaction_id: string;
  settlement_ledger_transaction_id: string | null;
  failure_reason: string | null;
  created_at: Date;
}

function toSnapshot(row: ExchangeOrderRow): ExchangeOrderSnapshot {
  return Object.freeze({
    exchangeOrderId: row.exchange_order_id,
    orderRef: row.order_ref,
    uid: row.uid,
    quoteId: row.quote_id,
    marketKey: row.market_key,
    configVersion: row.config_version,
    sellAssetCode: row.sell_asset_code,
    buyAssetCode: row.buy_asset_code,
    sellAmount: row.sell_amount,
    buyAmount: row.buy_amount,
    status: row.status as ExchangeOrderStatus,
    freezeLedgerTransactionId: row.ledger_transaction_id,
    settlementLedgerTransactionId: row.settlement_ledger_transaction_id,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString()
  });
}

const ORDER_COLUMNS = `exchange_order_id, order_ref, uid, quote_id,
  market_key, config_version, sell_asset_code, buy_asset_code,
  sell_amount::text AS sell_amount, buy_amount::text AS buy_amount,
  status, ledger_transaction_id::text AS ledger_transaction_id,
  settlement_ledger_transaction_id::text
    AS settlement_ledger_transaction_id,
  failure_reason, created_at`;

export class PostgresExchangeOrderRepository
  implements ExchangeOrderRepository
{
  public async createOrder(
    context: TransactionContext,
    input: CreateExchangeOrderInput
  ): Promise<ExchangeOrderSnapshot> {
    const result = await context.executeSql<ExchangeOrderRow>(
      `INSERT INTO exchange_orders
         (order_ref, uid, quote_id, market_key, config_version,
          sell_asset_code, buy_asset_code, sell_amount, buy_amount,
          ledger_transaction_id)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7,
               $8::bigint, $9::bigint, $10::uuid)
       RETURNING ${ORDER_COLUMNS}`,
      [
        input.orderRef,
        input.uid,
        input.quoteId,
        input.marketKey,
        input.configVersion,
        input.sellAssetCode,
        input.buyAssetCode,
        input.sellAmount,
        input.buyAmount,
        input.freezeLedgerTransactionId
      ]
    );
    return toSnapshot(result.rows[0]!);
  }

  public async findByQuote(
    context: TransactionContext,
    quoteId: string
  ): Promise<ExchangeOrderSnapshot | null> {
    const result = await context.executeSql<ExchangeOrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM exchange_orders
       WHERE quote_id = $1::uuid`,
      [quoteId]
    );
    return result.rows[0] ? toSnapshot(result.rows[0]) : null;
  }

  public async findById(
    context: TransactionContext,
    exchangeOrderId: string
  ): Promise<ExchangeOrderSnapshot | null> {
    const result = await context.executeSql<ExchangeOrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM exchange_orders
       WHERE exchange_order_id = $1::uuid`,
      [exchangeOrderId]
    );
    return result.rows[0] ? toSnapshot(result.rows[0]) : null;
  }
}
