-- The Android app also registers in an account's device list.
ALTER TABLE account_devices DROP CONSTRAINT account_devices_platform_check;
ALTER TABLE account_devices ADD CONSTRAINT account_devices_platform_check
  CHECK (platform IN ('mac', 'ios', 'android'));
