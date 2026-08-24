import type {
  LedgerAccountId,
  MetricsPort,
  PostMoneyCommand
} from '@xht/contracts';
import type { UnitOfWork } from '../../../infrastructure/database/unit-of-work.js';
import { LedgerError } from '../domain/ledger.errors.js';
import { NOOP_METRICS } from '../../../infrastructure/telemetry/compose-metrics.js';
import { parsePostMoneyCommand } from '../domain/ledger.types.js';
import type {
  LedgerAccountRepository,
  LedgerTransactionRepository
} from './ledger.repository.js';

const DEBIT_NORMAL_PURPOSES = new Set([
  'PLATFORM_CUSTODY',
  'UPSTREAM_COST'
]);

const UNRESTRICTED_PURPOSES = new Set(['CLEARING_DIFF']);

function violatesNormalBalance(
  purpose: string,
  signedBalance: bigint
): boolean {
  if (UNRESTRICTED_PURPOSES.has(purpose)) {
    return false;
  }
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
  readonly #metrics: MetricsPort;

  constructor(
    unitOfWork: UnitOfWork,
    accounts: LedgerAccountRepository,
    transactions: LedgerTransactionRepository,
    metrics: MetricsPort = NOOP_METRICS
  ) {
    this.#unitOfWork = unitOfWork;
    this.#accounts = accounts;
    this.#transactions = transactions;
    this.#metrics = metrics;
  }

  public async post(input: unknown): Promise<PostMoneyOutcome> {
    const command = parsePostMoneyCommand(input);
    if (command.transactionType === 'REVERSAL') {
      throw new LedgerError('LEDGER_COMMAND_INVALID');
    }
    const startedAt = Date.now();
    try {
      const result = await this.#unitOfWork.execute(async (context) => {
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
      this.#metrics.incrementCounter('ledger_posting_total', {
        domain: 'ledger', outcome: 'posted'
      });
      this.#metrics.recordHistogram(
        'ledger_posting_duration_ms', Date.now() - startedAt
      );
      return result;
    } catch (error) {
      this.#metrics.incrementCounter('ledger_posting_rejected_total', {
        domain: 'ledger', outcome: 'rejected'
      });
      throw error;
    }
  }
}
