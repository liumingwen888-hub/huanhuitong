CREATE TABLE fee_schedules (
  fee_version integer PRIMARY KEY,
  asset_code text NOT NULL,
  basis_points integer NOT NULL,
  fixed_amount bigint NOT NULL DEFAULT 0,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_fee_schedules_asset
    FOREIGN KEY (asset_code) REFERENCES asset_catalog(asset_code),
  CONSTRAINT ck_fee_schedules_bp
    CHECK (basis_points >= 0 AND basis_points <= 10000),
  CONSTRAINT ck_fee_schedules_fixed CHECK (fixed_amount >= 0)
);

GRANT SELECT, INSERT ON fee_schedules TO xht_platform;
GRANT SELECT ON fee_schedules TO xht_worker;

CREATE TABLE risk_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid uuid NOT NULL,
  operation_type text NOT NULL,
  allowed boolean NOT NULL,
  reason_code text NOT NULL,
  idempotency_key text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_risk_decisions_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT uq_risk_decisions_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_risk_decisions_operation
    CHECK (operation_type IN
      ('DEPOSIT', 'WITHDRAWAL', 'INTERNAL_TRANSFER', 'CLAIM',
       'RED_PACKET', 'EXCHANGE', 'FIAT_PAYOUT'))
);

CREATE INDEX ix_risk_decisions_uid ON risk_decisions(uid, decided_at DESC);

GRANT SELECT, INSERT ON risk_decisions TO xht_platform;

CREATE TABLE operation_limits (
  uid uuid NOT NULL,
  operation_type text NOT NULL,
  window_seconds integer NOT NULL,
  max_count integer NOT NULL,
  max_amount bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_operation_limits_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT uq_operation_limits_uid_type UNIQUE (uid, operation_type),
  CONSTRAINT ck_operation_limits_window
    CHECK (window_seconds > 0 AND window_seconds <= 86400),
  CONSTRAINT ck_operation_limits_count CHECK (max_count >= 1),
  CONSTRAINT ck_operation_limits_amount CHECK (max_amount >= 0)
);

GRANT SELECT, INSERT, UPDATE ON operation_limits TO xht_platform;

CREATE TABLE config_versions (
  config_key text NOT NULL,
  version integer NOT NULL,
  payload jsonb NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_config_versions_key_version UNIQUE (config_key, version),
  CONSTRAINT ck_config_versions_version CHECK (version >= 1)
);

GRANT SELECT, INSERT ON config_versions TO xht_platform;

CREATE TABLE admin_principals (
  admin_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_admin_principals_status
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED'))
);

CREATE TABLE admin_role_grants (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  role text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT fk_admin_role_grants_admin
    FOREIGN KEY (admin_id) REFERENCES admin_principals(admin_id)
      ON DELETE RESTRICT,
  CONSTRAINT ck_admin_role_grants_role
    CHECK (role IN ('SUPER_ADMIN', 'RISK_OFFICER', 'FINANCE_OFFICER',
                    'SUPPORT', 'AUDITOR')),
  CONSTRAINT ck_admin_role_grants_revoke
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE INDEX ix_admin_role_grants_admin
  ON admin_role_grants(admin_id, revoked_at);

GRANT SELECT, INSERT, UPDATE (revoked_at) ON admin_role_grants TO xht_platform;
GRANT SELECT, INSERT, UPDATE (status) ON admin_principals TO xht_platform;
