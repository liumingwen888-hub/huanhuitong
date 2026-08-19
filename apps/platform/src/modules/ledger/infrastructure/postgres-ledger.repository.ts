import { randomUUID } from 'node:crypto';
import type {
  LedgerAccountId,
  LedgerAccountPurpose,
  PostMoneyCommand,
  Uid
} from '@xht/contracts';
import type { TransactionContext } from '../../../infrastructure/database/transaction-context.js';
import { LedgerError } from '../domain/ledger.errors.js';
import type {
  LedgerAccountRepository,
  LedgerAccountSnapshot,
  LedgerTransactionRepository,
  OpenAccountInput
} from '../application/ledger.repository.js';

interface AccountRow {
  account_id: string;
  owner_uid: string | null;
  asset_code: string;
  purpose: string;
  status: string;
  version: number;
}

function snapshot(row: AccountRow): LedgerAccountSnapshot {
  return Object.freeze({
    accountId: row.account_id as LedgerAccountId,
    ownerUid: (row.owner_uid as Uid | null) ?? null,
    assetCode: row.asset_code,
    purpose: row.purpose as LedgerAccountPurpose,
    status: row.status as LedgerAccountSnapshot['status'],
    version: row.version
  });
}

const ACCOUNT_SELECT = `SELECT account_id, owner_uid, asset_code, purpose, status, version
         FROM ledger_accounts`;

export class PostgresLedgerAccountRepository implements LedgerAccountRepository {
  public async findAccount(
    context: TransactionContext,
    accountId: LedgerAccountId
  ): Promise<LedgerAccountSnapshot | null> {
    const result = await context.executeSql<AccountRow>(
      `SELECT account_id, owner_uid, asset_code, purpose, status, version
         FROM ledger_accounts WHERE account_id = $1::uuid`,
      [accountId]
    );
    const row = result.rows[0];
    return row === undefined ? null : snapshot(row);
  }

  public async findAccountByOwner(
    context: TransactionContext,
    input: {
      readonly ownerUid: Uid;
      readonly assetCode: string;
      readonly purpose: LedgerAccountPurpose;
    }
  ): Promise<LedgerAccountSnapshot | null> {
    const result = await context.executeSql<AccountRow>(
      `SELECT account_id, owner_uid, asset_code, purpose, status, version
         FROM ledger_accounts
        WHERE owner_uid = $1::uuid AND asset_code = $2 AND purpose = $3
        LIMIT 1`,
      [input.ownerUid, input.assetCode, input.purpose]
    );
    const row = result.rows[0];
    return row === undefined ? null : snapshot(row);
  }

  public async openUserAccount(
    context: TransactionContext,
    input: OpenAccountInput
  ): Promise<LedgerAccountSnapshot> {
    if (
      input.purpose !== 'USER_AVAILABLE' &&
      input.purpose !== 'USER_FROZEN' &&
      input.purpose !== 'USER_IN_TRANSIT'
    ) {
      throw new LedgerError('LEDGER_COMMAND_INVALID');
    }
    const existing = await this.findAccountByOwner(context, {
      ownerUid: input.ownerUid,
      assetCode: input.assetCode,
      purpose: input.purpose
    });
    if (existing !== null) {
      return existing;
    }
    const opened = await context.executeSql<AccountRow>(
      `INSERT INTO ledger_accounts (owner_uid, asset_code, purpose)
       VALUES ($1::uuid, $2, $3)
       ON CONFLICT (owner_uid, asset_code, purpose) DO NOTHING
       RETURNING account_id, owner_uid, asset_code, purpose, status, version`,
      [input.ownerUid, input.assetCode, input.purpose]
    );
    if (opened.rows.length === 1) {
      const row = opened.rows[0]!;
      await context.executeSql(
        `INSERT INTO account_openings
           (owner_uid, asset_code, purpose, idempotency_key, account_id)
         VALUES ($1::uuid, $2, $3, $4, $5::uuid)`,
        [
          input.ownerUid,
          input.assetCode,
          input.purpose,
          input.idempotencyKey,
          row.account_id
        ]
      );
      return snapshot(row);
    }
    const raced = await this.findAccountByOwner(context, {
      ownerUid: input.ownerUid,
      assetCode: input.assetCode,
      purpose: input.purpose
    });
    if (raced === null) {
      throw new LedgerError('LEDGER_ACCOUNT_NOT_FOUND');
    }
    return raced;
  }

