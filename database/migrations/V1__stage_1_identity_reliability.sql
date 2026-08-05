CREATE TABLE users (
  uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_users_status
    CHECK (status IN ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSED'))
);

CREATE TABLE memberships (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid uuid NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_memberships_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT uq_memberships_uid UNIQUE (uid),
  CONSTRAINT ck_memberships_status
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);

CREATE TABLE identity_profiles (
  uid uuid PRIMARY KEY,
  username_snapshot text,
  display_name_snapshot text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_identity_profiles_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT
);

CREATE TABLE channel_bindings (
  binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type text NOT NULL,
  external_user_id text NOT NULL,
  uid uuid NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT fk_channel_bindings_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT ck_channel_bindings_channel_type
    CHECK (channel_type = 'TELEGRAM'),
  CONSTRAINT ck_channel_bindings_external_user_id
    CHECK (length(external_user_id) BETWEEN 1 AND 255),
  CONSTRAINT ck_channel_bindings_status
    CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED', 'CONFLICTED')),
  CONSTRAINT ck_channel_bindings_revocation
    CHECK (
      (status = 'REVOKED' AND revoked_at IS NOT NULL)
      OR
      (status <> 'REVOKED' AND revoked_at IS NULL)
    )
);

CREATE UNIQUE INDEX uq_channel_bindings_active_external
  ON channel_bindings(channel_type, external_user_id)
  WHERE status = 'ACTIVE';
CREATE INDEX ix_channel_bindings_uid ON channel_bindings(uid);

CREATE TABLE registration_idempotency (
  registration_key uuid PRIMARY KEY,
  channel_type text NOT NULL,
  external_user_id text NOT NULL,
  uid uuid,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  failure_code text,
  failed_at timestamptz,
  conflicted_at timestamptz,
  CONSTRAINT fk_registration_idempotency_uid
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE RESTRICT,
  CONSTRAINT uq_registration_channel_external
    UNIQUE (channel_type, external_user_id),
  CONSTRAINT ck_registration_channel_type
    CHECK (channel_type = 'TELEGRAM'),
  CONSTRAINT ck_registration_external_user_id
    CHECK (length(external_user_id) BETWEEN 1 AND 255),
  CONSTRAINT ck_registration_status
    CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED', 'CONFLICT')),
  CONSTRAINT ck_registration_outcome
    CHECK (
      (
        status = 'PROCESSING'
        AND uid IS NULL
        AND completed_at IS NULL
        AND failure_code IS NULL
        AND failed_at IS NULL
        AND conflicted_at IS NULL
      )
      OR
      (
        status = 'COMPLETED'
        AND uid IS NOT NULL
        AND completed_at IS NOT NULL
        AND failure_code IS NULL
        AND failed_at IS NULL
        AND conflicted_at IS NULL
      )
      OR
      (
        status = 'FAILED'
        AND uid IS NULL
        AND completed_at IS NULL
        AND failure_code IS NOT NULL
        AND failed_at IS NOT NULL
        AND conflicted_at IS NULL
      )
      OR
      (
        status = 'CONFLICT'
        AND uid IS NULL
        AND completed_at IS NULL
        AND failure_code IS NOT NULL
        AND failed_at IS NULL
        AND conflicted_at IS NOT NULL
      )
    )
);

CREATE INDEX ix_registration_uid
  ON registration_idempotency(uid)
  WHERE uid IS NOT NULL;

CREATE TABLE inbox_messages (
  inbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer text NOT NULL,
  external_message_id text NOT NULL,
  payload_digest text NOT NULL,
  digest_key_version text NOT NULL,
  correlation_id uuid NOT NULL,
  status text NOT NULL,
  received_at timestamptz NOT NULL,
  claimed_by text,
  claim_generation integer NOT NULL DEFAULT 0,
  claimed_until timestamptz,
  processed_at timestamptz,
  failure_code text,
  CONSTRAINT uq_inbox_consumer_external
    UNIQUE (consumer, external_message_id),
  CONSTRAINT ck_inbox_consumer
    CHECK (length(consumer) BETWEEN 1 AND 100),
  CONSTRAINT ck_inbox_external_message_id
    CHECK (length(external_message_id) BETWEEN 1 AND 255),
  CONSTRAINT ck_inbox_payload_digest
    CHECK (payload_digest ~ '^hmac-sha256:[A-Za-z0-9_-]{43}$'),
  CONSTRAINT ck_inbox_digest_key_version
    CHECK (digest_key_version ~ '^v[1-9][0-9]{0,8}$'),
  CONSTRAINT ck_inbox_claim_generation
    CHECK (claim_generation >= 0),
  CONSTRAINT ck_inbox_status
    CHECK (status IN ('RECEIVED', 'CLAIMED', 'PROCESSED', 'CONFLICT', 'FAILED')),
  CONSTRAINT ck_inbox_state
    CHECK (
      (
        status = 'RECEIVED'
        AND claimed_by IS NULL
        AND claimed_until IS NULL
        AND processed_at IS NULL
        AND failure_code IS NULL
      )
      OR
      (
        status = 'CLAIMED'
        AND claimed_by IS NOT NULL
        AND claimed_until IS NOT NULL
        AND processed_at IS NULL
        AND failure_code IS NULL
      )
      OR
      (
        status = 'PROCESSED'
        AND processed_at IS NOT NULL
        AND failure_code IS NULL
      )
      OR
      (
        status IN ('CONFLICT', 'FAILED')
        AND processed_at IS NULL
        AND failure_code IS NOT NULL
      )
    )
);

CREATE INDEX ix_inbox_claimable
  ON inbox_messages(status, claimed_until, received_at, inbox_id);

CREATE TABLE outbox_messages (
  outbox_id uuid PRIMARY KEY,
  topic text NOT NULL,
  event_key text NOT NULL,
  version integer NOT NULL,
  payload jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  status text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL,
  locked_by text,
  lock_generation integer NOT NULL DEFAULT 0,
  lease_token uuid,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  succeeded_at timestamptz,
  CONSTRAINT uq_outbox_topic_event_key UNIQUE (topic, event_key),
  CONSTRAINT ck_outbox_version CHECK (version = 1),
  CONSTRAINT ck_outbox_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_outbox_lock_generation CHECK (lock_generation >= 0),
  CONSTRAINT ck_outbox_status CHECK (
    status IN (
      'READY', 'LEASED', 'SUCCEEDED', 'RETRY_WAIT',
      'DEAD_LETTER', 'PAUSED', 'WAITING_CONFIGURATION'
    )
  ),
  CONSTRAINT ck_outbox_lease CHECK (
    (
      status = 'LEASED'
      AND locked_by IS NOT NULL
      AND lease_token IS NOT NULL
      AND locked_until IS NOT NULL
    )
    OR
    (
      status <> 'LEASED'
      AND locked_by IS NULL
      AND lease_token IS NULL
      AND locked_until IS NULL
    )
  ),
  CONSTRAINT ck_outbox_succeeded CHECK (
    (status = 'SUCCEEDED' AND succeeded_at IS NOT NULL)
    OR
    (status <> 'SUCCEEDED' AND succeeded_at IS NULL)
  )
);

CREATE INDEX ix_outbox_claimable
  ON outbox_messages(status, available_at, locked_until, created_at, outbox_id);

CREATE TABLE durable_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  business_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL,
  locked_by text,
  lock_generation integer NOT NULL DEFAULT 0,
  lease_token uuid,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  succeeded_at timestamptz,
  CONSTRAINT uq_durable_job_business_key UNIQUE (job_type, business_key),
  CONSTRAINT ck_durable_jobs_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_durable_jobs_lock_generation CHECK (lock_generation >= 0),
  CONSTRAINT ck_durable_jobs_status CHECK (
    status IN (
      'READY', 'LEASED', 'SUCCEEDED', 'RETRY_WAIT',
      'DEAD_LETTER', 'PAUSED', 'WAITING_CONFIGURATION'
    )
  ),
  CONSTRAINT ck_durable_jobs_lease CHECK (
    (
      status = 'LEASED'
      AND locked_by IS NOT NULL
      AND lease_token IS NOT NULL
      AND locked_until IS NOT NULL
    )
    OR
    (
      status <> 'LEASED'
      AND locked_by IS NULL
      AND lease_token IS NULL
      AND locked_until IS NULL
    )
  ),
  CONSTRAINT ck_durable_jobs_succeeded CHECK (
    (status = 'SUCCEEDED' AND succeeded_at IS NOT NULL)
    OR
    (status <> 'SUCCEEDED' AND succeeded_at IS NULL)
  )
);

CREATE INDEX ix_durable_jobs_claimable
  ON durable_jobs(status, available_at, locked_until, created_at, job_id);

CREATE TABLE audit_events (
  audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_ref text NOT NULL,
  subject_ref text NOT NULL,
  outcome text NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL
);

GRANT SELECT, INSERT, UPDATE
  ON users, memberships, identity_profiles, channel_bindings,
     registration_idempotency, inbox_messages
  TO xht_platform;
GRANT SELECT, INSERT ON outbox_messages TO xht_platform;
GRANT SELECT, INSERT ON audit_events TO xht_platform;

GRANT SELECT ON channel_bindings TO xht_worker;
GRANT SELECT, UPDATE ON outbox_messages TO xht_worker;
GRANT SELECT, INSERT, UPDATE ON durable_jobs TO xht_worker;
GRANT SELECT, INSERT ON audit_events TO xht_worker;
