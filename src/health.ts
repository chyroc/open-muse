import { z } from "zod";
import type { HealthQuery } from "../shared/health";

type Handler = { postMessage(body: object): Promise<unknown> };
const handler = () =>
  (
    globalThis as {
      webkit?: { messageHandlers?: { museHealth?: Handler } };
    }
  ).webkit?.messageHandlers?.museHealth;

// Present only in the iPhone app, which registers the native Health reader.
export const healthSupported = () => Boolean(handler());

// HealthKit asks for permission per type on first use, then the native side
// returns a compact JSON summary for the requested range.
export async function readHealth(query: HealthQuery) {
  const native = handler();
  if (!native) throw new Error("Apple Health is not available here.");
  const result = await native.postMessage({
    operation: "read",
    metric: query.metric,
    start: query.startMs,
    end: query.endMs,
    granularity: query.granularity,
  });
  return z.string().min(2).max(60000).parse(result);
}

// Whether this iPhone has already asked for Health access. HealthKit does not
// reveal what the person allowed, only that the question was asked.
export async function healthAccess() {
  const native = handler();
  if (!native) return "unavailable" as const;
  return z
    .enum(["requested", "not_requested", "unavailable"])
    .parse(await native.postMessage({ operation: "access" }));
}

// Shows HealthKit's permission sheet for every metric this app can read.
export async function connectHealth() {
  const native = handler();
  if (!native) throw new Error("Apple Health is not available here.");
  await native.postMessage({ operation: "authorize" });
}
