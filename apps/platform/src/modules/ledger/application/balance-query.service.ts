import type { LedgerAccountId } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import type { LedgerAccountRepository } from './ledger.repository.js';

export interface ProjectionDiscrepancy {
  readonly accountId: LedgerAccountId;
  readonly projected: string;
  readonly authoritative: string;
}

/**
 * Read model over account_balances. The projection is maintained by the
 * posting kernel in the same transaction as the entries themselves; this
 * service only reads it and provides reconciliation tooling. Entries remain
 * the single source of money truth — the projection never feeds back into
 * kernel decisions.
 */
export class BalanceQueryService {
  readonly #unitOfWork: UnitOfWork;
  readonly #accounts: LedgerAccountRepository;

  constructor(unitOfWork: UnitOfWork, accounts: LedgerAccountRepository) {
    this.#unitOfWork = unitOfWork;
    this.#accounts = accounts;
  }

  public async accountBalanceOf(accountId: LedgerAccountId): Promise<string> {
    return this.#unitOfWork.execute(async (context) => {
      const projection = await this.#accounts.readProjection(
        context,
        accountId
      );
      return projection?.signedBalance ?? '0';
    });
  }

  public async verifyProjection(): Promise<readonly ProjectionDiscrepancy[]> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        account_id: string;
        projected: string;
        authoritative: string;
      }>(
        `SELECT p.account_id,
                p.signed_balance::text AS projected,
                COALESCE((
                  SELECT SUM(CASE e.direction WHEN 'DEBIT' THEN e.amount
                                              ELSE -e.amount END)::text
                    FROM ledger_entries e WHERE e.account_id = p.account_id
                ), '0') AS authoritative
           FROM account_balances p`
      );
      const discrepancies: ProjectionDiscrepancy[] = [];
      for (const row of rows.rows) {
        if (row.projected !== row.authoritative) {
          discrepancies.push({
            accountId: row.account_id as LedgerAccountId,
            projected: row.projected,
            authoritative: row.authoritative
          });
        }
      }
      return Object.freeze(discrepancies);
    });
  }

  public async recomputeAll(): Promise<number> {
    return this.#unitOfWork.execute(async (context) => {
      const rows = await context.executeSql<{
        account_id: string;
        authoritative: string;
        last_transaction_id: string | null;
      }>(
        `SELECT a.account_id,
                COALESCE(SUM(CASE e.direction WHEN 'DEBIT' THEN e.amount
                                              ELSE -e.amount END), 0)::text
                  AS authoritative,
                (
                  SELECT e.transaction_id::text FROM ledger_entries e
                   WHERE e.account_id = a.account_id
                   ORDER BY e.entry_index DESC LIMIT 1
                ) AS last_transaction_id
           FROM ledger_accounts a
           LEFT JOIN ledger_entries e ON e.account_id = a.account_id
          GROUP BY a.account_id`
      );
      for (const row of rows.rows) {
        await this.#accounts.upsertProjectionAbsolute(context, {
          accountId: row.account_id as LedgerAccountId,
          signedBalance: row.authoritative,
          transactionId: row.last_transaction_id
        });
      }
      return rows.rows.length;
    });
  }
}

Object.freeze(BalanceQueryService.prototype);
