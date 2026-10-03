-- Synced items may also hold the account's main chat. SQLite cannot change a
-- CHECK constraint in place, so the table is rebuilt with its rows.
ALTER TABLE account_sync_items RENAME TO account_sync_items_previous;
CREATE TABLE account_sync_items (
  owner_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  namespace TEXT NOT NULL CHECK (namespace IN ('model', 'feed', 'saved', 'archive', 'main')),
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  encrypted TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  mutation_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, workspace_key, namespace, item_id)
);
INSERT INTO account_sync_items(owner_id, workspace_key, namespace, item_id, revision, encrypted, deleted, mutation_id, seq, updated_at)
  SELECT owner_id, workspace_key, namespace, item_id, revision, encrypted, deleted, mutation_id, seq, updated_at
  FROM account_sync_items_previous;
DROP TABLE account_sync_items_previous;
CREATE INDEX account_sync_items_seq ON account_sync_items(owner_id, workspace_key, seq);
