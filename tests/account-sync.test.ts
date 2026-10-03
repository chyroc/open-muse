import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  AccountSync,
  mergeSynced,
  savedItemId,
  syncAdapters,
} from "../src/direct/account-sync";
import { LocalDatabase } from "../src/direct/storage";
import { Client } from "../src/api";
import type { AccountProvider } from "../src/direct/auth";
import type { ConversationIndex } from "../src/direct/conversations";
import { digest, uuid } from "../shared/crypto";
import { accountWorkspaceKey } from "../shared/workspace-key";
import { MA } from "../src/direct/transport";
import type {
  SyncItem,
  SyncMutation,
  SyncResult,
} from "../shared/account-sync";
import type { InspirationItem } from "../shared/inspiration";
import type { LibraryItem } from "../shared/types";

// An in-memory service with the same per-item rules as the real one:
// revisions, compare-and-swap on the base, idempotent mutation IDs, and an
// ordered change sequence per workspace.
function service() {
  const items = new Map<string, SyncItem & { workspace: string }>();
  let seq = 0;
  const calls: { op: string; workspace: string; mutations?: SyncMutation[] }[] =
    [];
  const failAfterApply = { next: false };
  return {
    items,
    calls,
    failAfterApply,
    async pull(workspace: string, after: number) {
      calls.push({ op: "pull", workspace });
      const list = [...items.values()]
        .filter((item) => item.workspace === workspace && item.seq > after)
        .sort((a, b) => a.seq - b.seq)
        .map(({ workspace: _w, ...item }) => item);
      return {
        items: list,
        cursor: list.length ? list[list.length - 1].seq : after,
        hasMore: false,
      };
    },
    async push(workspace: string, mutations: SyncMutation[]) {
      calls.push({ op: "push", workspace, mutations });
      const results: SyncResult[] = mutations.map((m) => {
        const key = `${workspace}/${m.namespace}/${m.id}`;
        const current = items.get(key);
        const view = current
          ? (({ workspace: _w, ...item }) => item)(current)
          : null;
        if (current?.mutation_id === m.mutation_id)
          return {
            status: "applied",
            namespace: m.namespace,
            id: m.id,
            revision: current.revision,
            seq: current.seq,
          };
        if ((current?.revision ?? 0) !== m.base_revision)
          return {
            status: "conflict",
            namespace: m.namespace,
            id: m.id,
            item: view,
          };
        const item = {
          workspace,
          namespace: m.namespace,
          id: m.id,
          revision: m.base_revision + 1,
          value: m.value,
          mutation_id: m.mutation_id,
          seq: ++seq,
          updated_at: 0,
        };
        items.set(key, item);
        return {
          status: "applied",
          namespace: m.namespace,
          id: m.id,
          revision: item.revision,
          seq: item.seq,
        };
      });
      if (failAfterApply.next) {
        failAfterApply.next = false;
        throw new Error("network lost");
      }
      return { results };
    },
  };
}

const workspace = (n: string) => digest(`workspace-${n}`);
const post = (id: string, extra: Partial<InspirationItem> = {}) =>
  ({
    id,
    title: "Post",
    body: "Body",
    emoji: "",
    reason: "Because",
    category: "News",
    prompt: "Discuss",
    sources: [],
    kind: "feed",
    session_id: "sesn_1",
    event_id: "evt_1",
    created_at: "2026-10-01T00:00:00Z",
    liked: false,
    ...extra,
  }) as InspirationItem;
const saved: LibraryItem = {
  id: "local-1",
  title: "Trip",
  text: "Reply",
  session_id: "sesn_2",
  event_id: "evt_2",
  created_at: "2026-10-01T00:00:00Z",
};

function device(
  server: ReturnType<typeof service>,
  key = workspace("a"),
  owner = "muse_user_a",
  active = () => true,
) {
  const db = new LocalDatabase(`account-sync-${uuid()}`);
  return {
    db,
    key,
    sync: new AccountSync(
      db,
      owner,
      key,
      server,
      syncAdapters(db, key),
      active,
    ),
  };
}

