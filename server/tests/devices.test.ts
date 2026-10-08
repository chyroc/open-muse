import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { rewrapRetiredKeys } from "../src/account";
import type { Env } from "../src/env";

const origin = "https://auth.example.com";
const users: Record<string, string> = {
  "alice-access-token-000000001": "159c19ab-cfba-4436-9038-87f5fca38a4b",
  "bob-access-token-00000000001": "316c004b-07b0-4675-9b8d-deb5a740f03b",
};
const [ALICE, BOB] = Object.keys(users);
const mac = "0b4f3c4e-8a7d-4c1e-9f2a-6d5e4c3b2a10";
const phone = "7c6b5a49-3827-4615-8a9b-0c1d2e3f4a5b";
const upstream = vi.fn<typeof fetch>(async (input, init) => {
  const bearer = (new Headers(init?.headers).get("Authorization") ?? "").slice(
    7,
  );
  expect(new URL(String(input)).origin).toBe(origin);
  const id = users[bearer];
  return id
    ? Response.json({ id, is_anonymous: false })
    : Response.json({}, { status: 401 });
});
let env: Env;
const call = (token: string, path: string, method = "GET", body?: unknown) =>
  handle(
    new Request(`https://background.example${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    upstream,
  );
const device = (name: string, platform = "mac") => ({
  name,
  platform,
  app_version: "0.2.0",
});

describe("Account device registry", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      SUPABASE_AUTH_URL: origin,
      SUPABASE_ANON_KEY: "sb_publishable_test_public_key_only",
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("k".repeat(32)) },
      }),
    };
  });
  afterAll(async () => fixture?.dispose());

  it("lists an account's own devices, newest first, with sealed names", async () => {
    expect(
      (await call(ALICE, `/v1/account/devices/${mac}`, "PUT", device("Studio Mac")))
        .status,
    ).toBe(200);
    const saved = await call(
      ALICE,
      `/v1/account/devices/${phone}`,
      "PUT",
      device("Pocket", "ios"),
    );
    expect(await saved.json()).toMatchObject({
      id: phone,
      name: "Pocket",
      platform: "ios",
      app_version: "0.2.0",
    });
    const list = (await (await call(ALICE, "/v1/account/devices")).json()) as {
      devices: { id: string; name: string }[];
    };
    expect(list.devices.map((d) => [d.id, d.name])).toEqual([
      [phone, "Pocket"],
      [mac, "Studio Mac"],
    ]);
    const stored = await env.DB.prepare(
      "SELECT encrypted FROM account_devices",
    ).all<{ encrypted: string }>();
    for (const row of stored.results) {
      expect(row.encrypted).not.toContain("Studio Mac");
      expect(row.encrypted).not.toContain("Pocket");
    }
  });

  it("registers the Android app", async () => {
    const android = "5d4c3b2a-1908-4f7e-8d6c-5b4a39281706";
    const saved = await call(
      ALICE,
      `/v1/account/devices/${android}`,
      "PUT",
      device("Pixel 10a", "android"),
    );
    expect(await saved.json()).toMatchObject({
      id: android,
      name: "Pixel 10a",
      platform: "android",
    });
    expect(
      (await call(ALICE, `/v1/account/devices/${android}`, "DELETE")).status,
    ).toBe(200);
  });

  it("never shows or changes another account's devices", async () => {
    expect(
      await (await call(BOB, "/v1/account/devices")).json(),
    ).toEqual({ devices: [] });
    // The same install ID under another account is a separate record.
    expect(
      (await call(BOB, `/v1/account/devices/${mac}`, "PUT", device("Bob's Mac")))
        .status,
    ).toBe(200);
    expect((await call(BOB, `/v1/account/devices/${phone}`, "DELETE")).status).toBe(
      200,
    );
    const alice = (await (await call(ALICE, "/v1/account/devices")).json()) as {
      devices: { id: string; name: string }[];
    };
    expect(alice.devices.map((d) => d.name).sort()).toEqual([
      "Pocket",
      "Studio Mac",
    ]);
  });

  it("refuses a name moved to another device row", async () => {
    const owner = await env.DB.prepare(
      "SELECT owner_id FROM account_devices WHERE device_id=? ORDER BY created_at LIMIT 1",
    )
      .bind(phone)
      .first<{ owner_id: string }>();
    const rows = await env.DB.prepare(
      "SELECT device_id,encrypted FROM account_devices WHERE owner_id=? AND device_id IN (?,?)",
    )
      .bind(owner!.owner_id, mac, phone)
      .all<{ device_id: string; encrypted: string }>();
    const [a, b] = rows.results;
    const swap = (row: typeof a, encrypted: string) =>
      env.DB.prepare(
        "UPDATE account_devices SET encrypted=? WHERE owner_id=? AND device_id=?",
      )
        .bind(encrypted, owner!.owner_id, row.device_id)
        .run();
    await swap(a, b.encrypted);
    await swap(b, a.encrypted);
    expect(await (await call(ALICE, "/v1/account/devices")).json()).toEqual({
      devices: [],
    });
    await swap(a, a.encrypted);
    await swap(b, b.encrypted);
  });

  it("forgets a device and caps how many an account can register", async () => {
    expect((await call(ALICE, `/v1/account/devices/${phone}`, "DELETE")).status).toBe(
      200,
    );
    expect((await call(ALICE, `/v1/account/devices/${phone}`, "DELETE")).status).toBe(
      200,
    );
    for (let i = 0; i < 19; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      expect(
        (await call(ALICE, `/v1/account/devices/${id}`, "PUT", device(`Mac ${i}`)))
          .status,
      ).toBe(200);
    }
    expect(
      (await call(ALICE, `/v1/account/devices/${phone}`, "PUT", device("One more")))
        .status,
    ).toBe(409);
    // An existing device can still check in.
    expect(
      (await call(ALICE, `/v1/account/devices/${mac}`, "PUT", device("Renamed Mac")))
        .status,
    ).toBe(200);
  });

  it("validates input and keeps the registry to accounts", async () => {
    for (const body of [
      { ...device("Mac"), platform: "windows" },
      { ...device("") },
      { ...device("Two\nlines") },
      { ...device("Mac"), app_version: "1.0 beta" },
      { ...device("Mac"), owner: "someone" },
    ])
      expect(
        (await call(ALICE, `/v1/account/devices/${mac}`, "PUT", body)).status,
      ).toBe(400);
    expect(
      (await call(ALICE, "/v1/account/devices/not-a-uuid", "PUT", device("Mac")))
        .status,
    ).toBe(404);
    expect(
      (
        await call(
          "unknown-access-token-0000001",
          "/v1/account/devices",
        )
      ).status,
    ).not.toBe(200);
  });

  it("rewraps device names when the encryption key rotates", async () => {
    env = {
      ...env,
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v2",
        keys: { v1: btoa("k".repeat(32)), v2: btoa("n".repeat(32)) },
      }),
    };
    await rewrapRetiredKeys(env, 100);
    const old = await env.DB.prepare(
      `SELECT count(*) AS n FROM account_devices WHERE encrypted LIKE '%"keyId":"v1"%'`,
    ).first<{ n: number }>();
    expect(old?.n).toBe(0);
    env = {
      ...env,
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v2",
        keys: { v2: btoa("n".repeat(32)) },
      }),
    };
    const list = (await (await call(ALICE, "/v1/account/devices")).json()) as {
      devices: { id: string; name: string }[];
    };
    expect(list.devices.find((d) => d.id === mac)?.name).toBe("Renamed Mac");
  });
});