  public async lockAccount(
    context: TransactionContext,
    accountId: LedgerAccountId
  ): Promise<LedgerAccountSnapshot | null> {
    const result = await context.executeSql<AccountRow>(
      `${ACCOUNT_SELECT} WHERE account_id = $1::uuid FOR UPDATE`,
      [accountId]
    );
    const row = result.rows[0];
    return row === undefined ? null : snapshot(row);
  }

  public async accountBalance(
    context: TransactionContext,
    accountId: LedgerAccountId
  ): Promise<string> {
    const result = await context.executeSql<{ balance: string }>(
      `SELECT COALESCE(SUM(
         CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END
       ), 0)::text AS balance
         FROM ledger_entries WHERE account_id = $1::uuid`,
      [accountId]
    );
    return result.rows[0]?.balance ?? '0';
  }

  public async bumpAccountVersions(
    context: TransactionContext,
    accountIds: readonly LedgerAccountId[]
  ): Promise<void> {
    if (accountIds.length === 0) return;
    await context.executeSql(
      `UPDATE ledger_accounts SET version = version + 1
        WHERE account_id = ANY($1::uuid[])`,
      [accountIds as unknown[]]
    );
  }

  public async applyProjectionDelta(
    context: TransactionContext,
    input: {
      readonly accountId: LedgerAccountId;
      readonly delta: bigint;
      readonly transactionId: string;
    }
  ): Promise<void> {
    await context.executeSql(
      `INSERT INTO account_balances
         (account_id, signed_balance, last_transaction_id, updated_at)
       VALUES ($1::uuid, $2::bigint, $3::uuid, clock_timestamp())
       ON CONFLICT (account_id) DO UPDATE
         SET signed_balance = account_balances.signed_balance + $2::bigint,
             last_transaction_id = $3::uuid,
             updated_at = clock_timestamp()`,
      [input.accountId, input.delta.toString(), input.transactionId]
    );
  }
  public async upsertProjectionAbsolute(
    context: TransactionContext,
    input: {
      readonly accountId: LedgerAccountId;
      readonly signedBalance: string;
      readonly transactionId: string | null;
    }
  ): Promise<void> {
    await context.executeSql(
      `INSERT INTO account_balances
         (account_id, signed_balance, last_transaction_id, updated_at)
       VALUES ($1::uuid, $2::bigint, $3::uuid, clock_timestamp())
       ON CONFLICT (account_id) DO UPDATE
         SET signed_balance = $2::bigint,
             last_transaction_id = $3::uuid,
             updated_at = clock_timestamp()`,
      [input.accountId, input.signedBalance, input.transactionId]
    );
  }