describe("Account sync merge", () => {
  it("keeps fields changed only here and takes the service's value on both", () => {
    const base = { liked: false, discussion_id: undefined, title: "a" };
    expect(
      mergeSynced(
        base,
        { ...base, liked: true },
        { ...base, discussion_id: "s" },
      ),
    ).toEqual({
      value: { liked: true, discussion_id: "s", title: "a" },
      conflict: false,
    });
    expect(
      mergeSynced(
        base,
        { ...base, title: "mine" },
        { ...base, title: "theirs" },
      ),
    ).toEqual({ value: { ...base, title: "theirs" }, conflict: true });
    expect(mergeSynced(null, { a: 1 }, { a: 2 })).toEqual({
      value: { a: 2 },
      conflict: true,
    });
    expect(mergeSynced({ a: 1 }, { a: 1 }, null)).toEqual({
      value: null,
      conflict: false,
    });
  });
});

describe("Account sync", () => {
  it("uploads this account's records and applies them on another device", async () => {
    const server = service();
    const a = device(server);
    await a.db.set(`${a.key}:model`, {
      model: "doubao-seed-2-1-pro-260915",
      effort: "high",
    });
    await a.db.set(`${a.key}:inspiration:v1`, {
      items: [post("open-muse-feed-1-0", { liked: true })],
      runs: {},
      instructionsDismissed: true,
    });
    await a.db.set(`${a.key}:library`, [saved]);
    await a.db.set<ConversationIndex>(`${a.key}:conversations:v1`, {
      mainId: "sesn_main",
      entries: {
        sesn_main: { title: "Main", kind: "main", archived: false },
        sesn_side: { title: "Side", kind: "side", archived: true },
        sesn_open: { title: "Open", kind: "side", archived: false },
      },
    });
    const report = await a.sync.sync();
    expect(report).toMatchObject({ pushed: 5, conflicts: 0, rejected: 0 });
    expect(await a.sync.pending()).toBe(0);

    const b = device(server);
    await b.sync.sync();
    expect(await b.db.get(`${b.key}:model`)).toEqual({
      model: "doubao-seed-2-1-pro-260915",
      effort: "high",
    });
    const feed = await b.db.get<{
      items: InspirationItem[];
      instructionsDismissed: boolean;
    }>(`${b.key}:inspiration:v1`);
    expect(feed?.instructionsDismissed).toBe(true);
    expect(feed?.items).toEqual([post("open-muse-feed-1-0", { liked: true })]);
    expect(await b.db.get(`${b.key}:library`)).toEqual([saved]);
    const index = await b.db.get<ConversationIndex>(
      `${b.key}:conversations:v1`,
    );
    expect(index?.entries).toEqual({
      sesn_side: { title: "Side", kind: "side", archived: true },
    });
    // Nothing applied on B goes back to the service.
    const pushes = server.calls.filter((c) => c.op === "push").length;
    await b.sync.sync();
    expect(server.calls.filter((c) => c.op === "push").length).toBe(pushes);
  });

  it("merges a like and a discussion link made on two devices", async () => {
    const server = service();
    const a = device(server);
    await a.db.set(`${a.key}:inspiration:v1`, {
      items: [post("p-0")],
      runs: {},
      instructionsDismissed: false,
    });
    await a.sync.sync();
    const b = device(server);
    await b.sync.sync();
    await a.db.update<{ items: InspirationItem[] }>(
      `${a.key}:inspiration:v1`,
      (s) => ({ ...s!, items: [{ ...s!.items[0], liked: true }] }),
    );
    await b.db.update<{ items: InspirationItem[] }>(
      `${b.key}:inspiration:v1`,
      (s) => ({ ...s!, items: [{ ...s!.items[0], discussion_id: "sesn_d" }] }),
    );
    await a.sync.sync();
    const report = await b.sync.sync();
    expect(report.conflicts).toBe(0);
    await a.sync.sync();
    for (const d of [a, b])
      expect(
        (
          await d.db.get<{ items: InspirationItem[] }>(
            `${d.key}:inspiration:v1`,
          )
        )?.items[0],
      ).toMatchObject({ liked: true, discussion_id: "sesn_d" });
  });

  it("keeps the service's model when both devices changed it", async () => {
    const server = service();
    const a = device(server);
    const b = device(server);
    await a.db.set(`${a.key}:model`, {
      model: "deepseek-v4-pro-ga-260813",
      effort: "high",
    });
    await a.sync.sync();
    const choice = { model: "doubao-seed-2-1-pro-260915", effort: "low" };
    await b.db.set(`${b.key}:model`, choice);
    const report = await b.sync.sync();
    expect(report.conflicts).toBe(1);
    void choice;
    expect(await b.db.get(`${b.key}:model`)).toEqual({
      model: "deepseek-v4-pro-ga-260813",
      effort: "high",
    });
    expect(await b.sync.pending()).toBe(0);
    expect([...server.items.values()][0].revision).toBe(1);
  });

  it("resends an unconfirmed change with the same mutation ID and writes it once", async () => {
    const server = service();
    const a = device(server);
    await a.db.set(`${a.key}:library`, [saved]);
    server.failAfterApply.next = true;
    await expect(a.sync.sync()).rejects.toThrow("network lost");
    expect(await a.sync.pending()).toBe(1);
    const first = server.calls.find((c) => c.op === "push")!.mutations![0];
    await a.sync.sync();
    expect(await a.sync.pending()).toBe(0);
    const item = server.items.get(`${a.key}/saved/${savedItemId(saved)}`)!;
    expect(item).toMatchObject({ revision: 1, mutation_id: first.mutation_id });
    expect(server.calls.filter((c) => c.op === "push")).toHaveLength(1);
  });

  it("never sends one account's pending changes after switching accounts", async () => {
    const server = service();
    let signedIn = "muse_user_a";
    const a = device(
      server,
      workspace("a"),
      "muse_user_a",
      () => signedIn === "muse_user_a",
    );
    await a.db.set(`${a.key}:library`, [saved]);
    server.failAfterApply.next = true;
    await expect(a.sync.sync()).rejects.toThrow();
    // Undo the write the failed push made, so A's change is really pending.
    server.items.clear();
    signedIn = "muse_user_b";
    await expect(a.sync.sync()).rejects.toThrow("stopped");
    // B's sync on the same device database sees none of A's outbox.
    const b = new AccountSync(
      a.db,
      "muse_user_b",
      workspace("b"),
      server,
      syncAdapters(a.db, workspace("b")),
      () => signedIn === "muse_user_b",
    );
    await b.sync();
    expect(
      server.calls
        .filter((c) => c.op === "push")
        .slice(1)
        .every((c) => c.workspace === workspace("b")),
    ).toBe(true);
    expect(server.items.size).toBe(0);
    expect(await a.sync.pending()).toBe(1);
  });

  it("restores an archived chat elsewhere and never archives a main chat", async () => {
    const server = service();
    const a = device(server);
    const b = device(server);
    await a.db.set<ConversationIndex>(`${a.key}:conversations:v1`, {
      entries: {
        sesn_side: { title: "Side", kind: "side", archived: true },
        sesn_main_b: { title: "B main", kind: "side", archived: true },
      },
    });
    await b.db.set<ConversationIndex>(`${b.key}:conversations:v1`, {
      mainId: "sesn_main_b",
      entries: {
        sesn_main_b: { title: "Main", kind: "main", archived: false },
      },
    });
    await a.sync.sync();
    await b.sync.sync();
    let index = await b.db.get<ConversationIndex>(`${b.key}:conversations:v1`);
    expect(index?.entries.sesn_main_b.archived).toBe(false);
    expect(index?.entries.sesn_side.archived).toBe(true);
    expect(await b.sync.pending()).toBe(0);
    await a.db.update<ConversationIndex>(`${a.key}:conversations:v1`, (i) => {
      i!.entries.sesn_side.archived = false;
      return i!;
    });
    await a.sync.sync();
    await b.sync.sync();
    index = await b.db.get<ConversationIndex>(`${b.key}:conversations:v1`);
    expect(index?.entries.sesn_side.archived).toBe(false);
    // B's main chat stays archived for A, as A chose.
    expect(
      server.items.get(`${a.key}/archive/sesn_main_b`)?.value,
    ).toMatchObject({ archived: true });
  });

  it("keeps a model this app does not offer without overwriting it", async () => {
    const server = service();
    const a = device(server);
    server.items.set(`${a.key}/model/choice`, {
      workspace: a.key,
      namespace: "model",
      id: "choice",
      revision: 1,
      value: { model: "a-future-model", effort: "high" },
      mutation_id: "m".repeat(20),
      seq: 1,
      updated_at: 0,
    });
    await a.db.set(`${a.key}:model`, {
      model: "doubao-seed-2-1-pro-260915",
      effort: "high",
    });
    await a.sync.sync();
    expect(server.calls.some((c) => c.op === "push")).toBe(false);
    expect(await a.db.get(`${a.key}:model`)).toEqual({
      model: "doubao-seed-2-1-pro-260915",
      effort: "high",
    });
  });

  it("keeps a reply too long to sync on this device without offering it again", async () => {
    const server = service();
    const a = device(server);
    await a.db.set(`${a.key}:library`, [
      { ...saved, text: "x".repeat(25_000) },
    ]);
    expect((await a.sync.sync()).rejected).toBe(1);
    await a.sync.sync();
    expect(server.calls.some((c) => c.op === "push")).toBe(false);
    expect(await a.db.get<LibraryItem[]>(`${a.key}:library`)).toHaveLength(1);
  });
});

