CREATE TABLE quotes (
  quote_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_key text NOT NULL,
  config_version integer NOT NULL,
  sell_amount bigint NOT NULL,
  reference_rate text NOT NULL,
  buy_amount bigint NOT NULL,
  source_id text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_quotes_market
    FOREIGN KEY (market_key, config_version)
    REFERENCES market_configs(market_key, config_version),
  CONSTRAINT ck_quotes_sell CHECK (sell_amount > 0),
  CONSTRAINT ck_quotes_buy CHECK (buy_amount >= 0),
  CONSTRAINT ck_quotes_status
    CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED')),
  CONSTRAINT ck_quotes_expiry CHECK (expires_at > created_at)
);

CREATE INDEX ix_quotes_active
  ON quotes(status, expires_at) WHERE status = 'ACTIVE';

GRANT SELECT, INSERT, UPDATE (status) ON quotes TO xht_platform;
GRANT SELECT ON quotes TO xht_worker;
