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
const call = (token: string, path: string, method = "GET") =>
  handle(
    new Request(`https://background.example${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    }),
    env,
    upstream,
  );
// lark-cli's state helper in a sandbox: no Origin, only its token.
const sandbox = (
  token: string,
  method: "GET" | "PUT",
  body?: unknown,
  origin?: string,
) =>
  handle(
    new Request("https://background.example/v1/lark/sandbox/state", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
    upstream,
  );
const issue = async (user: string) =>
  (await (await call(user, "/v1/lark/tokens", "POST")).json()) as {
    token: string;
    expires_at: number;
  };

describe("Saved Lark sign-in", () => {
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

  it("carries the state from one sandbox to the next, sealed", async () => {
    const first = await issue(ALICE);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await (await sandbox(first.token, "GET")).json()).toEqual({
      revision: 0,
      state: null,
    });
    const saved = await sandbox(first.token, "PUT", {
      state: "c3RhdGUtb25l",
      base_revision: 0,
    });
    expect(await saved.json()).toEqual({ revision: 1 });
    // Stored sealed, never as the archive itself.
    const all = await env.DB.prepare("SELECT encrypted FROM lark_states").all<{
      encrypted: string;
    }>();
    expect(all.results[0].encrypted).not.toContain("c3RhdGUtb25l");
    expect(await (await call(ALICE, "/v1/lark/state")).json()).toMatchObject({
      saved: true,
    });
    // A later conversation's sandbox reads it with its own token.
    const second = await issue(ALICE);
    expect(await (await sandbox(second.token, "GET")).json()).toEqual({
      revision: 1,
      state: "c3RhdGUtb25l",
    });
    // A stale write is refused; written again at the current revision.
    await sandbox(second.token, "PUT", {
      state: "c3RhdGUtdHdv",
      base_revision: 1,
    });
    const stale = await sandbox(first.token, "PUT", {
      state: "c3RhdGUtb2xk",
      base_revision: 1,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "lark_state_changed" });
    // Signing out in the sandbox empties it.
    expect(
      await (
        await sandbox(first.token, "PUT", { state: null, base_revision: 2 })
      ).json(),
    ).toEqual({ revision: 3 });
    expect(await (await call(ALICE, "/v1/lark/state")).json()).toEqual({
      saved: false,
    });
  });

  it("keeps each account's state to itself and its tokens", async () => {
    const alice = await issue(ALICE);
    const { revision } = (await (
      await sandbox(alice.token, "GET")
    ).json()) as { revision: number };
    await sandbox(alice.token, "PUT", {
      state: "YWxpY2U=",
      base_revision: revision,
    });
    const bob = await issue(BOB);
    expect(await (await sandbox(bob.token, "GET")).json()).toEqual({
      revision: 0,
      state: null,
    });
    for (const token of ["", "not-a-real-token-0000000000000000000"]) {
      const response = await sandbox(token, "GET");
      expect(response.status).toBe(401);
    }
    // Only server-to-server: a browser origin is refused.
    expect(
      (await sandbox(alice.token, "GET", undefined, "https://evil.example"))
        .status,
    ).toBe(403);
  });

  it("forgets the state and every token when the person removes it", async () => {
    const token = (await issue(ALICE)).token;
    const removed = await call(ALICE, "/v1/lark/state", "DELETE");
    expect(await removed.json()).toEqual({ saved: false });
    expect((await sandbox(token, "GET")).status).toBe(401);
    const fresh = await issue(ALICE);
    expect(await (await sandbox(fresh.token, "GET")).json()).toEqual({
      revision: 0,
      state: null,
    });
  });

  it("refuses expired tokens and malformed archives", async () => {
    const now = Date.now();
    const token = (await issue(BOB)).token;
    for (const body of [
      { state: "not base64!", base_revision: 0 },
      { state: "", base_revision: 0 },
      { state: "AAAA", base_revision: -1 },
      { state: "AAAA" },
      { state: "AAAA", base_revision: 0, extra: 1 },
      { state: "A".repeat(1_000_001), base_revision: 0 },
    ])
      expect((await sandbox(token, "PUT", body)).status).toBe(400);
    const spy = vi
      .spyOn(Date, "now")
      .mockReturnValue(now + 31 * 24 * 60 * 60 * 1000);
    try {
      expect((await sandbox(token, "GET")).status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });
});
