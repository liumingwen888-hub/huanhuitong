import type { LedgerAccountId, PostMoneyCommand } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { LedgerError } from '../domain/ledger.errors.js';
import { parsePostMoneyCommand } from '../domain/ledger.types.js';
import type {
  LedgerAccountRepository,
  LedgerTransactionRepository
} from './ledger.repository.js';

const DEBIT_NORMAL_PURPOSES = new Set([
  'PLATFORM_CUSTODY',
  'UPSTREAM_COST'
]);

function violatesNormalBalance(
  purpose: string,
  signedBalance: bigint
): boolean {
  if (DEBIT_NORMAL_PURPOSES.has(purpose)) {
    return signedBalance < 0n;
  }
  return signedBalance > 0n;
}

export interface PostMoneyOutcome {
  readonly transactionId: string;
  readonly posted: boolean;
}

/**
 * The single money-writing entry point. Idempotent by command key; locks
 * every touched account row (in sorted order to avoid deadlocks), derives
 * the authoritative balance from posted entries, and rejects any posting
 * that would leave any account negative.
 */
export class PostMoneyService {
  readonly #unitOfWork: UnitOfWork;
  readonly #accounts: LedgerAccountRepository;
  readonly #transactions: LedgerTransactionRepository;

  constructor(
    unitOfWork: UnitOfWork,
    accounts: LedgerAccountRepository,
    transactions: LedgerTransactionRepository
  ) {
    this.#unitOfWork = unitOfWork;
    this.#accounts = accounts;
    this.#transactions = transactions;
  }

  public async post(input: unknown): Promise<PostMoneyOutcome> {
    const command = parsePostMoneyCommand(input);
    if (command.transactionType === 'REVERSAL') {
      throw new LedgerError('LEDGER_COMMAND_INVALID');
    }
    return this.#unitOfWork.execute(async (context) => {
      const existing = await this.#transactions.findTransactionIdByIdempotencyKey(
        context,
        command.idempotencyKey
      );
      if (existing !== null) {
        return { transactionId: existing, posted: false };
      }
      const netByAccount = new Map<LedgerAccountId, bigint>();
      for (const line of command.lines) {
        const delta =
          line.direction === 'DEBIT'
            ? BigInt(line.amount)
            : -BigInt(line.amount);
        netByAccount.set(
          line.accountId,
          (netByAccount.get(line.accountId) ?? 0n) + delta
        );
      }
      const accountIds = [...netByAccount.keys()].sort();
      for (const accountId of accountIds) {
        const account = await this.#accounts.lockAccount(context, accountId);
        if (account === null) {
          throw new LedgerError('LEDGER_ACCOUNT_NOT_FOUND');
        }
        if (account.status !== 'ACTIVE') {
          throw new LedgerError('LEDGER_ACCOUNT_STATUS_INVALID');
        }
        const balance = await this.#accounts.accountBalance(context, accountId);
        const projected =
          BigInt(balance) + (netByAccount.get(accountId) ?? 0n);
        if (violatesNormalBalance(account.purpose, projected)) {
          throw new LedgerError('LEDGER_NEGATIVE_BALANCE');
        }
      }
      if (process.env.S32_DEBUG) console.log('POST-ATTEMPT', command.idempotencyKey);
      const transactionId = await this.#transactions.insertPostedTransaction(
        context,
        command as PostMoneyCommand
      );
      await this.#accounts.bumpAccountVersions(context, accountIds);
      for (const accountId of accountIds) {
        await this.#accounts.applyProjectionDelta(context, {
          accountId,
          delta: netByAccount.get(accountId) ?? 0n,
          transactionId
        });
      }
      return { transactionId, posted: true };
    });
  }
}
