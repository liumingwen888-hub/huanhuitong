CREATE TABLE callback_inbox (
  callback_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  provider_event_id text NOT NULL,
  provider_idempotency_key text NOT NULL,
  reported_status text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_callback_inbox_provider_event
    UNIQUE (provider_id, provider_event_id),
  CONSTRAINT ck_callback_inbox_status
    CHECK (reported_status IN ('SUCCEEDED', 'FAILED', 'REVERSED'))
);

CREATE INDEX ix_callback_inbox_key
  ON callback_inbox(provider_idempotency_key, received_at);

GRANT SELECT, INSERT ON callback_inbox TO xht_platform;
GRANT SELECT ON callback_inbox TO xht_worker;
