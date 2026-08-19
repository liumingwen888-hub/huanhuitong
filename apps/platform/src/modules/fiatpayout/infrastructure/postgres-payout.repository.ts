import type {
  PayoutOrderSnapshot,
  PayoutOrderStatus,
  ProviderConfigSnapshot
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import type {
  CreatePayoutOrderInput,
  PayoutOrderRepository,
  ProviderConfigRepository
} from '../application/payout.repository.js';

interface PayoutOrderRow {
  payout_order_id: string;
  order_ref: string;
  uid: string;
  source_asset_code: string;
  route: string;
  amount: string;
  fee_amount: string;
  beneficiary_ref: string;
  beneficiary_digest: string;
  status: string;
  provider_id: string;
  provider_config_version: number;
  provider_idempotency_key: string;
  ledger_transaction_id: string;
  settlement_ledger_transaction_id: string | null;
  failure_reason: string | null;
  created_at: Date;
}

function toOrderSnapshot(row: PayoutOrderRow): PayoutOrderSnapshot {
  return Object.freeze({
    payoutOrderId: row.payout_order_id,
    orderRef: row.order_ref,
    uid: row.uid,
    sourceAssetCode: row.source_asset_code,
    route: row.route,
    amount: row.amount,
    feeAmount: row.fee_amount,
    beneficiaryRef: row.beneficiary_ref,
    beneficiaryDigest: row.beneficiary_digest,
    status: row.status as PayoutOrderStatus,
    providerId: row.provider_id,
    providerConfigVersion: row.provider_config_version,
    providerIdempotencyKey: row.provider_idempotency_key,
    freezeLedgerTransactionId: row.ledger_transaction_id,
    settlementLedgerTransactionId: row.settlement_ledger_transaction_id,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString()
  });
}

const ORDER_COLUMNS = `payout_order_id, order_ref, uid, source_asset_code,
  route, amount::text AS amount, fee_amount::text AS fee_amount,
  beneficiary_ref, beneficiary_digest, status, provider_id,
  provider_config_version, provider_idempotency_key,
  ledger_transaction_id::text AS ledger_transaction_id,
  settlement_ledger_transaction_id::text
    AS settlement_ledger_transaction_id,
  failure_reason, created_at`;

const ORDER_SELECT = `SELECT ${ORDER_COLUMNS} FROM payout_orders`;

export class PostgresPayoutOrderRepository implements PayoutOrderRepository {
  public async createOrder(
    context: TransactionContext,
    input: CreatePayoutOrderInput
  ): Promise<PayoutOrderSnapshot> {
    const existing = await context.executeSql<PayoutOrderRow>(
      `${ORDER_SELECT} WHERE order_ref = $1`,
      [input.orderRef]
    );
    if (existing.rows.length > 0) {
      return toOrderSnapshot(existing.rows[0]!);
    }
    const inserted = await context.executeSql<PayoutOrderRow>(
      `INSERT INTO payout_orders
         (order_ref, uid, source_asset_code, route, amount, fee_amount,
          beneficiary_ref, beneficiary_digest, provider_id,
          provider_config_version, provider_idempotency_key,
          ledger_transaction_id)
       VALUES ($1, $2::uuid, $3, $4, $5::bigint, $6::bigint, $7, $8,
               $9, $10, $11, $12::uuid)
       ON CONFLICT (order_ref) DO NOTHING
       RETURNING ${ORDER_COLUMNS}`,
      [
        input.orderRef,
        input.uid,
        input.sourceAssetCode,
        input.route,
        input.amount,
        input.feeAmount,
        input.beneficiaryRef,
        input.beneficiaryDigest,
        input.providerId,
        input.providerConfigVersion,
        input.providerIdempotencyKey,
        input.freezeLedgerTransactionId
      ]
    );
    if (inserted.rows.length === 1) {
      return toOrderSnapshot(inserted.rows[0]!);
    }
    const raced = await context.executeSql<PayoutOrderRow>(
      `${ORDER_SELECT} WHERE order_ref = $1`,
      [input.orderRef]
    );
    return toOrderSnapshot(raced.rows[0]!);
  }

  public async findByOrderRef(
    context: TransactionContext,
    orderRef: string
  ): Promise<PayoutOrderSnapshot | null> {
    const result = await context.executeSql<PayoutOrderRow>(
      `${ORDER_SELECT} WHERE order_ref = $1`,
      [orderRef]
    );
    return result.rows[0] ? toOrderSnapshot(result.rows[0]) : null;
  }

  public async findById(
    context: TransactionContext,
    payoutOrderId: string
  ): Promise<PayoutOrderSnapshot | null> {
    const result = await context.executeSql<PayoutOrderRow>(
      `${ORDER_SELECT} WHERE payout_order_id = $1::uuid`,
      [payoutOrderId]
    );
    return result.rows[0] ? toOrderSnapshot(result.rows[0]) : null;
  }
}

interface ProviderConfigRow {
  provider_id: string;
  config_version: number;
  provider_name: string;
  route: string;
  source_asset_code: string;
  fixed_fee: string;
  min_amount: string;
  max_amount: string;
  callback_secret_ref: string;
  activated_at: Date;
}

function toConfigSnapshot(row: ProviderConfigRow): ProviderConfigSnapshot {
  return Object.freeze({
    providerId: row.provider_id,
    configVersion: row.config_version,
    providerName: row.provider_name,
    route: row.route,
    sourceAssetCode: row.source_asset_code,
    fixedFee: row.fixed_fee,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    callbackSecretRef: row.callback_secret_ref,
    activatedAt: row.activated_at.toISOString()
  });
}

const CONFIG_COLUMNS = `provider_id, config_version, provider_name, route,
  source_asset_code, fixed_fee::text AS fixed_fee,
  min_amount::text AS min_amount, max_amount::text AS max_amount,
  callback_secret_ref, activated_at`;

export class PostgresProviderConfigRepository
  implements ProviderConfigRepository
{
  public async findLatestByProvider(
    context: TransactionContext,
    providerId: string
  ): Promise<ProviderConfigSnapshot | null> {
    const result = await context.executeSql<ProviderConfigRow>(
      `SELECT ${CONFIG_COLUMNS} FROM provider_configs
       WHERE provider_id = $1 ORDER BY config_version DESC LIMIT 1`,
      [providerId]
    );
    return result.rows[0] ? toConfigSnapshot(result.rows[0]) : null;
  }

  public async findLatestByRoute(
    context: TransactionContext,
    route: string
  ): Promise<ProviderConfigSnapshot | null> {
    const result = await context.executeSql<ProviderConfigRow>(
      `SELECT ${CONFIG_COLUMNS} FROM provider_configs
       WHERE route = $1 ORDER BY config_version DESC LIMIT 1`,
      [route]
    );
    return result.rows[0] ? toConfigSnapshot(result.rows[0]) : null;
  }

  public async insert(
    context: TransactionContext,
    input: {
      readonly providerId: string;
      readonly configVersion: number;
      readonly providerName: string;
      readonly route: string;
      readonly sourceAssetCode: string;
      readonly fixedFee: string;
      readonly minAmount: string;
      readonly maxAmount: string;
      readonly callbackSecretRef: string;
    }
  ): Promise<ProviderConfigSnapshot> {
    const result = await context.executeSql<ProviderConfigRow>(
      `INSERT INTO provider_configs
         (provider_id, config_version, provider_name, route,
          source_asset_code, fixed_fee, min_amount, max_amount,
          callback_secret_ref)
       VALUES ($1, $2, $3, $4, $5, $6::bigint, $7::bigint, $8::bigint, $9)
       RETURNING ${CONFIG_COLUMNS}`,
      [
        input.providerId,
        input.configVersion,
        input.providerName,
        input.route,
        input.sourceAssetCode,
        input.fixedFee,
        input.minAmount,
        input.maxAmount,
        input.callbackSecretRef
      ]
    );
    return toConfigSnapshot(result.rows[0]!);
  }
}
