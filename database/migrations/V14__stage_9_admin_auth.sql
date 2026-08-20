CREATE TABLE admin_credentials (
  admin_id uuid PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  totp_secret_ref text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_admin_credentials_username UNIQUE (username),
  CONSTRAINT fk_admin_credentials_admin
    FOREIGN KEY (admin_id) REFERENCES admin_principals(admin_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_admin_credentials_username
    CHECK (username ~ '^[a-z0-9-]{3,32}$'),
  CONSTRAINT ck_admin_credentials_attempts
    CHECK (failed_attempts >= 0),
  CONSTRAINT ck_admin_credentials_totp_ref
    CHECK (totp_secret_ref ~ '^vault:[A-Za-z0-9_-]{4,64}$')
);

GRANT SELECT, UPDATE (password_hash, failed_attempts, locked_until,
  updated_at) ON admin_credentials TO xht_platform;

CREATE TABLE admin_sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  elevated_until timestamptz,
  revoked_at timestamptz,
  CONSTRAINT uq_admin_sessions_token UNIQUE (token_hash),
  CONSTRAINT fk_admin_sessions_admin
    FOREIGN KEY (admin_id) REFERENCES admin_principals(admin_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_admin_sessions_expiry CHECK (expires_at > created_at)
);

CREATE INDEX ix_admin_sessions_active
  ON admin_sessions(admin_id) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE (revoked_at, elevated_until)
  ON admin_sessions TO xht_platform;

INSERT INTO admin_principals (admin_id, status)
VALUES ('11111111-1111-4111-8111-111111111111', 'ACTIVE');

INSERT INTO admin_role_grants (admin_id, role)
VALUES ('11111111-1111-4111-8111-111111111111', 'SUPER_ADMIN');

INSERT INTO admin_credentials
  (admin_id, username, password_hash, totp_secret_ref)
VALUES
  ('11111111-1111-4111-8111-111111111111',
   'bootstrap-admin',
   '$argon2id$v=19$m=19456,t=3,p=1$aGh0LWJvb3RzdHJhcC1hZG1pbi1zYWx0LTAx$JkbPkSPTYnmBn4j2Tz3AlGsCfPtFVo7bBF31vTXj24o',
   'vault:bootstrap-totp-v1');
