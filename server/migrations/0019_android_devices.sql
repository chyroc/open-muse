-- The Android app also registers in an account's device list. SQLite cannot
-- change a CHECK constraint in place, so the table is rebuilt with its rows.
ALTER TABLE account_devices RENAME TO account_devices_previous;
CREATE TABLE account_devices (
  owner_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('mac', 'ios', 'android')),
  app_version TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, device_id)
);
INSERT INTO account_devices(owner_id, device_id, platform, app_version, revision, encrypted, created_at, last_seen_at)
  SELECT owner_id, device_id, platform, app_version, revision, encrypted, created_at, last_seen_at
  FROM account_devices_previous;
DROP TABLE account_devices_previous;
