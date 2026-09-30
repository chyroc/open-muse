-- Account bindings sealed before ownership records existed were never checked
-- for resource ownership. Revoke them: the account's client binds again and
-- records ownership. Unfinished runs stop without cancelling accepted MA work.
UPDATE schedules SET enabled=0,next_run_at=NULL,revision=revision+1
WHERE owner_id IN (
  SELECT owner_id FROM ark_connections WHERE owner_id GLOB 'muse_user_*'
  AND encrypted IS NOT NULL AND owner_id NOT IN (SELECT owner_id FROM account_resources)
);
UPDATE runs SET resume_phase=CASE WHEN phase='needs_attention' THEN resume_phase ELSE phase END,
  phase=CASE WHEN phase IN ('queued','creating','ready') OR
    (phase='needs_attention' AND resume_phase IN ('queued','creating','ready')) THEN 'failed' ELSE 'needs_attention' END,
  prompt='',lease_token=NULL,lease_until=NULL,
  error='Background credentials were removed. Existing MA work is not cancelled.'
WHERE phase NOT IN ('complete','failed') AND owner_id IN (
  SELECT owner_id FROM ark_connections WHERE owner_id GLOB 'muse_user_*'
  AND encrypted IS NOT NULL AND owner_id NOT IN (SELECT owner_id FROM account_resources)
);
UPDATE ark_connections SET revision=revision+1,encrypted=NULL,mutation_id='migration-0006'
WHERE owner_id GLOB 'muse_user_*' AND encrypted IS NOT NULL
AND owner_id NOT IN (SELECT owner_id FROM account_resources);
