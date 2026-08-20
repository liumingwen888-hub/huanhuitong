import type {
  SignerPolicySnapshot,
  Uid,
  WithdrawalApprovalSnapshot,
  WithdrawalOrderSnapshot,
  WithdrawalOrderStatus
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import { WithdrawalError } from '../domain/withdrawal.errors.js';
import type {
  CreateWithdrawalOrderInput,
  InsertSignerPolicyInput,
  RecordApprovalInput,
  SignerPolicyRepository,
  WithdrawalApprovalRepository,
  WithdrawalOrderRepository
} from '../application/withdrawal.repository.js';

interface WithdrawalRow {
  withdrawal_id: string;
  order_ref: string;
  uid: string;
  asset_code: string;
  amount: string;
  fee_amount: string;
  destination_address: string;
  status: string;
  ledger_transaction_id: string;
  settlement_ledger_transaction_id: string | null;
  broadcast_txid: string | null;
  approver_admin_id: string | null;
  rejection_reason: string | null;
  failure_reason: string | null;
  created_at: Date;
}

function toWithdrawalSnapshot(row: WithdrawalRow): WithdrawalOrderSnapshot {
  return Object.freeze({
    withdrawalId: row.withdrawal_id,
    orderRef: row.order_ref,
    uid: row.uid as Uid,
    assetCode: row.asset_code,
    amount: row.amount,
    feeAmount: row.fee_amount,
    destinationAddress: row.destination_address,
    status: row.status as WithdrawalOrderStatus,
    freezeLedgerTransactionId: row.ledger_transaction_id,
    settlementLedgerTransactionId: row.settlement_ledger_transaction_id,
    broadcastTxid: row.broadcast_txid,
    approverAdminId: row.approver_admin_id,
    rejectionReason: row.rejection_reason,
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString()
  });
}

const WITHDRAWAL_SELECT = `SELECT withdrawal_id, order_ref, uid, asset_code,
  amount::text AS amount, fee_amount::text AS fee_amount,
  destination_address, status, ledger_transaction_id::text
    AS ledger_transaction_id,
  settlement_ledger_transaction_id::text
    AS settlement_ledger_transaction_id,
  broadcast_txid, approver_admin_id::text AS approver_admin_id,
  rejection_reason, failure_reason, created_at FROM withdrawal_orders`;

export class PostgresWithdrawalOrderRepository
  implements WithdrawalOrderRepository
{
  public async createOrder(
    context: TransactionContext,
    input: CreateWithdrawalOrderInput
  ): Promise<WithdrawalOrderSnapshot> {
    const existing = await context.executeSql<WithdrawalRow>(
      `${WITHDRAWAL_SELECT} WHERE order_ref = $1`,
      [input.orderRef]
    );
    if (existing.rows.length > 0) {
      return toWithdrawalSnapshot(existing.rows[0]!);
    }
    const inserted = await context.executeSql<WithdrawalRow>(
      `INSERT INTO withdrawal_orders
         (order_ref, uid, asset_code, amount, fee_amount,
          destination_address, ledger_transaction_id)
       VALUES ($1, $2::uuid, $3, $4::bigint, $5::bigint, $6, $7::uuid)
       ON CONFLICT (order_ref) DO NOTHING
       RETURNING withdrawal_id, order_ref, uid, asset_code,
         amount::text AS amount, fee_amount::text AS fee_amount,
         destination_address, status, ledger_transaction_id::text
           AS ledger_transaction_id,
         settlement_ledger_transaction_id::text
           AS settlement_ledger_transaction_id,
         broadcast_txid, approver_admin_id::text AS approver_admin_id,
         rejection_reason, failure_reason, created_at`,
      [
        input.orderRef,
        input.uid,
        input.assetCode,
        input.amount,
        input.feeAmount,
        input.destinationAddress,
        input.freezeLedgerTransactionId
      ]
    );
    if (inserted.rows.length === 1) {
      return toWithdrawalSnapshot(inserted.rows[0]!);
    }
    const raced = await context.executeSql<WithdrawalRow>(
      `${WITHDRAWAL_SELECT} WHERE order_ref = $1`,
      [input.orderRef]
    );
    return toWithdrawalSnapshot(raced.rows[0]!);
  }

  public async findByOrderRef(
    context: TransactionContext,
    orderRef: string
  ): Promise<WithdrawalOrderSnapshot | null> {
    const result = await context.executeSql<WithdrawalRow>(
      `${WITHDRAWAL_SELECT} WHERE order_ref = $1`,
      [orderRef]
    );
    return result.rows[0] ? toWithdrawalSnapshot(result.rows[0]) : null;
  }

  public async findById(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<WithdrawalOrderSnapshot | null> {
    const result = await context.executeSql<WithdrawalRow>(
      `${WITHDRAWAL_SELECT} WHERE withdrawal_id = $1::uuid`,
      [withdrawalId]
    );
    return result.rows[0] ? toWithdrawalSnapshot(result.rows[0]) : null;
  }

  public async markPendingApproval(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<boolean> {
    const result = await transition(
      context,
      `UPDATE withdrawal_orders SET status = 'PENDING_APPROVAL',
         updated_at = clock_timestamp()
       WHERE withdrawal_id = $1::uuid AND status = 'FROZEN'
       RETURNING withdrawal_id`,
      [withdrawalId]
    );
    return result;
  }

  public async markApproved(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<boolean> {
    const result = await transition(
      context,
      `UPDATE withdrawal_orders SET status = 'APPROVED',
         updated_at = clock_timestamp()
       WHERE withdrawal_id = $1::uuid
         AND status IN ('FROZEN', 'PENDING_APPROVAL')
       RETURNING withdrawal_id`,
      [withdrawalId]
    );
    return result;
  }

  public async markSigning(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<boolean> {
    const result = await transition(
      context,
      `UPDATE withdrawal_orders SET status = 'SIGNING',
         updated_at = clock_timestamp()
       WHERE withdrawal_id = $1::uuid AND status = 'APPROVED'
       RETURNING withdrawal_id`,
      [withdrawalId]
    );
    return result;
  }

  public async markBroadcast(
    context: TransactionContext,
    input: { withdrawalId: string; broadcastTxid: string }
  ): Promise<boolean> {
    const result = await transition(
      context,
      `UPDATE withdrawal_orders SET status = 'BROADCAST',
         broadcast_txid = $2, updated_at = clock_timestamp()
       WHERE withdrawal_id = $1::uuid AND status = 'SIGNING'
       RETURNING withdrawal_id`,
      [input.withdrawalId, input.broadcastTxid]
    );
    return result;
  }

  public async markConfirmed(
    context: TransactionContext,
    input: { withdrawalId: string; settlementLedgerTransactionId: string }
  ): Promise<boolean> {
    const result = await transition(
      context,
      `UPDATE withdrawal_orders SET status = 'CONFIRMED',
         settlement_ledger_transaction_id = $2::uuid,
         updated_at = clock_timestamp()
       WHERE withdrawal_id = $1::uuid AND status = 'BROADCAST'
       RETURNING withdrawal_id`,
      [input.withdrawalId, input.settlementLedgerTransactionId]
    );
    return result;
  }

  public async markRejected(
    context: TransactionContext,
    input: { withdrawalId: string; approverAdminId: string; reason: string }
  ): Promise<boolean> {
    const result = await transition(
      context,
      `UPDATE withdrawal_orders SET status = 'REJECTED',
         approver_admin_id = $2::uuid, rejection_reason = $3,
         updated_at = clock_timestamp()
       WHERE withdrawal_id = $1::uuid AND status = 'PENDING_APPROVAL'
       RETURNING withdrawal_id`,
      [input.withdrawalId, input.approverAdminId, input.reason]
    );
    return result;
  }

  public async markFailed(
    context: TransactionContext,
    input: { withdrawalId: string; reason: string }
  ): Promise<boolean> {
    const result = await transition(
      context,
      `UPDATE withdrawal_orders SET status = 'FAILED',
         failure_reason = $2, updated_at = clock_timestamp()
       WHERE withdrawal_id = $1::uuid AND status IN ('SIGNING', 'BROADCAST')
       RETURNING withdrawal_id`,
      [input.withdrawalId, input.reason]
    );
    return result;
  }

  public async markExpired(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<boolean> {
    const result = await transition(
      context,
      `UPDATE withdrawal_orders SET status = 'EXPIRED',
         updated_at = clock_timestamp()
       WHERE withdrawal_id = $1::uuid
         AND status IN ('FROZEN', 'PENDING_APPROVAL')
       RETURNING withdrawal_id`,
      [withdrawalId]
    );
    return result;
  }

  public async markRefunded(
    context: TransactionContext,
    input: { withdrawalId: string; settlementLedgerTransactionId: string }
  ): Promise<boolean> {
    const result = await transition(
      context,
      `UPDATE withdrawal_orders SET status = 'REFUNDED',
         settlement_ledger_transaction_id = $2::uuid,
         updated_at = clock_timestamp()
       WHERE withdrawal_id = $1::uuid
         AND status IN ('REJECTED', 'FAILED', 'EXPIRED')
       RETURNING withdrawal_id`,
      [input.withdrawalId, input.settlementLedgerTransactionId]
    );
    return result;
  }

  public async findByStatuses(
    context: TransactionContext,
    input: { readonly statuses: readonly string[]; readonly limit: number }
  ): Promise<readonly WithdrawalOrderSnapshot[]> {
    const result = await context.executeSql<WithdrawalRow>(
      `${WITHDRAWAL_SELECT}
       WHERE status = ANY($1::text[])
       ORDER BY created_at
       LIMIT $2`,
      [input.statuses, input.limit]
    );
    return result.rows.map(toWithdrawalSnapshot);
  }

  public async findPendingApprovals(
    context: TransactionContext,
    limit: number
  ): Promise<readonly WithdrawalOrderSnapshot[]> {
    const result = await context.executeSql<WithdrawalRow>(
      `${WITHDRAWAL_SELECT}
       WHERE status = 'PENDING_APPROVAL'
       ORDER BY created_at
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(toWithdrawalSnapshot);
  }

  public async findExpirable(
    context: TransactionContext,
    input: { readonly staleBefore: Date; readonly limit: number }
  ): Promise<readonly WithdrawalOrderSnapshot[]> {
    const result = await context.executeSql<WithdrawalRow>(
      `${WITHDRAWAL_SELECT}
       WHERE status IN ('FROZEN', 'PENDING_APPROVAL')
         AND created_at < $1
       ORDER BY created_at
       LIMIT $2`,
      [input.staleBefore, input.limit]
    );
    return result.rows.map(toWithdrawalSnapshot);
  }
}

async function transition(
  context: TransactionContext,
  sql: string,
  params: readonly unknown[]
): Promise<boolean> {
  const result = await context.executeSql(sql, params);
  return result.rows.length === 1;
}

interface ApprovalRow {
  approval_id: string;
  withdrawal_id: string;
  admin_id: string;
  level: number;
  decision: string;
  reason: string | null;
  created_at: Date;
}

function toApprovalSnapshot(row: ApprovalRow): WithdrawalApprovalSnapshot {
  return Object.freeze({
    approvalId: row.approval_id,
    withdrawalId: row.withdrawal_id,
    adminId: row.admin_id,
    level: row.level,
    decision: row.decision as 'APPROVE' | 'REJECT',
    reason: row.reason,
    createdAt: row.created_at.toISOString()
  });
}

export class PostgresWithdrawalApprovalRepository
  implements WithdrawalApprovalRepository
{
  public async record(
    context: TransactionContext,
    input: RecordApprovalInput
  ): Promise<WithdrawalApprovalSnapshot> {
    try {
      const result = await context.executeSql<ApprovalRow>(
        `INSERT INTO withdrawal_approvals
           (withdrawal_id, admin_id, level, decision, reason)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5)
         RETURNING approval_id, withdrawal_id::text AS withdrawal_id,
           admin_id::text AS admin_id, level, decision, reason, created_at`,
        [
          input.withdrawalId,
          input.adminId,
          input.level,
          input.decision,
          input.reason ?? null
        ]
      );
      return toApprovalSnapshot(result.rows[0]!);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: unknown }).code === '23505'
      ) {
        throw new WithdrawalError('WITHDRAWAL_DUPLICATE_APPROVAL');
      }
      throw error;
    }
  }

  public async findByWithdrawal(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<readonly WithdrawalApprovalSnapshot[]> {
    const result = await context.executeSql<ApprovalRow>(
      `SELECT approval_id, withdrawal_id::text AS withdrawal_id,
         admin_id::text AS admin_id, level, decision, reason, created_at
       FROM withdrawal_approvals
       WHERE withdrawal_id = $1::uuid ORDER BY created_at`,
      [withdrawalId]
    );
    return result.rows.map(toApprovalSnapshot);
  }

  public async countApproved(
    context: TransactionContext,
    withdrawalId: string
  ): Promise<number> {
    const result = await context.executeSql<{ n: number }>(
      `SELECT count(*)::int AS n FROM withdrawal_approvals
       WHERE withdrawal_id = $1::uuid AND decision = 'APPROVE'`,
      [withdrawalId]
    );
    return result.rows[0]?.n ?? 0;
  }
}

interface PolicyRow {
  policy_version: number;
  network: string;
  hot_wallet_address: string;
  fee_amount: string;
  min_auto_amount: string;
  max_amount: string;
  activated_at: Date;
}

function toPolicySnapshot(row: PolicyRow): SignerPolicySnapshot {
  return Object.freeze({
    policyVersion: row.policy_version,
    network: row.network,
    hotWalletAddress: row.hot_wallet_address,
    feeAmount: row.fee_amount,
    minAutoAmount: row.min_auto_amount,
    maxAmount: row.max_amount,
    activatedAt: row.activated_at.toISOString()
  });
}

const POLICY_COLUMNS = `policy_version, network, hot_wallet_address,
  fee_amount::text AS fee_amount, min_auto_amount::text AS min_auto_amount,
  max_amount::text AS max_amount, activated_at`;

export class PostgresSignerPolicyRepository
  implements SignerPolicyRepository
{
  public async findActive(
    context: TransactionContext,
    network: string
  ): Promise<SignerPolicySnapshot | null> {
    const result = await context.executeSql<PolicyRow>(
      `SELECT ${POLICY_COLUMNS} FROM signer_policies
       WHERE network = $1 ORDER BY policy_version DESC LIMIT 1`,
      [network]
    );
    return result.rows[0] ? toPolicySnapshot(result.rows[0]) : null;
  }

  public async insert(
    context: TransactionContext,
    input: InsertSignerPolicyInput
  ): Promise<SignerPolicySnapshot> {
    const result = await context.executeSql<PolicyRow>(
      `INSERT INTO signer_policies
         (policy_version, network, hot_wallet_address, fee_amount,
          min_auto_amount, max_amount)
       VALUES ($1, $2, $3, $4::bigint, $5::bigint, $6::bigint)
       RETURNING ${POLICY_COLUMNS}`,
      [
        input.policyVersion,
        input.network,
        input.hotWalletAddress,
        input.feeAmount,
        input.minAutoAmount,
        input.maxAmount
      ]
    );
    return toPolicySnapshot(result.rows[0]!);
  }
}