describe("Client account sync", () => {
  const apiKey = "ark-test-key-0000000000000000";
  function accountClient(
    server: ReturnType<typeof service>,
    db: LocalDatabase,
    who: { owner: string },
  ) {
    const account = {
      accountConfigured: () => true,
      accountOwner: () => who.owner,
      restore: async () => {},
      accountCredential: async () => ({
        configured: true,
        revision: 1,
        updatedAt: 0,
        credential: { apiKey, project: "" },
      }),
      pullAccountSync: vi.fn(server.pull),
      pushAccountSync: vi.fn(server.push),
    } as unknown as AccountProvider;
    const vault = { read: async () => "", write: async () => {} };
    return {
      account,
      client: new Client({
        vault,
        database: db,
        account,
        fetcher: vi.fn<typeof fetch>(),
      }),
    };
  }

  it("syncs the model choice between two devices of one account", async () => {
    const server = service();
    const who = { owner: "muse_user_one" };
    const first = accountClient(server, new LocalDatabase(`c-${uuid()}`), who);
    const second = accountClient(server, new LocalDatabase(`c-${uuid()}`), who);
    await first.client.restore();
    await second.client.restore();
    // Let the launch passes finish first.
    await first.client.syncAccountData();
    await second.client.syncAccountData();
    await first.client.setModelChoice({
      model: "doubao-seed-2-1-pro-260915",
      effort: "low",
    });
    await first.client.syncAccountData();
    await second.client.syncAccountData();
    expect(await second.client.modelChoice()).toEqual({
      model: "doubao-seed-2-1-pro-260915",
      effort: "low",
    });
    const key = accountWorkspaceKey(apiKey, "", who.owner, MA);
    expect(server.calls.every((c) => c.workspace === key)).toBe(true);
  });

  it("does not sync in local mode", async () => {
    const db = new LocalDatabase(`c-${uuid()}`);
    const client = new Client({
      vault: {
        read: async () =>
          JSON.stringify({ kind: "api_key", apiKey, project: "" }),
        write: async () => {},
      },
      database: db,
      fetcher: vi.fn<typeof fetch>(),
    });
    await client.restore();
    await client.setModelChoice({
      model: "doubao-seed-2-1-pro-260915",
      effort: "low",
    });
    expect(client.syncAccountData()).toBeUndefined();
  });

  it("starts a separate sync after switching accounts", async () => {
    const server = service();
    const who = { owner: "muse_user_one" };
    const db = new LocalDatabase(`c-${uuid()}`);
    const { client } = accountClient(server, db, who);
    await client.restore();
    await client.syncAccountData();
    await client.setModelChoice({
      model: "doubao-seed-2-1-pro-260915",
      effort: "low",
    });
    who.owner = "muse_user_two";
    await client.accountChanged();
    await client.syncAccountData();
    const second = accountWorkspaceKey(apiKey, "", "muse_user_two", MA);
    const pushes = server.calls.filter((c) => c.op === "push");
    expect(pushes.every((c) => c.workspace === second)).toBe(true);
    expect(pushes.flatMap((c) => c.mutations ?? [])).toEqual([]);
  });
});
