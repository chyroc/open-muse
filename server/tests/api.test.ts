import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { tokenHash } from "../src/auth";
import type { Env } from "../src/env";

describe("Private native API", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let env: Env;
  const token = "test-device-token-".repeat(3);
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
});
