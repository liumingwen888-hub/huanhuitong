CREATE TABLE account_balances (
  account_id uuid PRIMARY KEY,
  signed_balance bigint NOT NULL DEFAULT 0,
  last_transaction_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_balances_account
    FOREIGN KEY (account_id) REFERENCES ledger_accounts(account_id),
  CONSTRAINT fk_account_balances_last_transaction
    FOREIGN KEY (last_transaction_id)
    REFERENCES ledger_transactions(transaction_id)
);

GRANT SELECT, INSERT, UPDATE ON account_balances TO xht_platform;
GRANT SELECT ON account_balances TO xht_worker;
