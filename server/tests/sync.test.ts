import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import type { Env } from "../src/env";
import { SYNC_LIMITS } from "../../shared/account-sync";
import { accountEnv, seedAccount, session, withAuth } from "./accounts";

const shared = {
  apiKey: "test-ark-key-shared-by-two-accounts-000",
  project: "",
  agentVersion: 1,
};
const config = (n: number) => ({
  ...shared,
  agentId: `agent-${n}`,
  environmentId: `env-${n}`,
  memoryStoreId: `memory-${n}`,
});
const post = {
  title: "A post",
  body: "Body",
  emoji: "",
  reason: "Because",
  category: "News",
  prompt: "Discuss",
  sources: [{ title: "Source", url: "https://example.com/a" }],
  kind: "feed",
  session_id: "sesn_1",
  event_id: "evt_1",
  created_at: "2026-10-01T00:00:00Z",
  liked: true,
};
let next = 0;
const mutation = (
  namespace: string,
  id: string,
  value: unknown,
  base_revision = 0,
  mutation_id = `mutation-${String(++next).padStart(12, "0")}`,
) => ({ namespace, id, value, base_revision, mutation_id });

describe("Account sync", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let env: Env;
  const deleteUser = vi.fn(async (_id: string) => {});
  const auth = withAuth();
  const [alice, bob] = [session(), session()];
  const workspaces: Record<string, string> = {};
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
      auth,
    );
  const pull = async (
    user = alice,
    after = 0,
    workspace = workspaces[user.owner],
  ) =>
    call(user.token, `/v1/account/sync?workspace=${workspace}&after=${after}`);
  const push = (
    user: typeof alice,
    mutations: unknown[],
    workspace = workspaces[user.owner],
  ) => call(user.token, "/v1/account/sync", "PUT", { workspace, mutations });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const read = async (res: Response | Promise<Response>): Promise<any> =>
    (await res).json();
  const results = async (res: Response) => {
    expect(res.status).toBe(200);
    return (await read(res)).results;
  };

  beforeAll(async () => {
    fixture = await database();
    env = accountEnv(fixture.db, {
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("k".repeat(32)) },
      }),
      DELETE_AUTH_USER: deleteUser,
    });
    for (const [user, n] of [
      [alice, 1],
      [bob, 2],
    ] as const)
      workspaces[user.owner] = (
        await seedAccount(env, user.owner, config(n))
      ).workspaceKey;
  });
  afterAll(async () => fixture?.dispose());

  it("requires a verified account and the account's current workspace", async () => {
    const anonymous = await handle(
      new Request(
        `https://background.example/v1/account/sync?workspace=${workspaces[alice.owner]}`,
      ),
      env,
      auth,
    );
    expect(anonymous.status).toBe(401);
    expect((await pull(alice, 0, "0".repeat(64))).status).toBe(409);
    expect((await pull(alice, 0, "not-a-key")).status).toBe(400);
    expect((await pull(alice, -1)).status).toBe(400);
    // Both accounts hold the same Ark key, yet neither reaches the other's
    // workspace: the key includes the verified owner.
    expect(workspaces[alice.owner]).not.toBe(workspaces[bob.owner]);
    const crossed = await pull(bob, 0, workspaces[alice.owner]);
    expect(crossed.status).toBe(409);
    expect((await read(crossed)).code).toBe("workspace_changed");
    expect(
      (
        await push(
          bob,
          [mutation("model", "choice", { model: "m", effort: "high" })],
          workspaces[alice.owner],
        )
      ).status,
    ).toBe(409);
  });

  it("rejects unknown namespaces and malformed batches, and invalid values per item", async () => {
    for (const mutations of [
      [mutation("goals", "x", {})],
      [],
      [mutation("model", "choice", null), mutation("model", "choice", null)],
      [{ ...mutation("model", "choice", null), extra: 1 }],
      [mutation("model", "bad id!", null)],
      [mutation("model", "choice", null, 0, "short")],
    ])
      expect((await push(alice, mutations)).status).toBe(400);
    const rejected = await results(
      await push(alice, [
        mutation("model", "other", { model: "m", effort: "high" }),
        mutation("feed", "post-1", {
          ...post,
          sources: [{ title: "x", url: "javascript:alert(1)" }],
        }),
        mutation("saved", "not-a-digest", { id: "a" }),
        mutation("archive", "sesn_1", { archived: false, title: "x" }),
        mutation("feed", "post-2", { ...post, body: "x".repeat(70_000) }),
      ]),
    );
    expect(
      rejected.map((r: { status: string; reason: string }) => [
        r.status,
        r.reason,
      ]),
    ).toEqual(Array(5).fill(["rejected", "invalid"]));
    expect((await read(pull())).items).toEqual([]);
  });

  it("creates, reads back, updates, and deletes with revisions", async () => {
    const created = await results(
      await push(alice, [
        mutation("model", "choice", { model: "doubao-seed", effort: "high" }),
        mutation("feed", "open-muse-feed-1-0", post),
        mutation("archive", "sesn_2", { archived: true, title: "Trip" }),
      ]),
    );
    expect(created.map((r: { status: string }) => r.status)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    const first = await read(pull());
    expect(first.hasMore).toBe(false);
    expect(first.items.map((i: { id: string }) => i.id)).toEqual([
      "choice",
      "open-muse-feed-1-0",
      "sesn_2",
    ]);
    expect(first.items[1]).toMatchObject({
      namespace: "feed",
      revision: 1,
      value: post,
    });
    const cursor = first.cursor;
    expect(cursor).toBe(first.items[2].seq);

    const updated = await results(
      await push(alice, [
        mutation("model", "choice", { model: "doubao-lite", effort: "low" }, 1),
        mutation("archive", "sesn_2", null, 1),
      ]),
    );
    expect(updated.map((r: { revision: number }) => r.revision)).toEqual([
      2, 2,
    ]);
    const later = await read(pull(alice, cursor));
    expect(later.items).toMatchObject([
      {
        id: "choice",
        revision: 2,
        value: { model: "doubao-lite", effort: "low" },
      },
      { id: "sesn_2", revision: 2, value: null },
    ]);
    expect(later.cursor).toBeGreaterThan(cursor);
    expect((await read(pull(alice, later.cursor))).items).toEqual([]);
    // A tombstone keeps its revision; creating again builds on it.
    const stale = await results(
      await push(alice, [
        mutation("archive", "sesn_2", { archived: true, title: "Trip" }),
      ]),
    );
    expect(stale[0]).toMatchObject({
      status: "conflict",
      item: { revision: 2, value: null },
    });
    const again = await results(
      await push(alice, [
        mutation("archive", "sesn_2", { archived: true, title: "Trip" }, 2),
      ]),
    );
    expect(again[0]).toMatchObject({ status: "applied", revision: 3 });
  });

  it("never overwrites a newer copy and returns it instead", async () => {
    const res = await results(
      await push(alice, [
        mutation("model", "choice", { model: "glm", effort: "high" }, 1),
      ]),
    );
    expect(res[0]).toMatchObject({
      status: "conflict",
      item: { revision: 2, value: { model: "doubao-lite", effort: "low" } },
    });
    const items = (await read(pull())).items;
    expect(items.find((i: { id: string }) => i.id === "choice").value).toEqual({
      model: "doubao-lite",
      effort: "low",
    });
  });

  it("applies a repeated mutation ID once", async () => {
    const write = mutation("feed", "settings", { instructionsDismissed: true });
    const first = await results(await push(alice, [write]));
    const before = (await read(pull())).cursor;
    const replay = await results(await push(alice, [write]));
    expect(replay).toEqual(first);
    expect((await read(pull())).cursor).toBe(before);
  });

  it("keeps each account's items to itself", async () => {
    expect((await read(pull(bob))).items).toEqual([]);
    const saved = {
      id: "local-id",
      title: "Saved",
      text: "Reply",
      session_id: "sesn_9",
      event_id: "evt_9",
      created_at: "2026-10-01T00:00:00Z",
    };
    const id = "a".repeat(64);
    await results(await push(bob, [mutation("saved", id, saved)]));
    expect((await read(pull(bob))).items).toMatchObject([{ id, value: saved }]);
    expect(
      (await read(pull())).items.some((i: { id: string }) => i.id === id),
    ).toBe(false);
    // Bob writing the same item IDs as Alice creates his own copies.
    const own = await results(
      await push(bob, [
        mutation("model", "choice", { model: "bob", effort: "high" }),
      ]),
    );
    expect(own[0]).toMatchObject({ status: "applied", revision: 1 });
  });

  it("refuses a sealed value moved to another item", async () => {
    const row = await env.DB.prepare(
      "SELECT encrypted FROM account_sync_items WHERE owner_id=? AND item_id='open-muse-feed-1-0'",
    )
      .bind(alice.owner)
      .first<{ encrypted: string }>();
    await env.DB.prepare(
      `INSERT INTO account_sync_items(owner_id,workspace_key,namespace,item_id,revision,encrypted,deleted,mutation_id,seq,updated_at)
      VALUES(?,?,'feed','open-muse-feed-2-0',1,?,0,'m',100000,0)`,
    )
      .bind(alice.owner, workspaces[alice.owner], row!.encrypted)
      .run();
    expect((await pull(alice, 99_999)).status).toBe(503);
    await env.DB.prepare(
      "DELETE FROM account_sync_items WHERE owner_id=? AND item_id='open-muse-feed-2-0'",
    )
      .bind(alice.owner)
      .run();
  });

  it("limits how many items one account keeps", async () => {
    const limit = SYNC_LIMITS.items;
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM account_sync_items WHERE owner_id=?",
    )
      .bind(alice.owner)
      .first<{ n: number }>();
    SYNC_LIMITS.items = Number(count!.n) + 1;
    try {
      const res = await results(
        await push(alice, [
          mutation("archive", "sesn_a", { archived: true, title: "A" }),
          mutation("archive", "sesn_b", { archived: true, title: "B" }),
          // Existing items still change at the limit.
          mutation("model", "choice", { model: "glm", effort: "high" }, 2),
        ]),
      );
      expect(res.map((r: { status: string }) => r.status)).toEqual([
        "applied",
        "rejected",
        "applied",
      ]);
      expect(res[1].reason).toBe("limit");
    } finally {
      SYNC_LIMITS.items = limit;
    }
  });

  it("pages large pulls", async () => {
    const base = (await read(pull(bob))).cursor;
    const page = SYNC_LIMITS.page;
    SYNC_LIMITS.page = 2;
    try {
      await results(
        await push(bob, [
          mutation("archive", "sesn_x", { archived: true, title: "X" }),
          mutation("archive", "sesn_y", { archived: true, title: "Y" }),
          mutation("archive", "sesn_z", { archived: true, title: "Z" }),
        ]),
      );
      const first = await read(pull(bob, base));
      expect(first.items).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      const second = await read(pull(bob, first.cursor));
      expect(second.items.map((i: { id: string }) => i.id)).toEqual(["sesn_z"]);
      expect(second.hasMore).toBe(false);
    } finally {
      SYNC_LIMITS.page = page;
    }
  });

  it("is part of the account's export, opened for that account only", async () => {
    const res = await call(alice.token, "/v1/account/export");
    expect(res.status).toBe(200);
    const text = await res.text();
    const items = JSON.parse(text).tables.account_sync_items;
    expect(items).toContainEqual(
      expect.objectContaining({
        namespace: "feed",
        item_id: "open-muse-feed-1-0",
        value: post,
      }),
    );
    expect(text).not.toContain("sesn_9");
    expect(text).not.toContain('"keyId"');
  });

  it("is removed with the account, leaving other accounts alone", async () => {
    const count = async (owner: string) =>
      Number(
        (
          await env.DB.prepare(
            "SELECT (SELECT count(*) FROM account_sync_items WHERE owner_id=?) + (SELECT count(*) FROM account_sync_counters WHERE owner_id=?) AS n",
          )
            .bind(owner, owner)
            .first<{ n: number }>()
        )?.n,
      );
    const bobs = await count(bob.owner);
    expect(await count(alice.owner)).toBeGreaterThan(0);
    const res = await call(alice.token, "/v1/account", "DELETE", {
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect(await count(alice.owner)).toBe(0);
    expect(await count(bob.owner)).toBe(bobs);
  });
});
