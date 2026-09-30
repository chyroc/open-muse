-- Each account's workspace configuration, sealed per account and workspace key.
-- Resources are created by the service and recorded from its own responses.
CREATE TABLE account_workspaces (
  owner_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  encrypted TEXT,
  pending TEXT,
  updated_at INTEGER NOT NULL,
  mutation_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, workspace_key)
);
CREATE TABLE account_rate_limits (
  owner_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (owner_id, bucket)
);
-- Records made by clients from resource labels could be raced by another
-- holder of the same key, so only service-created resources remain recorded.
-- Every account binding made before this is revoked and the client binds its
-- service-created workspace again. Accepted MA work is not cancelled.
UPDATE schedules SET enabled=0,next_run_at=NULL,revision=revision+1
WHERE owner_id IN (
  SELECT owner_id FROM ark_connections WHERE owner_id GLOB 'muse_user_*' AND encrypted IS NOT NULL
);
UPDATE runs SET resume_phase=CASE WHEN phase='needs_attention' THEN resume_phase ELSE phase END,
  phase=CASE WHEN phase IN ('queued','creating','ready') OR
    (phase='needs_attention' AND resume_phase IN ('queued','creating','ready')) THEN 'failed' ELSE 'needs_attention' END,
  prompt='',lease_token=NULL,lease_until=NULL,
  error='Background credentials were removed. Existing MA work is not cancelled.'
WHERE phase NOT IN ('complete','failed') AND owner_id IN (
  SELECT owner_id FROM ark_connections WHERE owner_id GLOB 'muse_user_*' AND encrypted IS NOT NULL
);
UPDATE ark_connections SET revision=revision+1,encrypted=NULL,mutation_id='migration-0007'
WHERE owner_id GLOB 'muse_user_*' AND encrypted IS NOT NULL;
DELETE FROM account_resources;
