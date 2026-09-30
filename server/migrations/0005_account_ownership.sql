-- Server-side ownership of account workspace resources. A resource ID can be
-- bound by only one account, even when several accounts share one Ark key.
CREATE TABLE account_resources (
  kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (kind, resource_id)
);
ALTER TABLE account_credentials ADD COLUMN issuer TEXT;
ALTER TABLE account_credentials ADD COLUMN last_seen_at INTEGER;
CREATE TABLE account_key_checks (
  owner_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
