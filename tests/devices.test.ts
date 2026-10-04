import { describe, expect, it } from "vitest";
import { mergeDevices, type DeviceRecord } from "../shared/devices";

const device = (
  id: number,
  platform: DeviceRecord["platform"],
  name: string,
  last_seen_at: number,
): DeviceRecord => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  platform,
  name,
  app_version: "0.2.0",
  last_seen_at,
});

describe("mergeDevices", () => {
  it("shows one Mac signed in under several ids, as most recently seen", () => {
    const older = device(1, "mac", "Studio", 100);
    const newer = device(2, "mac", "Studio", 200);
    const merged = mergeDevices([older, newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: newer.id, last_seen_at: 200 });
    expect(merged[0].ids).toEqual([newer.id, older.id]);
  });

  it("keeps Macs with different names apart", () => {
    const merged = mergeDevices([
      device(1, "mac", "Studio", 100),
      device(2, "mac", "Laptop", 200),
    ]);
    expect(merged.map((entry) => entry.name)).toEqual(["Laptop", "Studio"]);
  });

  it("never merges iPhones, which all report a generic name", () => {
    const merged = mergeDevices([
      device(1, "ios", "iPhone", 100),
      device(2, "ios", "iPhone", 200),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.every((entry) => entry.ids.length === 1)).toBe(true);
  });

  it("does not merge a Mac with an iPhone of the same name", () => {
    expect(
      mergeDevices([
        device(1, "mac", "Home", 100),
        device(2, "ios", "Home", 200),
      ]),
    ).toHaveLength(2);
  });
});
