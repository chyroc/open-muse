import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { ConnectionStore } from "../src/connection";
import type { Env } from "../src/env";
import {
  accountEnv,
  arkWorkspaces,
  seedAccount,
  session,
  withAuth,
} from "./accounts";

describe("Native API", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let env: Env;
  const user = session();
  const auth = withAuth();
  beforeAll(async () => {
    fixture = await database();
    env = accountEnv(fixture.db, {
      ALLOWED_ORIGINS: "capacitor://localhost,muse://app",
    });
  });
  afterAll(async () => fixture?.dispose());
  const req = (
    path: string,
    headers: Record<string, string> = {},
    token: string | null = user.token,
  ) =>
    new Request(`https://example.com${path}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  it("serves health without exposing configuration", async () => {
    const res = await handle(req("/health", {}, null), env, auth);
    expect(res.status).toBe(200);
    // Only liveness, scheduler times, and a rotation count: no configuration.
    expect(await res.json()).toEqual({
      ok: true,
      service: "open-muse-server",
      scheduler: { lastTickAt: null, lastFailureAt: null, stale: false },
      keyRotation: { pending: null },
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("fails closed without credentials or without account configuration", async () => {
    expect((await handle(req("/v1/status", {}, null), env, auth)).status).toBe(
      401,
    );
    for (const missing of [
      { SUPABASE_AUTH_URL: undefined },
      { SUPABASE_AUTH_URL: undefined, SUPABASE_ANON_KEY: undefined },
    ]) {
      const never = withAuth();
      const res = await handle(req("/v1/status"), { ...env, ...missing }, never);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "Open Muse accounts are not configured.",
      });
      expect(never).not.toHaveBeenCalled();
    }
  });
  it("rejects former private device tokens", async () => {
    const token = "muse_device_" + "a".repeat(40);
    const res = await handle(req("/v1/status", {}, token), env, auth);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(token);
    expect(
      (await handle(req("/v1/status", {}, token), { ...env, SUPABASE_AUTH_URL: undefined }, auth))
        .status,
    ).toBe(503);
  });
  it("authenticates verified account sessions, not query-selected identities", async () => {
    const res = await handle(
      req(`/v1/status?owner=${session().owner}`),
      env,
      auth,
    );
    expect(await res.json()).toMatchObject({
      owner: user.owner,
      backgroundReady: false,
      account: { provider: "supabase" },
    });
  });
  it("enforces native origin allowlisting, even with a valid session", async () => {
    expect(
      (await handle(req("/v1/status", { Origin: "https://evil.example" }), env, auth))
        .status,
    ).toBe(403);
    const res = await handle(
      req("/v1/status", { Origin: "muse://app" }),
      env,
      auth,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("muse://app");
  });
  it("does not log or reflect invalid secrets", async () => {
    const res = await handle(
      req("/v1/status", {}, "private-invalid-value-0001"),
      env,
      auth,
    );
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("private-invalid-value");
  });
  const write = (
    token: string,
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
  // A fresh account whose own workspace is bound for background work.
  const configured = async () => {
    const account = session();
    const e = {
      ...env,
      BACKGROUND_ENABLED: "true",
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("a".repeat(32)) },
      }),
    };
    // Resource IDs are unique per account.
    const workspace = {
      apiKey: `test-key-${account.id}`,
      project: "",
      agentId: `agent-${account.id}`,
      agentVersion: 1,
      environmentId: `env-${account.id}`,
      memoryStoreId: `mem-${account.id}`,
    };
    const binding = await seedAccount(e, account.owner, workspace);
    await new ConnectionStore(e, account.owner).save(
      workspace,
      0,
      binding,
      Date.now(),
      arkWorkspaces([{ owner: account.owner, config: workspace }]),
    );
    return { env: e, token: account.token };
  };
  it("requires configured MA and consent before enabling a schedule", async () => {
    const value = {
      enabled: true,
      timezone: "UTC",
      local_time: "09:00",
      revision: 0,
      confirm: true,
    };
    expect(
      (await handle(write(user.token, "/v1/schedule", value), env, auth))
        .status,
    ).toBe(409);
    const a = await configured();
    expect(
      (
        await handle(
          write(a.token, "/v1/schedule", { ...value, confirm: false }),
          a.env,
          auth,
        )
      ).status,
    ).toBe(409);
    expect(
      (await handle(write(a.token, "/v1/schedule", value), a.env, auth))
        .status,
    ).toBe(200);
  });
  it("permits pausing even when MA is disabled", async () => {
    expect(
      (
        await handle(
          write(session().token, "/v1/schedule", {
            enabled: false,
            timezone: "UTC",
            local_time: "09:00",
            revision: 0,
          }),
          env,
          auth,
        )
      ).status,
    ).toBe(200);
  });
  it("enqueues an explicit action once without running MA in the HTTP request", async () => {
    const a = await configured();
    const first = await handle(
      write(a.token, "/v1/runs", { confirm: true }, "POST"),
      a.env,
      auth,
    );
    const second = await handle(
      write(a.token, "/v1/runs", { confirm: true }, "POST"),
      a.env,
      auth,
    );
    expect(first.status).toBe(202);
    expect(((await first.json()) as { id: string }).id).toBe(
      ((await second.json()) as { id: string }).id,
    );
    const res = await handle(req("/v1/runs", {}, a.token), a.env, auth);
    expect(await res.json()).toMatchObject({ runs: [{ phase: "queued" }] });
  });
  it("rejects unexpected fields, malformed timezones, and oversized bodies", async () => {
    expect(
      (
        await handle(
          write(user.token, "/v1/schedule", {
            enabled: false,
            timezone: "bad/zone",
            local_time: "09:00",
            revision: 0,
          }),
          env,
          auth,
        )
      ).status,
    ).toBe(400);
    const a = await configured();
    expect(
      (
        await handle(
          write(a.token, "/v1/runs", { confirm: true, owner: "other" }, "POST"),
          a.env,
          auth,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handle(
          write(user.token, "/v1/runs", { text: "x".repeat(5000) }, "POST"),
          env,
          auth,
        )
      ).status,
    ).toBe(413);
  });
  it("does not return prompt or operation secrets in run history", async () => {
    const a = await configured();
    await handle(write(a.token, "/v1/runs", { confirm: true }, "POST"), a.env, auth);
    const res = await handle(req("/v1/runs", {}, a.token), a.env, auth);
    const text = await res.text();
    expect(text).not.toContain("prompt");
    expect(text).not.toContain("connection_hash");
    expect(text).not.toContain("lease_token");
  });
});
