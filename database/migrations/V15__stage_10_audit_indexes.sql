CREATE INDEX ix_audit_events_occurred
  ON audit_events(occurred_at DESC, audit_event_id DESC);

CREATE INDEX ix_audit_events_actor
  ON audit_events(actor_ref, occurred_at DESC);

CREATE INDEX ix_ledger_transactions_key_pattern
  ON ledger_transactions(idempotency_key text_pattern_ops);

CREATE INDEX ix_exchange_orders_status
  ON exchange_orders(status, created_at DESC);

CREATE INDEX ix_payout_orders_status
  ON payout_orders(status, created_at DESC);
