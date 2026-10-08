import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ArkClient } from "../shared/ark";
import { digest, uuid } from "../shared/crypto";
import { avatarStyles } from "../shared/avatar";
import { identityDefaults, systemWithIdentity } from "../shared/identity";
import { emptyGoalsDocument } from "../shared/goals";
import { DirectIdentity, defaultIdentity } from "../src/direct/identity";
import { LocalDatabase } from "../src/direct/storage";

function fixture() {
  const stores: { id: string; metadata: Record<string, string> }[] = [];
  const docs = new Map<
    string,
    { id: string; path: string; content: string }[]
  >();
  const db = new LocalDatabase(`identity-test-${uuid()}`);
  const handler: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const [, group, store, collection, id] = url.pathname.split("/");
    expect(group).toBe("memory_stores");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (collection) {
      expect(collection).toBe("memories");
      const rows = docs.get(store) ?? [];
      docs.set(store, rows);
      if (body) {
        if (id)
          Object.assign(
            rows.find((row) => row.id === id)!,
            body,
          );
        else {
          expect(body.path).toMatch(/^\//);
          expect(body.path).toMatch(/\.(md|txt)$/);
          rows.push({ ...body, id: `doc-${rows.length + 1}` });
        }
        return Response.json({ id: id ?? rows.at(-1)?.id });
      }
      const row = rows.find((row) => row.id === id);
      // Exercise the API's whitespace normalization and unusable revision fields.
      return Response.json(
        id
          ? {
              ...row,
              content: row?.content.trim(),
              memory_version_id: "",
              content_size_bytes: -1,
            }
          : { data: rows.map(({ content: _, ...doc }) => doc) },
      );
    }
    if (body) {
      const created = { ...body, id: `store-${stores.length + 1}` };
      stores.push(created);
      return Response.json(created);
    }
    return store
      ? stores.some((row) => row.id === store)
        ? Response.json(stores.find((row) => row.id === store))
        : Response.json({}, { status: 404 })
      : Response.json({ data: stores });
  };
  const fetcher = vi.fn<typeof fetch>(handler);
  const ark = new ArkClient(
    { arkBaseUrl: "https://example.test", arkKey: "test-key", project: "" },
    fetcher,
  );
  // The Open Muse service's record of each owner's memory store: it creates
  // the store in Ark when asked to, labelled with the owner, and returns it.
  const recorded = new Map<string, string>();
  const service =
    (owner: string) =>
    async (create: boolean): Promise<string | undefined> => {
      if (recorded.has(owner) || !create) return recorded.get(owner);
      const store = await ark.request<{ id: string }>("/memory_stores", {
        method: "POST",
        body: JSON.stringify({
          name: "Open Muse personal memory",
          metadata: { open_muse_identity: owner },
        }),
      });
      recorded.set(owner, store.id);
      return store.id;
    };
  const identity = (owner: string) =>
    new DirectIdentity(
      owner,
      ark,
      db,
      { wait: async () => {} },
      service(owner),
    );
  const client = identity("owner");
  const writes = () =>
    fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  return {
    client,
    identity,
    recorded,
    db,
    ark,
    fetcher,
    handler,
    stores,
    docs,
    writes,
  };
}

