import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { tokenHash } from "../src/auth";
import type { Env } from "../src/env";

describe("Private native API", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let env: Env;
  const token = "muse_device_" + "test-device-token-".repeat(3);
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      OWNER_ID: "test-owner",
      DEVICE_TOKEN_HASHES: JSON.stringify({
        [await tokenHash(token)]: "test-device",
      }),
      ALLOWED_ORIGINS: "capacitor://localhost,muse://app",
    };
  });
  afterAll(async () => fixture?.dispose());
  const req = (path: string, headers: Record<string, string> = {}) =>
    new Request(`https://example.com${path}`, { headers });
  it("serves health without exposing configuration", async () => {
    const res = await handle(req("/health"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "open-muse-server" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("fails closed without credentials", async () => {
    expect((await handle(req("/v1/status"), env)).status).toBe(401);
    expect(
      (
        await handle(req("/v1/status"), {
          ...env,
          DEVICE_TOKEN_HASHES: undefined,
        })
      ).status,
    ).toBe(503);
  });
  it("authenticates separate device tokens, not body-selected identities", async () => {
    const res = await handle(
      req("/v1/status?owner=someone-else", {
        Authorization: `Bearer ${token}`,
      }),
      env,
    );
    expect(await res.json()).toMatchObject({
      owner: "test-owner",
      backgroundReady: false,
    });
  });
  it("enforces native origin allowlisting, even with a valid token", async () => {
    expect(
      (
        await handle(
          req("/v1/status", {
            Authorization: `Bearer ${token}`,
            Origin: "https://evil.example",
          }),
          env,
        )
      ).status,
    ).toBe(403);
    const res = await handle(
      req("/v1/status", {
        Authorization: `Bearer ${token}`,
        Origin: "muse://app",
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("muse://app");
  });
  it("does not log or reflect invalid secrets", async () => {
    const res = await handle(
      req("/v1/status", { Authorization: "Bearer private-invalid-value" }),
      env,
    );
    expect(await res.text()).not.toContain("private-invalid-value");
  });
  const write = (
    path: string,
    value: unknown,
    method = "PUT",
    key = "test-idempotency-key",
  ) =>
    new Request(`https://example.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(value),
    });
  const configured = () => ({
    ...env,
    OWNER_ID: crypto.randomUUID(),
    BACKGROUND_ENABLED: "true",
    ARK_API_KEY: "test-key",
    ARK_AGENT_ID: "agent-test",
    ARK_AGENT_VERSION: "1",
    ARK_ENVIRONMENT_ID: "env-test",
    ARK_MEMORY_STORE_ID: "mem-test",
  });
  it("requires configured MA and consent before enabling a schedule", async () => {
    const value = {
      enabled: true,
      timezone: "UTC",
      local_time: "09:00",
      revision: 0,
      confirm: true,
    };
    expect((await handle(write("/v1/schedule", value), env)).status).toBe(409);
    expect(
      (
        await handle(
          write("/v1/schedule", { ...value, confirm: false }),
          configured(),
        )
      ).status,
    ).toBe(409);
    expect(
      (await handle(write("/v1/schedule", value), configured())).status,
    ).toBe(200);
  });
  it("permits pausing even when MA is disabled", async () => {
    expect(
      (
        await handle(
          write("/v1/schedule", {
            enabled: false,
            timezone: "UTC",
            local_time: "09:00",
            revision: 0,
          }),
          { ...env, OWNER_ID: crypto.randomUUID() },
        )
      ).status,
    ).toBe(200);
  });
  it("enqueues an explicit action once without running MA in the HTTP request", async () => {
    const e = configured();
    const first = await handle(write("/v1/runs", { confirm: true }, "POST"), e);
    const second = await handle(
      write("/v1/runs", { confirm: true }, "POST"),
      e,
    );
    expect(first.status).toBe(202);
    expect(((await first.json()) as { id: string }).id).toBe(
      ((await second.json()) as { id: string }).id,
    );
    const res = await handle(
      req("/v1/runs", { Authorization: `Bearer ${token}` }),
      e,
    );
    expect(await res.json()).toMatchObject({ runs: [{ phase: "queued" }] });
  });
  it("rejects unexpected fields, malformed timezones, and oversized bodies", async () => {
    expect(
      (
        await handle(
          write("/v1/schedule", {
            enabled: false,
            timezone: "bad/zone",
            local_time: "09:00",
            revision: 0,
          }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handle(
          write("/v1/runs", { confirm: true, owner: "other" }, "POST"),
          configured(),
        )
      ).status,
    ).toBe(400);
    expect(
      (await handle(write("/v1/runs", { text: "x".repeat(5000) }, "POST"), env))
        .status,
    ).toBe(413);
  });
  it("does not return prompt or operation secrets in run history", async () => {
    const e = configured();
    await handle(write("/v1/runs", { confirm: true }, "POST"), e);
    const res = await handle(
      req("/v1/runs", { Authorization: `Bearer ${token}` }),
      e,
    );
    const text = await res.text();
    expect(text).not.toContain("prompt");
    expect(text).not.toContain("connection_hash");
    expect(text).not.toContain("lease_token");
  });
});
