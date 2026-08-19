CREATE TABLE exchange_orders (
  exchange_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref text NOT NULL,
  uid uuid NOT NULL,
  quote_id uuid NOT NULL,
  market_key text NOT NULL,
  config_version integer NOT NULL,
  sell_asset_code text NOT NULL,
  buy_asset_code text NOT NULL,
  sell_amount bigint NOT NULL,
  buy_amount bigint NOT NULL,
  status text NOT NULL DEFAULT 'FUNDS_RESERVED',
  ledger_transaction_id uuid NOT NULL,
  settlement_ledger_transaction_id uuid,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_exchange_orders_ref UNIQUE (order_ref),
  CONSTRAINT uq_exchange_orders_quote UNIQUE (quote_id),
  CONSTRAINT fk_exchange_orders_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_exchange_orders_quote
    FOREIGN KEY (quote_id) REFERENCES quotes(quote_id),
  CONSTRAINT fk_exchange_orders_market
    FOREIGN KEY (market_key, config_version)
    REFERENCES market_configs(market_key, config_version),
  CONSTRAINT fk_exchange_orders_sell_asset
    FOREIGN KEY (sell_asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT fk_exchange_orders_buy_asset
    FOREIGN KEY (buy_asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT fk_exchange_orders_freeze_ledger
    FOREIGN KEY (ledger_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT fk_exchange_orders_settlement_ledger
    FOREIGN KEY (settlement_ledger_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT ck_exchange_orders_amounts
    CHECK (sell_amount > 0 AND buy_amount > 0),
  CONSTRAINT ck_exchange_orders_status
    CHECK (status IN ('FUNDS_RESERVED', 'EXECUTING', 'SETTLED', 'FAILED',
      'EXPIRED', 'REFUNDED')),
  CONSTRAINT ck_exchange_orders_settled_shape
    CHECK (
      (status = 'SETTLED' AND settlement_ledger_transaction_id IS NOT NULL)
        OR status <> 'SETTLED'
    ),
  CONSTRAINT ck_exchange_orders_failed_shape
    CHECK (
      (status = 'FAILED' AND failure_reason IS NOT NULL)
        OR status <> 'FAILED'
    )
);

CREATE INDEX ix_exchange_orders_uid
  ON exchange_orders(uid, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE (status, settlement_ledger_transaction_id,
  failure_reason, updated_at) ON exchange_orders TO xht_platform;
GRANT SELECT ON exchange_orders TO xht_worker;
