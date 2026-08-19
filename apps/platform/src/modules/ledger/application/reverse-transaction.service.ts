import type { LedgerAccountId } from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { LedgerError } from '../domain/ledger.errors.js';
import type {
  LedgerAccountRepository,
  LedgerTransactionRepository
} from './ledger.repository.js';

const DEBIT_NORMAL_PURPOSES = new Set([
  'PLATFORM_CUSTODY',
  'FEE_INCOME',
  'UPSTREAM_COST',
  'CLEARING_DIFF'
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

export interface ReverseTransactionOutcome {
  readonly reversalTransactionId: string;
}

/**
 * Corrects a posted transaction by writing a full opposite REVERSAL
 * transaction that references the original, then marking the original
 * REVERSED. History rows are never modified; a second reversal of the
 * same original is rejected.
 */
export class ReverseTransactionService {
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

  public async reverse(input: {
    readonly originalTransactionId: string;
    readonly idempotencyKey: string;
  }): Promise<ReverseTransactionOutcome> {
    if (
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.length < 8 ||
      input.idempotencyKey.length > 200
    ) {
      throw new LedgerError('LEDGER_COMMAND_INVALID');
    }
    return this.#unitOfWork.execute(async (context) => {
      const existingReversal =
        await this.#transactions.findTransactionIdByIdempotencyKey(
          context,
          input.idempotencyKey
        );
      if (existingReversal !== null) {
        return { reversalTransactionId: existingReversal };
      }
      const original = await this.#transactions.findTransactionWithLines(
        context,
        input.originalTransactionId
      );
      if (original === null) {
        throw new LedgerError('LEDGER_ACCOUNT_NOT_FOUND');
      }
      if (original.status !== 'POSTED') {
        throw new LedgerError('LEDGER_TRANSACTION_ALREADY_REVERSED');
      }
      if (original.transactionType === 'REVERSAL') {
        throw new LedgerError('LEDGER_COMMAND_INVALID');
      }
      const reversedLines = original.lines.map((line) => ({
        accountId: line.accountId,
        direction: (line.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT') as
          | 'DEBIT'
          | 'CREDIT',
        amount: line.amount
      }));
      const netByAccount = new Map<LedgerAccountId, bigint>();
      for (const line of reversedLines) {
        const delta =
          line.direction === 'DEBIT'
            ? BigInt(line.amount)
            : -BigInt(line.amount);
        netByAccount.set(
          line.accountId,
          (netByAccount.get(line.accountId) ?? 0n) + delta
        );
      }
      for (const accountId of [...netByAccount.keys()].sort()) {
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
      const reversalTransactionId =
        await this.#transactions.insertReversalTransaction(context, {
          idempotencyKey: input.idempotencyKey,
          originalTransactionId: input.originalTransactionId,
          lines: reversedLines
        });
      const marked = await this.#transactions.markOriginalReversed(context, {
        originalTransactionId: input.originalTransactionId,
        reversalTransactionId
      });
      if (!marked) {
        throw new LedgerError('LEDGER_TRANSACTION_ALREADY_REVERSED');
      }
      await this.#accounts.bumpAccountVersions(
        context,
        [...netByAccount.keys()]
      );
      return { reversalTransactionId };
    });
  }
}
