-- Personal settings and lists kept in step across one account's devices,
-- per workspace key. Each value is sealed with the account and names its
-- workspace key, namespace, and item ID. A deleted item keeps a tombstone
-- (no value) so a device that has not synced yet cannot bring it back.
-- seq orders an account's changes for incremental pulls.
CREATE TABLE account_sync_items (
  owner_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  namespace TEXT NOT NULL CHECK (namespace IN ('model', 'feed', 'saved', 'archive')),
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  encrypted TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  mutation_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, workspace_key, namespace, item_id)
);
CREATE INDEX account_sync_items_seq ON account_sync_items(owner_id, workspace_key, seq);
-- The last sequence number handed out per account.
CREATE TABLE account_sync_counters (
  owner_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
);
