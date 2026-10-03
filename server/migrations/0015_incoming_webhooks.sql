-- Incoming webhooks: per-account URLs that external systems post events to.
-- Each hook's secret is shown once and stored only as a SHA-256 hash.
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_delivery_at INTEGER
);
CREATE INDEX webhooks_owner ON webhooks(owner_id, created_at);
-- One row per accepted event: the MA event ID persisted before the message is
-- sent, the sender's event ID for deduplication, and the outcome. Ambiguous
-- sends stay 'unconfirmed' until history shows them and are never resent.
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  event_key TEXT,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'unconfirmed', 'rejected')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (webhook_id, event_key)
);
CREATE INDEX webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at);
CREATE INDEX webhook_deliveries_owner ON webhook_deliveries(owner_id, created_at);
