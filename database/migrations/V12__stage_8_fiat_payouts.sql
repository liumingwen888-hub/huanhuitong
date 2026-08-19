CREATE TABLE provider_configs (
  provider_id text NOT NULL,
  config_version integer NOT NULL,
  provider_name text NOT NULL,
  route text NOT NULL,
  source_asset_code text NOT NULL,
  fixed_fee bigint NOT NULL,
  min_amount bigint NOT NULL,
  max_amount bigint NOT NULL,
  callback_secret_ref text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pk_provider_configs PRIMARY KEY (provider_id, config_version),
  CONSTRAINT fk_provider_configs_source_asset
    FOREIGN KEY (source_asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT ck_provider_configs_version CHECK (config_version >= 1),
  CONSTRAINT ck_provider_configs_route CHECK (route ~ '^[A-Z]{2}:[A-Z]{3}$'),
  CONSTRAINT ck_provider_configs_fee CHECK (fixed_fee >= 0),
  CONSTRAINT ck_provider_configs_limits
    CHECK (min_amount > 0 AND max_amount >= min_amount),
  CONSTRAINT ck_provider_configs_secret_ref
    CHECK (callback_secret_ref ~ '^vault:[A-Za-z0-9_-]{4,64}$')
);

CREATE INDEX ix_provider_configs_route
  ON provider_configs(route, config_version DESC);

GRANT SELECT, INSERT ON provider_configs TO xht_platform;
GRANT SELECT ON provider_configs TO xht_worker;

CREATE TABLE payout_orders (
  payout_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref text NOT NULL,
  uid uuid NOT NULL,
  source_asset_code text NOT NULL,
  route text NOT NULL,
  amount bigint NOT NULL,
  fee_amount bigint NOT NULL DEFAULT 0,
  beneficiary_ref text NOT NULL,
  beneficiary_digest text NOT NULL,
  status text NOT NULL DEFAULT 'FUNDS_RESERVED',
  provider_id text NOT NULL,
  provider_config_version integer NOT NULL,
  provider_idempotency_key text NOT NULL,
  ledger_transaction_id uuid NOT NULL,
  settlement_ledger_transaction_id uuid,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_payout_orders_ref UNIQUE (order_ref),
  CONSTRAINT uq_payout_orders_provider_key
    UNIQUE (provider_idempotency_key),
  CONSTRAINT fk_payout_orders_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_payout_orders_source_asset
    FOREIGN KEY (source_asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT fk_payout_orders_provider_config
    FOREIGN KEY (provider_id, provider_config_version)
    REFERENCES provider_configs(provider_id, config_version),
  CONSTRAINT fk_payout_orders_freeze_ledger
    FOREIGN KEY (ledger_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT fk_payout_orders_settlement_ledger
    FOREIGN KEY (settlement_ledger_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT ck_payout_orders_amount CHECK (amount > 0),
  CONSTRAINT ck_payout_orders_fee CHECK (fee_amount >= 0),
  CONSTRAINT ck_payout_orders_beneficiary_ref
    CHECK (beneficiary_ref ~ '^[A-Za-z0-9-]{4,64}$'),
  CONSTRAINT ck_payout_orders_beneficiary_digest
    CHECK (beneficiary_digest ~ '^sha256:[A-Za-z0-9_-]{43}$'),
  CONSTRAINT ck_payout_orders_route CHECK (route ~ '^[A-Z]{2}:[A-Z]{3}$'),
  CONSTRAINT ck_payout_orders_status
    CHECK (status IN ('FUNDS_RESERVED', 'SUBMITTING', 'ACCEPTED',
      'SUCCEEDED', 'FAILED', 'UNKNOWN', 'REFUNDED', 'REVERSED')),
  CONSTRAINT ck_payout_orders_succeeded_shape
    CHECK (
      (status = 'SUCCEEDED' AND settlement_ledger_transaction_id IS NOT NULL)
        OR status <> 'SUCCEEDED'
    ),
  CONSTRAINT ck_payout_orders_failed_shape
    CHECK (
      (status = 'FAILED' AND failure_reason IS NOT NULL)
        OR status <> 'FAILED'
    ),
  CONSTRAINT ck_payout_orders_refunded_shape
    CHECK (
      (status = 'REFUNDED' AND settlement_ledger_transaction_id IS NOT NULL)
        OR status <> 'REFUNDED'
    ),
  CONSTRAINT ck_payout_orders_reversed_shape
    CHECK (
      (status = 'REVERSED' AND settlement_ledger_transaction_id IS NOT NULL)
        OR status <> 'REVERSED'
    )
);

CREATE INDEX ix_payout_orders_uid
  ON payout_orders(uid, status, created_at DESC);
CREATE INDEX ix_payout_orders_open
  ON payout_orders(status, created_at DESC)
  WHERE status IN ('SUBMITTING', 'ACCEPTED', 'UNKNOWN');

GRANT SELECT, INSERT, UPDATE (status, settlement_ledger_transaction_id,
  failure_reason, updated_at) ON payout_orders TO xht_platform;
GRANT SELECT ON payout_orders TO xht_worker;

INSERT INTO provider_configs
  (provider_id, config_version, provider_name, route, source_asset_code,
   fixed_fee, min_amount, max_amount, callback_secret_ref)
VALUES
  ('fake-bank-v1', 1, 'Fake Bank', 'US:USD', 'USDT-TRC20',
   2000, 100000, 100000000, 'vault:fake-bank-callback-v1');
