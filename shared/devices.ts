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
    platform: z.enum(["mac", "ios"]),
    app_version: z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/),
  })
  .strict();
export const deviceRecord = deviceRegistration
  .extend({ id: deviceIdInput, last_seen_at: z.number().int().nonnegative() })
  .strip();
export type DeviceRecord = z.infer<typeof deviceRecord>;
export type DeviceRegistration = z.infer<typeof deviceRegistration>;
export const deviceList = z.object({ devices: z.array(deviceRecord).max(50) });
