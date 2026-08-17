CREATE TABLE payment_credentials (
  uid uuid PRIMARY KEY,
  status text NOT NULL,
  hash_v1 text,
  hash_algorithm text,
  hash_param_version integer,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  cooldown_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_payment_credentials_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT ck_payment_credentials_status
    CHECK (status IN
      ('NOT_SET', 'ACTIVE', 'LOCKED', 'RESET_PENDING', 'COOLDOWN', 'REVOKED')),
  CONSTRAINT ck_payment_credentials_failed_attempts
    CHECK (failed_attempts >= 0),
  CONSTRAINT ck_payment_credentials_hash_shape
    CHECK (
      (status IN ('NOT_SET') AND hash_v1 IS NULL AND hash_algorithm IS NULL
        AND hash_param_version IS NULL)
      OR
      (status IN ('ACTIVE', 'LOCKED', 'RESET_PENDING', 'COOLDOWN')
        AND hash_v1 IS NOT NULL AND hash_algorithm IS NOT NULL
        AND hash_param_version IS NOT NULL
        AND hash_v1 ~ '^[a-z0-9]+[$][A-Za-z0-9=,]+[$][A-Za-z0-9+/=]+[$][A-Za-z0-9+/=]+$')
      OR
      (status = 'REVOKED' AND hash_v1 IS NULL AND hash_algorithm IS NULL
        AND hash_param_version IS NULL)
    ),
  CONSTRAINT ck_payment_credentials_lock_shape
    CHECK (
      (status = 'LOCKED' AND locked_until IS NOT NULL)
      OR (status <> 'LOCKED' AND locked_until IS NULL)
    )
);

CREATE TABLE credential_policies (
  policy_version integer PRIMARY KEY,
  min_digits integer NOT NULL,
  max_digits integer NOT NULL,
  max_failed_attempts integer NOT NULL,
  lock_duration_seconds integer NOT NULL,
  escalation_factor integer NOT NULL,
  cooldown_seconds integer NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_credential_policies_digits
    CHECK (min_digits >= 4 AND max_digits <= 12 AND min_digits <= max_digits),
  CONSTRAINT ck_credential_policies_attempts
    CHECK (max_failed_attempts >= 1 AND max_failed_attempts <= 10),
  CONSTRAINT ck_credential_policies_positive
    CHECK (lock_duration_seconds > 0 AND escalation_factor >= 1
      AND cooldown_seconds > 0)
);

INSERT INTO credential_policies
  (policy_version, min_digits, max_digits, max_failed_attempts,
   lock_duration_seconds, escalation_factor, cooldown_seconds)
VALUES
  (1, 6, 8, 5, 900, 2, 86400);

CREATE TABLE credential_sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid uuid NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL,
  order_ref text,
  amount_summary text,
  asset_summary text,
  action_nonce uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  CONSTRAINT fk_credential_sessions_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT uq_credential_sessions_action_nonce UNIQUE (action_nonce),
  CONSTRAINT ck_credential_sessions_purpose
    CHECK (purpose IN
      ('credential-setup', 'authorize-payment', 'credential-reset')),
  CONSTRAINT ck_credential_sessions_status
    CHECK (status IN ('OPEN', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED')),
  CONSTRAINT ck_credential_sessions_resolution
    CHECK (
      (status = 'OPEN' AND resolved_at IS NULL)
      OR (status <> 'OPEN' AND resolved_at IS NOT NULL)
    ),
  CONSTRAINT ck_credential_sessions_authorize_shape
    CHECK (
      (purpose <> 'authorize-payment')
      OR (order_ref IS NOT NULL AND amount_summary IS NOT NULL
        AND asset_summary IS NOT NULL)
    ),
  CONSTRAINT ck_credential_sessions_amount_decimal
    CHECK (amount_summary IS NULL OR amount_summary ~ '^[0-9]+(\.[0-9]+)?$')
);

CREATE INDEX ix_credential_sessions_uid
  ON credential_sessions(uid, status, created_at);

CREATE TABLE security_locks (
  lock_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid uuid NOT NULL,
  lock_reason text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at timestamptz,
  CONSTRAINT fk_security_locks_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT ck_security_locks_reason
    CHECK (lock_reason IN
      ('credential-failed-attempts', 'recovery-open', 'admin-hold')),
  CONSTRAINT ck_security_locks_release
    CHECK (
      (released_at IS NULL)
      OR (released_at IS NOT NULL AND released_at >= locked_at)
    )
);

CREATE INDEX ix_security_locks_uid ON security_locks(uid, released_at);

CREATE TABLE recovery_cases (
  case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid uuid NOT NULL,
  status text NOT NULL,
  factors_achieved integer NOT NULL DEFAULT 0,
  factors_required integer NOT NULL,
  evidence_ref text,
  cooldown_until timestamptz,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  CONSTRAINT fk_recovery_cases_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT ck_recovery_cases_status
    CHECK (status IN ('OPEN', 'PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  CONSTRAINT ck_recovery_cases_factors
    CHECK (factors_achieved >= 0 AND factors_required >= 2
      AND factors_achieved <= factors_required),
  CONSTRAINT ck_recovery_cases_cooldown
    CHECK (
      (status = 'APPROVED' AND resolved_at IS NOT NULL AND cooldown_until IS NOT NULL)
      OR (status <> 'APPROVED' AND cooldown_until IS NULL)
    )
);

CREATE INDEX ix_recovery_cases_uid ON recovery_cases(uid, status);

GRANT SELECT, INSERT, UPDATE
  ON payment_credentials, credential_policies, credential_sessions,
    security_locks, recovery_cases
  TO xht_platform;
