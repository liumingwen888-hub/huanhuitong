CREATE TABLE withdrawal_orders (
  withdrawal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref text NOT NULL,
  uid uuid NOT NULL,
  asset_code text NOT NULL,
  amount bigint NOT NULL,
  fee_amount bigint NOT NULL DEFAULT 0,
  destination_address text NOT NULL,
  status text NOT NULL DEFAULT 'FROZEN',
  ledger_transaction_id uuid NOT NULL,
  settlement_ledger_transaction_id uuid,
  broadcast_txid text,
  approver_admin_id uuid,
  rejection_reason text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_withdrawal_orders_ref UNIQUE (order_ref),
  CONSTRAINT fk_withdrawal_orders_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT fk_withdrawal_orders_asset
    FOREIGN KEY (asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT fk_withdrawal_orders_approver
    FOREIGN KEY (approver_admin_id)
    REFERENCES admin_principals(admin_id),
  CONSTRAINT fk_withdrawal_orders_freeze_ledger
    FOREIGN KEY (ledger_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT fk_withdrawal_orders_settlement_ledger
    FOREIGN KEY (settlement_ledger_transaction_id)
    REFERENCES ledger_transactions(transaction_id),
  CONSTRAINT ck_withdrawal_orders_amount CHECK (amount > 0),
  CONSTRAINT ck_withdrawal_orders_fee CHECK (fee_amount >= 0),
  CONSTRAINT ck_withdrawal_orders_status
    CHECK (status IN ('FROZEN', 'PENDING_APPROVAL', 'APPROVED', 'SIGNING',
      'BROADCAST', 'CONFIRMED', 'REJECTED', 'FAILED', 'EXPIRED', 'REFUNDED')),
  CONSTRAINT ck_withdrawal_orders_broadcast_shape
    CHECK (
      (status = 'BROADCAST' AND broadcast_txid IS NOT NULL)
        OR status <> 'BROADCAST'
    ),
  CONSTRAINT ck_withdrawal_orders_confirmed_shape
    CHECK (
      (status = 'CONFIRMED' AND broadcast_txid IS NOT NULL
        AND settlement_ledger_transaction_id IS NOT NULL)
        OR status <> 'CONFIRMED'
    ),
  CONSTRAINT ck_withdrawal_orders_rejected_shape
    CHECK (
      (status = 'REJECTED' AND rejection_reason IS NOT NULL
        AND approver_admin_id IS NOT NULL)
        OR status <> 'REJECTED'
    ),
  CONSTRAINT ck_withdrawal_orders_failed_shape
    CHECK (
      (status = 'FAILED' AND failure_reason IS NOT NULL)
        OR status <> 'FAILED'
    ),
  CONSTRAINT ck_withdrawal_orders_refunded_shape
    CHECK (
      (status = 'REFUNDED' AND settlement_ledger_transaction_id IS NOT NULL)
        OR status <> 'REFUNDED'
    )
);

CREATE INDEX ix_withdrawal_orders_uid
  ON withdrawal_orders(uid, status, created_at DESC);
CREATE INDEX ix_withdrawal_orders_open
  ON withdrawal_orders(status, created_at DESC)
  WHERE status IN ('PENDING_APPROVAL', 'SIGNING', 'BROADCAST');

GRANT SELECT, INSERT, UPDATE (status, settlement_ledger_transaction_id,
  broadcast_txid, approver_admin_id, rejection_reason, failure_reason,
  updated_at) ON withdrawal_orders TO xht_platform;
GRANT SELECT ON withdrawal_orders TO xht_worker;

CREATE TABLE withdrawal_approvals (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id uuid NOT NULL,
  admin_id uuid NOT NULL,
  level integer NOT NULL DEFAULT 1,
  decision text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_withdrawal_approvals_order_admin
    UNIQUE (withdrawal_id, admin_id),
  CONSTRAINT fk_withdrawal_approvals_withdrawal
    FOREIGN KEY (withdrawal_id)
    REFERENCES withdrawal_orders(withdrawal_id) ON DELETE RESTRICT,
  CONSTRAINT fk_withdrawal_approvals_admin
    FOREIGN KEY (admin_id) REFERENCES admin_principals(admin_id),
  CONSTRAINT ck_withdrawal_approvals_level CHECK (level IN (1, 2)),
  CONSTRAINT ck_withdrawal_approvals_decision
    CHECK (decision IN ('APPROVE', 'REJECT'))
);

CREATE INDEX ix_withdrawal_approvals_withdrawal
  ON withdrawal_approvals(withdrawal_id, created_at);

GRANT SELECT, INSERT ON withdrawal_approvals TO xht_platform;
GRANT SELECT ON withdrawal_approvals TO xht_worker;

CREATE TABLE signer_policies (
  policy_version integer NOT NULL,
  network text NOT NULL,
  hot_wallet_address text NOT NULL,
  fee_amount bigint NOT NULL,
  min_auto_amount bigint NOT NULL,
  max_amount bigint NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pk_signer_policies PRIMARY KEY (policy_version, network),
  CONSTRAINT ck_signer_policies_fee CHECK (fee_amount >= 0),
  CONSTRAINT ck_signer_policies_thresholds
    CHECK (min_auto_amount > 0 AND max_amount >= min_auto_amount)
);

CREATE INDEX ix_signer_policies_network
  ON signer_policies(network, policy_version DESC);

GRANT SELECT, INSERT ON signer_policies TO xht_platform;
GRANT SELECT ON signer_policies TO xht_worker;
