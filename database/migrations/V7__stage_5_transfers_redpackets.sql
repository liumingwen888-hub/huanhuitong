CREATE TABLE transfer_orders (
  transfer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref text NOT NULL,
  sender_uid uuid NOT NULL,
  recipient_uid uuid NOT NULL,
  asset_code text NOT NULL,
  amount bigint NOT NULL,
  fee_amount bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING',
  ledger_transaction_id uuid,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  executed_at timestamptz,
  CONSTRAINT uq_transfer_orders_ref UNIQUE (order_ref),
  CONSTRAINT fk_transfer_orders_sender
    FOREIGN KEY (sender_uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_transfer_orders_recipient
    FOREIGN KEY (recipient_uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_transfer_orders_asset
    FOREIGN KEY (asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT fk_transfer_orders_ledger
    FOREIGN KEY (ledger_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT ck_transfer_orders_amount CHECK (amount > 0),
  CONSTRAINT ck_transfer_orders_fee CHECK (fee_amount >= 0),
  CONSTRAINT ck_transfer_orders_status
    CHECK (status IN ('PENDING', 'EXECUTED', 'FAILED', 'EXPIRED', 'REFUNDED')),
  CONSTRAINT ck_transfer_orders_execution
    CHECK (
      (status IN ('EXECUTED') AND executed_at IS NOT NULL
        AND ledger_transaction_id IS NOT NULL)
      OR (status NOT IN ('EXECUTED') AND executed_at IS NULL)
    )
);

CREATE INDEX ix_transfer_orders_sender
  ON transfer_orders(sender_uid, status, created_at DESC);
CREATE INDEX ix_transfer_orders_recipient
  ON transfer_orders(recipient_uid, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE (status, ledger_transaction_id,
  failure_reason, executed_at) ON transfer_orders TO xht_platform;
GRANT SELECT ON transfer_orders TO xht_worker;

CREATE TABLE claim_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_code text NOT NULL,
  creator_uid uuid NOT NULL,
  amount bigint NOT NULL,
  asset_code text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  claimer_uid uuid,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  ledger_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_claim_links_code UNIQUE (claim_code),
  CONSTRAINT fk_claim_links_creator
    FOREIGN KEY (creator_uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_links_claimer
    FOREIGN KEY (claimer_uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_links_asset
    FOREIGN KEY (asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT fk_claim_links_ledger
    FOREIGN KEY (ledger_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT ck_claim_links_amount CHECK (amount > 0),
  CONSTRAINT ck_claim_links_status
    CHECK (status IN ('ACTIVE', 'CLAIMED', 'EXPIRED', 'REFUNDED')),
  CONSTRAINT ck_claim_links_claim_shape
    CHECK (
      (status = 'CLAIMED' AND claimer_uid IS NOT NULL
        AND claimed_at IS NOT NULL)
      OR (status <> 'CLAIMED' AND claimer_uid IS NULL
        AND claimed_at IS NULL)
    )
);

CREATE INDEX ix_claim_links_creator
  ON claim_links(creator_uid, status, created_at DESC);
CREATE INDEX ix_claim_links_expired
  ON claim_links(status, expires_at) WHERE status = 'ACTIVE';

GRANT SELECT, INSERT, UPDATE (status, claimer_uid, claimed_at,
  ledger_transaction_id) ON claim_links TO xht_platform;
GRANT SELECT ON claim_links TO xht_worker;

CREATE TABLE red_packets (
  packet_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_uid uuid NOT NULL,
  total_amount bigint NOT NULL,
  packet_count integer NOT NULL,
  asset_code text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_red_packets_creator
    FOREIGN KEY (creator_uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_red_packets_asset
    FOREIGN KEY (asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT ck_red_packets_amount CHECK (total_amount > 0),
  CONSTRAINT ck_red_packets_count
    CHECK (packet_count >= 1 AND packet_count <= 100),
  CONSTRAINT ck_red_packets_status
    CHECK (status IN ('ACTIVE', 'DEPLETED', 'EXPIRED', 'REFUNDED'))
);

CREATE INDEX ix_red_packets_creator
  ON red_packets(creator_uid, status, created_at DESC);

CREATE TABLE red_packet_claims (
  claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid NOT NULL,
  claimer_uid uuid NOT NULL,
  amount bigint NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ledger_transaction_id uuid,
  CONSTRAINT fk_red_packet_claims_packet
    FOREIGN KEY (packet_id) REFERENCES red_packets(packet_id),
  CONSTRAINT fk_red_packet_claims_claimer
    FOREIGN KEY (claimer_uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_red_packet_claims_ledger
    FOREIGN KEY (ledger_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT uq_red_packet_claims_packet_claimer
    UNIQUE (packet_id, claimer_uid),
  CONSTRAINT ck_red_packet_claims_amount CHECK (amount > 0)
);

CREATE INDEX ix_red_packet_claims_packet
  ON red_packet_claims(packet_id, claimed_at);

GRANT SELECT, INSERT ON red_packets TO xht_platform;
GRANT UPDATE (status) ON red_packets TO xht_platform;
GRANT SELECT ON red_packets TO xht_worker;
GRANT SELECT, INSERT ON red_packet_claims TO xht_platform;
GRANT UPDATE (ledger_transaction_id) ON red_packet_claims TO xht_platform;
GRANT SELECT ON red_packet_claims TO xht_worker;
