-- Synced items may also hold the account's main chat.
ALTER TABLE account_sync_items DROP CONSTRAINT account_sync_items_namespace_check;
ALTER TABLE account_sync_items ADD CONSTRAINT account_sync_items_namespace_check
  CHECK (namespace IN ('model', 'feed', 'saved', 'archive', 'main'));
