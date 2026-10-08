import { z } from "zod";

// The devices an Open Muse account uses, as the service records them: presence
// only, with no way to reach or control a device through this list.
export const deviceIdInput = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const deviceRegistration = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^\r\n]+$/),
    platform: z.enum(["mac", "ios", "android"]),
    app_version: z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/),
  })
  .strict();
export const deviceRecord = deviceRegistration
  .extend({ id: deviceIdInput, last_seen_at: z.number().int().nonnegative() })
  .strip();
export type DeviceRecord = z.infer<typeof deviceRecord>;
export type DeviceRegistration = z.infer<typeof deviceRegistration>;
export const deviceList = z.object({ devices: z.array(deviceRecord).max(50) });

// One Mac can sign in under several ids: each WebView data store (a reset, a
// reinstall, a separate profile) makes its own. A Mac reports the computer's
// own name, so Mac records that share a name stand for one Mac: keep the most
// recently seen and carry the other ids so removing it forgets them all.
// Phones are never merged, because iOS reports the same generic name for
// every iPhone and Android the same model name for every phone of a model.
export function mergeDevices(records: readonly DeviceRecord[]) {
  const merged: (DeviceRecord & { ids: string[] })[] = [];
  const macs = new Map<string, DeviceRecord & { ids: string[] }>();
  const latestFirst = [...records].sort(
    (a, b) => b.last_seen_at - a.last_seen_at,
  );
  for (const record of latestFirst) {
    const key = record.platform === "mac" ? record.name : undefined;
    const same = key === undefined ? undefined : macs.get(key);
    if (same) {
      same.ids.push(record.id);
      continue;
    }
    const entry = { ...record, ids: [record.id] };
    merged.push(entry);
    if (key !== undefined) macs.set(key, entry);
  }
  return merged;
}
