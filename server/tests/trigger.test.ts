import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import type { Env } from "../src/env";
import {
  apiOrigin,
  trigger,
  triggerHeaders,
} from "../deploy/volcengine/scheduler/trigger.mjs";

describe("External scheduler trigger", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let env: Env;
  const secret = "test-trigger-secret-".repeat(3);
  const origin = "https://api.example.com";
  const via =
    (target: Env): typeof fetch =>
    (input, init) =>
      handle(new Request(input as string, init), target);
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      SCHEDULER_SOURCE: "external",
      SCHEDULER_TRIGGER_SECRET: secret,
      ALLOWED_ORIGINS: "capacitor://localhost",
    };
  });
  afterAll(async () => fixture?.dispose());
  const call = (headers: Record<string, string>, target = env) =>
    handle(
      new Request(`${origin}/internal/scheduler/tick`, {
        method: "POST",
        headers,
      }),
      target,
    );

  it("accepts a signed trigger from the veFaaS function once", async () => {
    const config = { MUSE_API_ORIGIN: origin, SCHEDULER_TRIGGER_SECRET: secret };
    expect(await trigger(config, via(env))).toBe(200);
    const headers = triggerHeaders(secret);
    expect((await call(headers)).status).toBe(200);
    expect((await call(headers)).status).toBe(409);
  });

  it("rejects wrong secrets, stale timestamps, and browser origins", async () => {
    expect((await call(triggerHeaders("x".repeat(43)))).status).toBe(401);
    expect(
      (await call(triggerHeaders(secret, Date.now() - 6 * 60_000))).status,
    ).toBe(401);
    const forged = triggerHeaders(secret);
    expect(
      (await call({ ...forged, "X-Muse-Nonce": "a".repeat(32) })).status,
    ).toBe(401);
    expect((await call({})).status).toBe(401);
    expect(
      (
        await call({
          ...triggerHeaders(secret),
          Origin: "capacitor://localhost",
        })
      ).status,
    ).toBe(403);
  });

  it("is not served unless the deployment uses an external clock", async () => {
    expect(
      (await call(triggerHeaders(secret), { ...env, SCHEDULER_SOURCE: "" }))
        .status,
    ).toBe(404);
    expect(
      (
        await call(triggerHeaders(secret), {
          ...env,
          SCHEDULER_TRIGGER_SECRET: "short",
        })
      ).status,
    ).toBe(503);
  });

  it("only sends triggers to a configured HTTPS origin", async () => {
    expect(apiOrigin("https://api.example.com")).toBe(origin);
    expect(apiOrigin("https://api.example.com/functions/v1/open-muse/")).toBe(
      `${origin}/functions/v1/open-muse`,
    );
    for (const bad of [
      "http://api.example.com",
      "https://user:pass@api.example.com",
      "https://api.example.com?x=1",
    ])
      expect(() => apiOrigin(bad)).toThrow();
    await expect(
      trigger({ MUSE_API_ORIGIN: origin, SCHEDULER_TRIGGER_SECRET: "" }),
    ).rejects.toThrow();
  });
});
