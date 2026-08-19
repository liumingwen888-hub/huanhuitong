declare const ledgerAccountBrand: unique symbol;
export type LedgerAccountId = string & {
  readonly [ledgerAccountBrand]: 'LedgerAccountId';
};

export type LedgerAccountPurpose =
  | 'USER_AVAILABLE'
  | 'USER_FROZEN'
  | 'USER_IN_TRANSIT'
  | 'PLATFORM_CUSTODY'
  | 'USER_LIABILITY'
  | 'CLAIM_LIABILITY'
  | 'FEE_INCOME'
  | 'UPSTREAM_COST'
  | 'CLEARING_DIFF';

export type LedgerEntryDirection = 'DEBIT' | 'CREDIT';

export type LedgerTransactionType =
  | 'DEPOSIT'
  | 'INTERNAL_TRANSFER'
  | 'CLAIM'
  | 'RED_PACKET'
  | 'WITHDRAWAL'
  | 'EXCHANGE'
  | 'FIAT_PAYOUT'
  | 'REVERSAL'
  | 'ADJUSTMENT';

/**
 * Money crosses every boundary as a decimal string in the asset's smallest
 * units. JavaScript numbers must never carry a money amount.
 */
export interface MoneyAmount {
  readonly value: string;
  readonly assetCode: string;
  readonly decimals: number;
}

export interface LedgerEntryLine {
  readonly accountId: LedgerAccountId;
  readonly direction: LedgerEntryDirection;
  readonly amount: string;
}

export interface PostMoneyCommand {
  readonly idempotencyKey: string;
  readonly transactionType: LedgerTransactionType;
  readonly lines: readonly LedgerEntryLine[];
  readonly occurredAt: string;
}

export interface PostingResult {
  readonly transactionId: string;
  readonly posted: boolean;
}

export type LedgerContractErrorCode =
  | 'LEDGER_COMMAND_INVALID'
  | 'LEDGER_ACCOUNT_NOT_FOUND'
  | 'LEDGER_IDEMPOTENCY_CONFLICT'
  | 'LEDGER_UNBALANCED'
  | 'LEDGER_NEGATIVE_BALANCE'
  | 'LEDGER_ACCOUNT_STATUS_INVALID'
  | 'LEDGER_TRANSACTION_ALREADY_REVERSED';
