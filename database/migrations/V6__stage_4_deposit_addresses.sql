CREATE TABLE deposit_addresses (
  address_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid uuid NOT NULL,
  asset_code text NOT NULL,
  network text NOT NULL,
  address_text text NOT NULL,
  derivation_path text NOT NULL,
  derivation_index integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_deposit_addresses_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_deposit_addresses_asset
    FOREIGN KEY (asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT uq_deposit_addresses_network_address
    UNIQUE (network, address_text),
  CONSTRAINT uq_deposit_addresses_asset_index
    UNIQUE (asset_code, derivation_index),
  CONSTRAINT ck_deposit_addresses_status
    CHECK (status IN ('ACTIVE', 'RETIRED', 'COMPROMISED')),
  CONSTRAINT ck_deposit_addresses_index
    CHECK (derivation_index >= 0),
  CONSTRAINT ck_deposit_addresses_path
    CHECK (length(derivation_path) > 0 AND length(derivation_path) <= 255)
);

CREATE INDEX ix_deposit_addresses_uid ON deposit_addresses(uid, asset_code, status);

CREATE TABLE address_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address_id uuid NOT NULL,
  uid uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_address_assignments_address
    FOREIGN KEY (address_id) REFERENCES deposit_addresses(address_id),
  CONSTRAINT fk_address_assignments_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT uq_address_assignments_key UNIQUE (idempotency_key)
);

CREATE TABLE deposit_detections (
  detection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address_id uuid NOT NULL,
  network text NOT NULL,
  network_txid text NOT NULL,
  network_timestamp timestamptz NOT NULL,
  amount bigint NOT NULL,
  confirmations integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DETECTED',
  detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_deposit_detections_address
    FOREIGN KEY (address_id) REFERENCES deposit_addresses(address_id),
  CONSTRAINT uq_deposit_detections_network_txid_address
    UNIQUE (network, network_txid, address_id),
  CONSTRAINT ck_deposit_detections_status
    CHECK (status IN ('DETECTED', 'CONFIRMED', 'REORG_DETECTED',
                      'POSTED', 'FAILED_POST')),
  CONSTRAINT ck_deposit_detections_amount CHECK (amount > 0),
  CONSTRAINT ck_deposit_detections_confirmations
    CHECK (confirmations >= 0)
);

CREATE INDEX ix_deposit_detections_status
  ON deposit_detections(status, confirmations);

CREATE TABLE chain_scan_checkpoints (
  network text PRIMARY KEY,
  last_scanned_block bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_chain_scan_block CHECK (last_scanned_block >= 0)
);

CREATE TABLE confirmation_policies (
  policy_version integer NOT NULL,
  network text NOT NULL,
  required_confirmations integer NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pk_confirmation_policies PRIMARY KEY (policy_version, network),
  CONSTRAINT uq_confirmation_policies_network UNIQUE (network),
  CONSTRAINT ck_confirmation_policies_confirmations
    CHECK (required_confirmations >= 1 AND required_confirmations <= 100)
);

INSERT INTO confirmation_policies (policy_version, network, required_confirmations) VALUES
  (1, 'TRON', 19),
  (1, 'ETHEREUM', 12),
  (1, 'BITCOIN', 6);

GRANT SELECT, INSERT, UPDATE (status)
  ON deposit_addresses TO xht_platform;
GRANT INSERT, SELECT ON address_assignments TO xht_platform;
GRANT SELECT, INSERT, UPDATE (status, confirmations, updated_at)
  ON deposit_detections TO xht_platform;
GRANT SELECT, INSERT, UPDATE ON chain_scan_checkpoints TO xht_platform;
GRANT SELECT ON confirmation_policies TO xht_platform;
GRANT SELECT ON deposit_addresses, deposit_detections,
  chain_scan_checkpoints, confirmation_policies TO xht_worker;
