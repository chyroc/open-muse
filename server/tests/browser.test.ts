import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import type { Env } from "../src/env";

const origin = "https://auth.example.com";
const users: Record<string, string> = {
  "alice-access-token-000000001": "159c19ab-cfba-4436-9038-87f5fca38a4b",
  "bob-access-token-00000000001": "316c004b-07b0-4675-9b8d-deb5a740f03b",
};
const [ALICE, BOB] = Object.keys(users);
const upstream = vi.fn<typeof fetch>(async (_input, init) => {
  const bearer = (new Headers(init?.headers).get("Authorization") ?? "").slice(
    7,
  );
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
// The sandbox helper: no Origin, only the view's token.
const sandbox = (id: string, token: string, body: unknown, origin?: string) =>
  handle(
    new Request(`https://background.example/v1/browser/relay/${id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
    upstream,
  );
const frame = {
  image: "AAAA",
  url: "https://example.com/",
  title: "Example",
  width: 1280,
  height: 800,
};

describe("Cloud browser relay", () => {
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

  it("relays frames to the account and its input to the sandbox", async () => {
    const opened = (await (
      await call(ALICE, "/v1/browser/views", "POST")
    ).json()) as {
      id: string;
      token: string;
    };
    expect(opened.token.length).toBeGreaterThan(30);
    expect(
      await (await call(ALICE, `/v1/browser/views/${opened.id}/frame`)).json(),
    ).toMatchObject({ open: true, seq: 0 });
    expect(
      await (
        await sandbox(opened.id, opened.token, { after: 0, ...frame })
      ).json(),
    ).toEqual({ open: true, events: [] });
    const seen = (await (
      await call(ALICE, `/v1/browser/views/${opened.id}/frame?after=0`)
    ).json()) as Record<string, unknown>;
    expect(seen).toMatchObject({
      open: true,
      seq: 1,
      image: "AAAA",
      title: "Example",
      width: 1280,
    });
    expect(
      await (
        await call(ALICE, `/v1/browser/views/${opened.id}/frame?after=1`)
      ).json(),
    ).not.toHaveProperty("image");
    expect(
      (
        await call(ALICE, `/v1/browser/views/${opened.id}/input`, "POST", {
          events: [
            { type: "click", x: 0.5, y: 0.25 },
            { type: "text", text: "secret words" },
          ],
        })
      ).status,
    ).toBe(200);
    const taken = (await (
      await sandbox(opened.id, opened.token, { after: 0 })
    ).json()) as {
      events: { seq: number; event: unknown }[];
    };
    expect(taken.events).toEqual([
      { seq: 1, event: { type: "click", x: 0.5, y: 0.25 } },
      { seq: 2, event: { type: "text", text: "secret words" } },
    ]);
    // Input is stored sealed and removed once handled.
    const stored = await fixture.db
      .prepare("SELECT encrypted FROM browser_inputs")
      .all<{ encrypted: string }>();
    expect(JSON.stringify(stored.results)).not.toContain("secret words");
    await sandbox(opened.id, opened.token, { after: 2 });
    expect(
      (await fixture.db
        .prepare("SELECT COUNT(*) AS n FROM browser_inputs")
        .first<{ n: number }>())!.n,
    ).toBe(0);
    expect(
      (await call(ALICE, `/v1/browser/views/${opened.id}`, "DELETE")).status,
    ).toBe(200);
    expect(
      await (await sandbox(opened.id, opened.token, { after: 2 })).json(),
    ).toEqual({ open: false, events: [] });
  });

  it("serves the sandbox helper without an account", async () => {
    const helper = await handle(
      new Request("https://background.example/v1/browser/helper"),
      env,
      upstream,
    );
    expect(helper.status).toBe(200);
    const source = await helper.text();
    expect(source).toContain("def main():");
    expect(source).not.toContain("__WIDTH__");
  });

  it("keeps views private to their account and token", async () => {
    const opened = (await (
      await call(ALICE, "/v1/browser/views", "POST")
    ).json()) as {
      id: string;
      token: string;
    };
    expect(
      (await call(BOB, `/v1/browser/views/${opened.id}/frame`)).status,
    ).toBe(404);
    expect(
      (
        await call(BOB, `/v1/browser/views/${opened.id}/input`, "POST", {
          events: [{ type: "back" }],
        })
      ).status,
    ).toBe(404);
    expect(
      (await sandbox(opened.id, "x".repeat(43), { after: 0 })).status,
    ).toBe(404);
    expect(
      (
        await sandbox(
          opened.id,
          opened.token,
          { after: 0 },
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    // Opening another view ends the earlier one.
    await call(ALICE, "/v1/browser/views", "POST");
    expect((await sandbox(opened.id, opened.token, { after: 0 })).status).toBe(
      404,
    );
  });

  it("accepts only known input and well-formed frames", async () => {
    const opened = (await (
      await call(ALICE, "/v1/browser/views", "POST")
    ).json()) as {
      id: string;
      token: string;
    };
    for (const events of [
      [{ type: "click", x: 2, y: 0 }],
      [{ type: "navigate", url: "javascript:alert(1)" }],
      [{ type: "key", key: "F12" }],
      [{ type: "text", text: "" }],
      [],
    ])
      expect(
        (
          await call(ALICE, `/v1/browser/views/${opened.id}/input`, "POST", {
            events,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await sandbox(opened.id, opened.token, {
          after: 0,
          ...frame,
          image: "<svg>",
        })
      ).status,
    ).toBe(400);
    expect((await sandbox(opened.id, opened.token, { after: -1 })).status).toBe(
      400,
    );
  });
});
