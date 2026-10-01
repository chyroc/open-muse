-- Devices an account's apps registered, for presence only. The device name is
-- sealed with the account. Platform and app version are not personal data.
CREATE TABLE account_devices (
  owner_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('mac', 'ios')),
  app_version TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  encrypted TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, device_id)
);