describe("Personal identity documents", () => {
  it("validates cloud goals before provisioning and keeps goal navigation read-only", async () => {
    const f = fixture();
    const initial = await f.client.goalsDocument();
    expect(initial.content).toBe(emptyGoalsDocument);
    await expect(
      f.client.saveGoalsDocument("invalid", initial.revision),
    ).rejects.toThrow("No goals were replaced");
    expect(f.writes()).toHaveLength(0);
    const saved = await f.client.saveGoalsDocument(
      emptyGoalsDocument,
      initial.revision,
    );
    expect(saved.id).toBeTruthy();
    expect(f.docs.get("store-1")?.some((doc) => doc.path === "/GOALS.md")).toBe(
      true,
    );
    const count = f.writes().length;
    await expect(
      f.client.saveGoalsDocument(emptyGoalsDocument, "stale"),
    ).rejects.toThrow("goals changed");
    expect(f.writes()).toHaveLength(count);
  });
  it("does not repeat an unresolved goal document write even when the visible content is unchanged", async () => {
    const f = fixture();
    const initial = await f.client.goalsDocument();
    const saved = await f.client.saveGoalsDocument(
      emptyGoalsDocument,
      initial.revision,
    );
    await f.db.set("owner:identity:v1:store-1:GOALS.md:write", {
      token: "uncertain",
      content: "Unconfirmed edit",
      before: saved.revision,
    });
    const count = f.writes().length;
    await expect(
      f.client.saveGoalsDocument(emptyGoalsDocument, saved.revision),
    ).rejects.toThrow("unconfirmed");
    expect(f.writes()).toHaveLength(count);
  });
  it("stores feed instructions in a separate cloud document and rejects stale drafts", async () => {
    const f = fixture();
    const initial = await f.client.feedInstructions();
    expect(f.writes()).toHaveLength(0);
    const saved = await f.client.saveFeedInstructions(
      "Research nature walks",
      initial.revision,
    );
    expect(saved.content).toBe("Research nature walks");
    expect(
      f.docs.get("store-1")?.find((doc) => doc.path === "/FEED.md")?.content,
    ).toBe(saved.content);
    const before = f.writes().length;
    await expect(
      f.client.saveFeedInstructions("stale", initial.revision),
    ).rejects.toThrow("changed since");
    expect(f.writes()).toHaveLength(before);
    expect((await f.client.read()).documents["MEMORY.md"].content).toBe(
      identityDefaults["MEMORY.md"].trim(),
    );
  });
  it("does not claim a successful no-op save while a different feed write is unconfirmed", async () => {
    const f = fixture();
    const initial = await f.client.feedInstructions();
    const saved = await f.client.saveFeedInstructions(
      "Original",
      initial.revision,
    );
    await f.db.set("owner:identity:v1:store-1:FEED.md:write", {
      token: "uncertain",
      content: "Pending change",
      before: saved.revision,
    });
    const count = f.writes().length;
    await expect(
      f.client.saveFeedInstructions("Original", saved.revision),
    ).rejects.toThrow("unconfirmed");
    expect(f.writes()).toHaveLength(count);
  });
  it("waits for update propagation using reads only", async () => {
    const f = fixture();
    await f.client.ensure();
    const before = await f.client.read();
    let lagging = 0;
    f.fetcher.mockImplementation(async (input, init) => {
      const value = await f.handler(input, init);
      if (init?.method === "POST") lagging = 3;
      else if (String(input).includes("/memories/doc-") && lagging > 0) {
        lagging--;
        return Response.json({}, { status: 404 });
      }
      return value;
    });
    expect(
      (
        await f.client.save(
          "MEMORY.md",
          "confirmed after propagation",
          before.documents["MEMORY.md"].revision,
        )
      ).documents["MEMORY.md"].content,
    ).toBe("confirmed after propagation");
    expect(f.writes()).toHaveLength(5);
  });
  it("keeps reading a new identity read-only", async () => {
    const f = fixture();
    expect(await f.client.read()).toEqual(defaultIdentity());
    expect(f.writes()).toHaveLength(0);
  });
  it("creates once, uses absolute paths, and preserves all documents across relaunch", async () => {
    const f = fixture();
    await Promise.all([f.client.ensure(), f.client.ensure()]);
    expect(f.stores).toHaveLength(1);
    expect(f.writes()).toHaveLength(4);
    const identity = await f.client.read();
    expect(identity.store_id).toBe("store-1");
    expect(identity.documents["MEMORY.md"].revision).toBe(
      digest(identityDefaults["MEMORY.md"].trim()),
    );
    const result = await f.client.save(
      "MEMORY.md",
      "# MEMORY.md\n\nA durable fact.\n",
      identity.documents["MEMORY.md"].revision,
    );
    expect(result.documents["MEMORY.md"].content).toContain("A durable fact.");
    const restored = f.identity("owner");
    expect(await restored.read()).toEqual(result);
    expect(f.writes()).toHaveLength(5);
  });
  it("finds the store by its owner label only when read without the service's record", async () => {
    const f = fixture();
    f.stores.push(
      { id: "other", metadata: { open_muse_identity: "someone-else" } },
      { id: "mine", metadata: { open_muse_identity: "owner" } },
    );
    const reader = new DirectIdentity("owner", f.ark, f.db, {
      wait: async () => {},
    });
    expect((await reader.read()).store_id).toBe("mine");
    // It never creates one.
    expect(f.writes()).toHaveLength(0);
  });
  it("recovers partial default-document provisioning without overwriting user edits", async () => {
    const f = fixture();
    await f.client.ensure();
    const rows = f.docs.get("store-1")!;
    rows.splice(
      rows.findIndex((r) => r.path === "/MEMORY.md"),
      1,
    );
    rows.find((r) => r.path === "/SOUL.md")!.content = "My own persona";
    await f.client.ensure();
    expect((await f.client.read()).documents["SOUL.md"].content).toBe(
      "My own persona",
    );
    expect(rows).toHaveLength(3);
    expect(f.writes()).toHaveLength(5);
  });
  it("rejects stale revisions before writing and validates edited names", async () => {
    const f = fixture();
    await f.client.ensure();
    const original = await f.client.read();
    f.docs.get("store-1")!.find((r) => r.path === "/SOUL.md")!.content =
      "A newer persona";
    await expect(
      f.client.save(
        "SOUL.md",
        "stale draft",
        original.documents["SOUL.md"].revision,
      ),
    ).rejects.toThrow("draft is preserved");
    await expect(
      f.client.save(
        "IDENTITY.md",
        '{"name":""}',
        original.documents["IDENTITY.md"].revision,
      ),
    ).rejects.toThrow("between 1 and 40");
    expect(f.writes()).toHaveLength(4);
    const changed = await f.client.save(
      "IDENTITY.md",
      '{"name":"  Willow  "}',
      original.documents["IDENTITY.md"].revision,
    );
    expect(changed.name).toBe("Willow");
  });
  it("reads and keeps the companion's chosen look beside its name", async () => {
    const f = fixture();
    await f.client.ensure();
    const original = await f.client.read();
    expect(original.avatar).toBeUndefined();
    const changed = await f.client.save(
      "IDENTITY.md",
      '{"name":"Willow","avatar":"blush"}',
      original.documents["IDENTITY.md"].revision,
    );
    expect(changed).toMatchObject({ name: "Willow", avatar: "blush" });
    await expect(
      f.client.save(
        "IDENTITY.md",
        '{"name":"Willow","avatar":"gold"}',
        changed.documents["IDENTITY.md"].revision,
      ),
    ).rejects.toThrow();
  });
  it("allows repairing an invalid name without hiding the underlying documents", async () => {
    const f = fixture();
    await f.client.ensure();
    f.docs.get("store-1")!.find((r) => r.path === "/IDENTITY.md")!.content =
      "invalid json";
    const broken = await f.client.read();
    expect(broken.warning).toContain("invalid");
    expect(broken.documents["IDENTITY.md"].content).toBe("invalid json");
    expect(
      (
        await f.client.save(
          "IDENTITY.md",
          '{"name":"Muse"}',
          broken.documents["IDENTITY.md"].revision,
        )
      ).warning,
    ).toBeUndefined();
  });
  it("recovers an accepted write by reading, never blindly submitting twice", async () => {
    const f = fixture();
    await f.client.ensure();
    const original = await f.client.read();
    f.fetcher.mockImplementation(async (input, init) => {
      const response = await f.handler(input, init);
      if (init?.method === "POST") throw new TypeError("Response lost");
      return response;
    });
    await expect(
      f.client.save(
        "MEMORY.md",
        "saved fact",
        original.documents["MEMORY.md"].revision,
      ),
    ).rejects.toThrow("Response lost");
    const latest = await f.client.read();
    expect(latest.documents["MEMORY.md"].content).toBe("saved fact");
    await f.client.save(
      "MEMORY.md",
      "saved fact",
      latest.documents["MEMORY.md"].revision,
    );
    expect(f.writes()).toHaveLength(5);
  });
  it("retains the pending guard after an accepted write followed by a failed verification GET", async () => {
    const f = fixture();
    await f.client.ensure();
    const original = await f.client.read();
    let afterWrite = false;
    f.fetcher.mockImplementation(async (input, init) => {
      if (init?.method === "POST") {
        afterWrite = true;
        return Response.json({ ok: true });
      }
      if (afterWrite) return Response.json({}, { status: 404 });
      return f.handler(input, init);
    });
    await expect(
      f.client.save(
        "MEMORY.md",
        "unverified",
        original.documents["MEMORY.md"].revision,
      ),
    ).rejects.toThrow("404");
    f.fetcher.mockImplementation(f.handler);
    await expect(
      f.client.save(
        "MEMORY.md",
        "unverified",
        original.documents["MEMORY.md"].revision,
      ),
    ).rejects.toThrow("previous memory write is unconfirmed");
    expect(f.writes()).toHaveLength(5);
  });
  it("allows explicit retry after a definitive rejected update", async () => {
    const f = fixture();
    await f.client.ensure();
    const original = await f.client.read();
    f.fetcher.mockImplementation((input, init) =>
      init?.method === "POST"
        ? Promise.resolve(Response.json({}, { status: 429 }))
        : f.handler(input, init),
    );
    await expect(
      f.client.save(
        "SOUL.md",
        "new persona",
        original.documents["SOUL.md"].revision,
      ),
    ).rejects.toThrow("429");
    f.fetcher.mockImplementation(f.handler);
    expect(
      (
        await f.client.save(
          "SOUL.md",
          "new persona",
          original.documents["SOUL.md"].revision,
        )
      ).documents["SOUL.md"].content,
    ).toBe("new persona");
  });
  it("does not report an unchanged draft as saved while another write is unresolved", async () => {
    const f = fixture();
    await f.client.ensure();
    const before = (await f.client.read()).documents["MEMORY.md"];
    f.fetcher.mockImplementation((input, init) =>
      init?.method === "POST"
        ? Promise.resolve(Response.json({ ok: true }))
        : f.handler(input, init),
    );
    await expect(
      f.client.save("MEMORY.md", "Unconfirmed new content", before.revision),
    ).rejects.toThrow("could not be verified");
    await expect(
      f.client.save("MEMORY.md", before.content, before.revision),
    ).rejects.toThrow("previous memory write is unconfirmed");
    expect(f.writes()).toHaveLength(5);
  });
  it("never adopts multiple owned stores or repeats incomplete pagination", async () => {
    const f = fixture();
    f.stores.push(
      { id: "one", metadata: { open_muse_identity: "owner" } },
      { id: "two", metadata: { open_muse_identity: "owner" } },
    );
    const reader = new DirectIdentity("owner", f.ark, f.db, {
      wait: async () => {},
    });
    await expect(reader.read()).rejects.toThrow("Multiple personal");
    // A token Ark repeats ends the list rather than failing the read.
    f.fetcher.mockImplementation(async () =>
      Response.json({ data: [], next_page: "loop" }),
    );
    await expect(reader.read()).resolves.toBeDefined();
    // A list that never ends is refused before anything is written.
    let page = 0;
    f.fetcher.mockImplementation(async () =>
      Response.json({ data: [], next_page: `page-${++page}` }),
    );
    await expect(reader.read()).rejects.toThrow("pagination did not finish");
    expect(f.writes()).toHaveLength(0);
  });
  it("does not recreate a deleted mapped store or write to one with changed ownership", async () => {
    const f = fixture();
    await f.client.ensure();
    f.stores[0].metadata.open_muse_identity = "another-owner";
    await expect(f.client.ensure()).rejects.toThrow("not owned");
    f.stores.length = 0;
    await expect(f.client.ensure()).rejects.toThrow("404");
    expect(f.writes()).toHaveLength(4);
  });
  it("separates identities even on the same local database", async () => {
    const f = fixture();
    await f.client.ensure();
    const other = f.identity("other");
    expect((await other.read()).store_id).toBeUndefined();
    await other.ensure();
    expect((await other.read()).store_id).not.toBe(
      (await f.client.read()).store_id,
    );
  });
  it("appends managed instructions without replacing custom persona or duplicating the block", () => {
    const initial = systemWithIdentity("Custom system instructions.");
    // The stored name is the companion's own, never the person's.
    expect(initial).toContain("not the person's: never call them by it");
    expect(initial).toContain("Custom system instructions.");
    expect(systemWithIdentity(initial)).toBe(initial);
    expect(
      systemWithIdentity("Custom <open-muse-identity> unfinished"),
    ).toContain("unfinished");
    const malformed = systemWithIdentity(
      "Custom <open-muse-identity> unfinished",
    );
    expect(systemWithIdentity(malformed)).toBe(malformed);
    expect(initial).toContain("/<memory-store-id>/file");
    expect(initial).toContain("does not erase historical conversations");
    // The companion can change its look among the app's styles.
    for (const style of avatarStyles) expect(initial).toContain(style);
  });
});
