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
}
