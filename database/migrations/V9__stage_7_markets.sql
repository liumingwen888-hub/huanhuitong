CREATE TABLE market_configs (
  market_key text NOT NULL,
  config_version integer NOT NULL,
  sell_asset_code text NOT NULL,
  buy_asset_code text NOT NULL,
  quote_scale integer NOT NULL,
  spread_bp integer NOT NULL,
  min_sell_amount bigint NOT NULL,
  max_sell_amount bigint NOT NULL,
  quote_ttl_seconds integer NOT NULL,
  deviation_tolerance_bp integer NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pk_market_configs PRIMARY KEY (market_key, config_version),
  CONSTRAINT fk_market_configs_sell_asset
    FOREIGN KEY (sell_asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT fk_market_configs_buy_asset
    FOREIGN KEY (buy_asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT ck_market_configs_version CHECK (config_version >= 1),
  CONSTRAINT ck_market_configs_scale
    CHECK (quote_scale >= 1 AND quote_scale <= 18),
  CONSTRAINT ck_market_configs_spread
    CHECK (spread_bp >= 0 AND spread_bp <= 10000),
  CONSTRAINT ck_market_configs_limits
    CHECK (min_sell_amount > 0 AND max_sell_amount >= min_sell_amount),
  CONSTRAINT ck_market_configs_ttl
    CHECK (quote_ttl_seconds >= 1 AND quote_ttl_seconds <= 3600),
  CONSTRAINT ck_market_configs_deviation
    CHECK (deviation_tolerance_bp > 0)
);

CREATE INDEX ix_market_configs_active
  ON market_configs(market_key, config_version DESC);

GRANT SELECT, INSERT ON market_configs TO xht_platform;
GRANT SELECT ON market_configs TO xht_worker;

INSERT INTO market_configs
  (market_key, config_version, sell_asset_code, buy_asset_code,
   quote_scale, spread_bp, min_sell_amount, max_sell_amount,
   quote_ttl_seconds, deviation_tolerance_bp)
VALUES
  ('USDT-TRC20:USDT-ERC20', 1, 'USDT-TRC20', 'USDT-ERC20', 8, 50,
   100000, 10000000000, 60, 1000),
  ('USDT-ERC20:USDT-TRC20', 1, 'USDT-ERC20', 'USDT-TRC20', 8, 50,
   100000, 10000000000, 60, 1000),
  ('BTC:USDT-TRC20', 1, 'BTC', 'USDT-TRC20', 8, 50,
   1000, 5000000000, 60, 1000),
  ('USDT-TRC20:BTC', 1, 'USDT-TRC20', 'BTC', 8, 50,
   100000, 10000000000, 60, 1000);