  public async readProjection(
    context: TransactionContext,
    accountId: LedgerAccountId
  ): Promise<{ readonly signedBalance: string } | null> {
    const result = await context.executeSql<{ signed_balance: string }>(
      `SELECT signed_balance::text AS signed_balance
         FROM account_balances WHERE account_id = $1::uuid`,
      [accountId]
    );
    const row = result.rows[0];
    return row === undefined ? null : { signedBalance: row.signed_balance };
  }

}
export class PostgresLedgerTransactionRepository
  implements LedgerTransactionRepository
{
  public async findTransactionIdByIdempotencyKey(
    context: TransactionContext,
    idempotencyKey: string
  ): Promise<string | null> {
    const result = await context.executeSql<{ transaction_id: string }>(
      `SELECT transaction_id FROM ledger_transactions
        WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    return result.rows[0]?.transaction_id ?? null;
  }

  public async insertPostedTransaction(
    context: TransactionContext,
    command: PostMoneyCommand
  ): Promise<string> {
    const transactionId = randomUUID();
    await context.executeSql(
      `INSERT INTO ledger_transactions
         (transaction_id, idempotency_key, transaction_type)
       VALUES ($1::uuid, $2, $3)`,
      [transactionId, command.idempotencyKey, command.transactionType]
    );
    for (const [index, line] of command.lines.entries()) {
      await context.executeSql(
        `INSERT INTO ledger_entries
           (transaction_id, account_id, direction, amount, entry_index)
         VALUES ($1::uuid, $2::uuid, $3, $4::bigint, $5)`,
        [
          transactionId,
          line.accountId,
          line.direction,
          line.amount,
          index
        ]
      );
    }
    return transactionId;
  }

  public async findTransactionWithLines(
    context: TransactionContext,
    transactionId: string
  ): Promise<{
    readonly status: 'POSTED' | 'REVERSED';
    readonly transactionType: string;
    readonly reversedBy: string | null;
    readonly lines: readonly {
      readonly accountId: LedgerAccountId;
      readonly direction: 'DEBIT' | 'CREDIT';
      readonly amount: string;
    }[];
  } | null> {
    const header = await context.executeSql<{
      status: string;
      transaction_type: string;
      reversed_by_transaction_id: string | null;
    }>(
      `SELECT status, transaction_type, reversed_by_transaction_id
         FROM ledger_transactions WHERE transaction_id = $1::uuid`,
      [transactionId]
    );
    const row = header.rows[0];
    if (row === undefined) return null;
    const entries = await context.executeSql<{
      account_id: string;
      direction: string;
      amount: string;
    }>(
      `SELECT account_id, direction, amount::text AS amount
         FROM ledger_entries WHERE transaction_id = $1::uuid
        ORDER BY entry_index`,
      [transactionId]
    );
    return {
      status: row.status as 'POSTED' | 'REVERSED',
      transactionType: row.transaction_type,
      reversedBy: row.reversed_by_transaction_id,
      lines: entries.rows.map((entry) => ({
        accountId: entry.account_id as LedgerAccountId,
        direction: entry.direction as 'DEBIT' | 'CREDIT',
        amount: entry.amount
      }))
    };
  }

  public async insertReversalTransaction(
    context: TransactionContext,
    input: {
      readonly idempotencyKey: string;
      readonly originalTransactionId: string;
      readonly lines: readonly {
        readonly accountId: LedgerAccountId;
        readonly direction: 'DEBIT' | 'CREDIT';
        readonly amount: string;
      }[];
    }
  ): Promise<string> {
    const transactionId = randomUUID();
    await context.executeSql(
      `INSERT INTO ledger_transactions
         (transaction_id, idempotency_key, transaction_type,
          reversed_by_transaction_id)
       VALUES ($1::uuid, $2, 'REVERSAL', $3::uuid)`,
      [transactionId, input.idempotencyKey, input.originalTransactionId]
    );
    for (const [index, line] of input.lines.entries()) {
      await context.executeSql(
        `INSERT INTO ledger_entries
           (transaction_id, account_id, direction, amount, entry_index)
         VALUES ($1::uuid, $2::uuid, $3, $4::bigint, $5)`,
        [transactionId, line.accountId, line.direction, line.amount, index]
      );
    }
    return transactionId;
  }

  public async markOriginalReversed(
    context: TransactionContext,
    input: {
      readonly originalTransactionId: string;
      readonly reversalTransactionId: string;
    }
  ): Promise<boolean> {
    const result = await context.executeSql(
      `UPDATE ledger_transactions
          SET status = 'REVERSED',
              reversed_by_transaction_id = $2::uuid
        WHERE transaction_id = $1::uuid AND status = 'POSTED'
        RETURNING transaction_id`,
      [input.originalTransactionId, input.reversalTransactionId]
    );
    return result.rows.length === 1;
  }
}
