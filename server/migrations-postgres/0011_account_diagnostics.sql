-- Redacted records of what went wrong for an account, kept for 14 days so a
-- problem can be looked into: failures the service answered itself, and
-- reports the person chose to send. Only request labels, statuses, error
-- codes, request IDs, platform, and versions, never message text or keys.
CREATE TABLE account_diagnostics (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'report')),
  created_at BIGINT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX account_diagnostics_created ON account_diagnostics(created_at);
