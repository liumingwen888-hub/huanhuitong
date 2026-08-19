CREATE TABLE asset_catalog (
  asset_code text PRIMARY KEY,
  kind text NOT NULL,
  network text NOT NULL,
  symbol text NOT NULL,
  decimals integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT ck_asset_catalog_kind CHECK (kind IN ('CHAIN', 'FIAT')),
  CONSTRAINT ck_asset_catalog_decimals CHECK (decimals >= 0 AND decimals <= 18),
  CONSTRAINT ck_asset_catalog_status
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'RETIRED'))
);

INSERT INTO asset_catalog (asset_code, kind, network, symbol, decimals) VALUES
  ('USDT-TRC20', 'CHAIN', 'TRON',    'USDT', 6),
  ('USDT-ERC20', 'CHAIN', 'ETHEREUM','USDT', 6),
  ('BTC',        'CHAIN', 'BITCOIN', 'BTC',  8),
  ('ETH',        'CHAIN', 'ETHEREUM','ETH', 18),
  ('USD-FIAT',   'FIAT',  'FIAT',    'USD',  2);

CREATE TABLE ledger_accounts (
  account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid uuid,
  asset_code text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_ledger_accounts_owner
    FOREIGN KEY (owner_uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_ledger_accounts_asset
    FOREIGN KEY (asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT uq_ledger_accounts_owner_asset_purpose
    UNIQUE (owner_uid, asset_code, purpose),
  CONSTRAINT ck_ledger_accounts_purpose
    CHECK (purpose IN (
      'USER_AVAILABLE', 'USER_FROZEN', 'USER_IN_TRANSIT',
      'PLATFORM_CUSTODY', 'USER_LIABILITY', 'CLAIM_LIABILITY',
      'FEE_INCOME', 'UPSTREAM_COST', 'CLEARING_DIFF'
    )),
  CONSTRAINT ck_ledger_accounts_status
    CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),
  CONSTRAINT ck_ledger_accounts_version CHECK (version >= 0),
  CONSTRAINT ck_ledger_accounts_ownership
    CHECK (
      (
        purpose IN ('USER_AVAILABLE', 'USER_FROZEN', 'USER_IN_TRANSIT')
        AND owner_uid IS NOT NULL
      )
      OR
      (
        purpose IN ('PLATFORM_CUSTODY', 'USER_LIABILITY', 'CLAIM_LIABILITY',
                    'FEE_INCOME', 'UPSTREAM_COST', 'CLEARING_DIFF')
        AND owner_uid IS NULL
      )
    )
);

CREATE INDEX ix_ledger_accounts_owner ON ledger_accounts(owner_uid, asset_code);

CREATE TABLE ledger_transactions (
  transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  transaction_type text NOT NULL,
  status text NOT NULL DEFAULT 'POSTED',
  reversed_by_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_ledger_transactions_idempotency UNIQUE (idempotency_key),
  CONSTRAINT fk_ledger_transactions_reversal
    FOREIGN KEY (reversed_by_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT ck_ledger_transactions_type
    CHECK (transaction_type IN (
      'DEPOSIT', 'INTERNAL_TRANSFER', 'CLAIM', 'RED_PACKET',
      'WITHDRAWAL', 'EXCHANGE', 'FIAT_PAYOUT', 'REVERSAL', 'ADJUSTMENT'
    )),
  CONSTRAINT ck_ledger_transactions_status
    CHECK (status IN ('POSTED', 'REVERSED')),
  CONSTRAINT ck_ledger_transactions_reversal_shape
    CHECK (
      transaction_type <> 'REVERSAL'
      OR reversed_by_transaction_id IS NOT NULL
    )
);

CREATE TABLE ledger_entries (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  account_id uuid NOT NULL,
  direction text NOT NULL,
  amount bigint NOT NULL,
  entry_index integer NOT NULL,
  CONSTRAINT fk_ledger_entries_transaction
    FOREIGN KEY (transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT fk_ledger_entries_account
    FOREIGN KEY (account_id) REFERENCES ledger_accounts(account_id),
  CONSTRAINT uq_ledger_entries_transaction_index
    UNIQUE (transaction_id, entry_index),
  CONSTRAINT ck_ledger_entries_direction
    CHECK (direction IN ('DEBIT', 'CREDIT')),
  CONSTRAINT ck_ledger_entries_amount CHECK (amount > 0),
  CONSTRAINT ck_ledger_entries_index CHECK (entry_index >= 0)
);

CREATE INDEX ix_ledger_entries_account ON ledger_entries(account_id);

CREATE OR REPLACE FUNCTION ledger_assert_balanced() RETURNS trigger AS $$
DECLARE
  imbalance bigint;
BEGIN
  SELECT COALESCE(SUM(
    CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END
  ), 0) INTO imbalance
    FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'LEDGER_TRANSACTION_UNBALANCED transaction=%', NEW.transaction_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_balanced();

CREATE TABLE account_openings (
  opening_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid uuid NOT NULL,
  asset_code text NOT NULL,
  purpose text NOT NULL,
  idempotency_key text NOT NULL,
  account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_openings_owner
    FOREIGN KEY (owner_uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_account_openings_asset
    FOREIGN KEY (asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT fk_account_openings_account
    FOREIGN KEY (account_id) REFERENCES ledger_accounts(account_id),
  CONSTRAINT uq_account_openings_key UNIQUE (idempotency_key),
  CONSTRAINT ck_account_openings_purpose
    CHECK (purpose IN ('USER_AVAILABLE', 'USER_FROZEN', 'USER_IN_TRANSIT'))
);

GRANT SELECT, INSERT, UPDATE ON ledger_accounts TO xht_platform;
GRANT INSERT, SELECT, UPDATE (status, reversed_by_transaction_id)
  ON ledger_transactions TO xht_platform;
GRANT INSERT, SELECT ON ledger_entries TO xht_platform;
GRANT INSERT, SELECT ON account_openings TO xht_platform;
GRANT SELECT, INSERT, UPDATE ON asset_catalog TO xht_platform;
GRANT SELECT ON asset_catalog TO xht_worker;
GRANT SELECT ON ledger_accounts TO xht_worker;
