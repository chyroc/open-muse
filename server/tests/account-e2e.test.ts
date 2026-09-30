/// <reference types="vite/client" />
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import type { Env } from "../src/env";
import { Client } from "../../src/api";
import { BackgroundClient } from "../../src/background-client";
import { SupabaseAuth } from "../../src/supabase-auth";
import { LocalDatabase, type CredentialStore } from "../../src/direct/storage";
import { accountWorkspaceKey } from "../../shared/workspace-key";

// End to end across the real client runtime, the real Worker, D1, and sealed
// storage. Only the two external services are replaced by protocol doubles:
// a GoTrue-compatible Auth server that issues and verifies opaque sessions,
// and an Ark MA server that, like a real Ark account, lets one key read and
// write every resource created with it.
const auth = "https://auth.example.com";
const service = "https://background.example.com";
const ark = "https://ark.cn-beijing.volces.com";
const publicKey = "sb_publishable_test_public_key_only";
const sharedKey = "test-shared-ark-api-key-e2e";

function gotrue() {
  const users = new Map<string, { id: string; password: string }>();
  const access = new Map<string, string>(),
    refresh = new Map<string, string>();
  const issue = (id: string) => {
    const token = `access-${crypto.randomUUID()}`,
      renewal = `refresh-${crypto.randomUUID()}`;
    access.set(token, id);
    refresh.set(renewal, id);
    return {
      access_token: token,
      refresh_token: renewal,
      expires_in: 3600,
      token_type: "bearer",
      user: { id, is_anonymous: false },
    };
  };
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(auth);
    expect(new Headers(init?.headers).get("apikey")).toBe(publicKey);
    const bearer = (
      new Headers(init?.headers).get("Authorization") ?? ""
    ).slice(7);
    if (url.pathname === "/auth/v1/user")
      return access.has(bearer)
        ? Response.json({ id: access.get(bearer), is_anonymous: false })
        : Response.json({}, { status: 401 });
    if (url.pathname === "/auth/v1/logout") {
      access.delete(bearer);
      return new Response(null, { status: 204 });
    }
    const body = JSON.parse(String(init?.body));
    if (url.search === "?grant_type=password") {
      const user = users.get(body.email);
      return user && user.password === body.password
        ? Response.json(issue(user.id))
        : Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (url.search === "?grant_type=refresh_token") {
      const id = refresh.get(body.refresh_token);
      refresh.delete(body.refresh_token);
      return id ? Response.json(issue(id)) : Response.json({}, { status: 400 });
    }
    return Response.json({}, { status: 404 });
  });
  return {
    fetcher,
    register: (email: string) =>
      users.set(email, {
        id: crypto.randomUUID(),
        password: "a-test-only-password",
      }),
    // Ends every session of a user at the provider, as an administrator or a
    // password change would.
    revoke: (email: string) => {
      const id = users.get(email)?.id;
      for (const map of [access, refresh])
        for (const [token, owner] of map) if (owner === id) map.delete(token);
    },
  };
}

type Row = Record<string, unknown> & {
  id: string;
  metadata?: Record<string, string>;
};
function arkServer() {
  const rows: Record<string, Row[]> = {
    agents: [],
    environments: [],
    memory_stores: [],
    sessions: [],
  };
  const memories: Record<string, Row[]> = {};
  let next = 0;
  const created = vi.fn();
  const state: { beforeReply?: () => Promise<void> } = {};
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    // Lets a test act between two requests of one client operation.
    const hook = state.beforeReply;
    state.beforeReply = undefined;
    await hook?.();
    const url = new URL(String(input));
    expect(url.origin).toBe(ark);
    if (
      new Headers(init.headers).get("Authorization") !== `Bearer ${sharedKey}`
    )
      return Response.json({}, { status: 401 });
    const path = url.pathname.slice("/api/v3".length);
    const post = init.method === "POST";
    const body = post ? JSON.parse(String(init.body)) : undefined;
    const memory = path.match(
      /^\/memory_stores\/([^/]+)\/memories(?:\/(.+))?$/,
    );
    // A live event stream that stays open until the client aborts it.
    if (path.endsWith("/events/stream"))
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(": open\n\n"));
            init.signal?.addEventListener("abort", () =>
              controller.error(init.signal!.reason),
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    if (memory) {
      const docs = (memories[memory[1]] ??= []);
      if (post && memory[2])
        Object.assign(
          docs.find((doc) => doc.id === memory[2])!,
          body,
        );
      else if (post) docs.push({ ...body, id: `doc-${++next}` });
      if (post) return Response.json({ ok: true });
      return memory[2]
        ? Response.json(docs.find((doc) => doc.id === memory[2]))
        : Response.json({ data: docs });
    }
    const [, group, id] = path.split("/");
    const list = rows[group];
    if (!list) return Response.json({ data: [] });
    if (post && !id) {
      const row = { ...body, id: `${group}-${++next}`, version: 1 };
      list.push(row);
      created(group, row.metadata);
      return Response.json(row);
    }
    const row = id ? list.find((item) => item.id === id) : undefined;
    if (id && !row) return Response.json({}, { status: 404 });
    if (post) {
      Object.assign(row!, body, { version: Number(row!.version) + 1 });
      return Response.json(row);
    }
    return Response.json(row ?? { data: list });
  });
  return { fetcher, rows, created, state };
}

function memoryVault(): CredentialStore & { value: string } {
  return {
    value: "",
    async read() {
      return this.value;
    },
    async write(value) {
      this.value = value;
    },
  };
}

describe("Muse accounts end to end", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let env: Env;
  const provider = gotrue();
  const upstream = arkServer();
  const outbound: typeof fetch = (input, init) =>
    new URL(String(input)).origin === auth
      ? provider.fetcher(input, init)
      : upstream.fetcher(input, init);
  // The client reaches the Worker over HTTP; here the request is handed to
  // the Worker's own fetch handler without any shortcut.
  const worker = vi.fn<typeof fetch>(async (input, init = {}) => {
    if (serviceDown) throw new TypeError("service unreachable");
    const { cache: _cache, credentials: _credentials, ...rest } = init;
    return handle(new Request(String(input), rest), env, outbound);
  });
  let serviceDown = false;
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      OWNER_ID: "private-owner",
      SUPABASE_AUTH_URL: auth,
      SUPABASE_ANON_KEY: publicKey,
      BACKGROUND_ENABLED: "true",
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("e".repeat(32)) },
      }),
    };
    let locked: Promise<unknown> = Promise.resolve();
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US"],
      locks: {
        request: (_name: string, run: () => Promise<unknown>) => {
          const result = locked.then(run);
          locked = result.catch(() => {});
          return result;
        },
      },
    });
    for (const email of ["alice@example.com", "bob@example.com"])
      provider.register(email);
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await fixture.dispose();
  });
  // One app install: its own Keychain entries and IndexedDB.
  function device(
    legacy = "",
    check = { read: 0, write: 0, interval: 60_000 },
    now = Date.now,
  ) {
    const vault = memoryVault(),
      accountVault = memoryVault();
    vault.value = legacy;
    const dbName = `e2e-${crypto.randomUUID()}`;
    const db = new LocalDatabase(dbName);
    const account = new BackgroundClient(
      service,
      accountVault,
      db,
      worker,
      new SupabaseAuth(auth, publicKey, provider.fetcher),
    );
    const client = new Client({
      vault,
      database: db,
      fetcher: upstream.fetcher,
      account,
      // By default verify before every Ark request; window tests pass their
      // own limits and clock.
      accountCheck: check,
      now,
    });
    return {
      account,
      db,
      // Every record key on this device, read straight from IndexedDB.
      keys: () =>
        new Promise<string[]>((resolve, reject) => {
          const open = indexedDB.open(dbName);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const request = open.result
              .transaction("records")
              .objectStore("records")
              .getAllKeys();
            request.onsuccess = () => resolve(request.result.map(String));
            request.onerror = () => reject(request.error);
          };
        }),
      client,
      vault,
      accountVault,
      async signIn(email: string) {
        await account.signInAccount(email, "a-test-only-password");
        await client.accountChanged();
      },
      async prepare() {
        await client.startWorkspace();
        await client.prepareWorkspace();
        // Reading adopts an existing personal memory; saving a name creates it.
        const identity = await client.companionIdentity();
        if (!identity.store_id)
          await client.saveIdentityDocument(
            "IDENTITY.md",
            JSON.stringify({ name: "Muse" }),
            identity.documents["IDENTITY.md"].revision,
          );
        return client.backgroundConfiguration(true);
      },
    };
  }
  const workspaces: Record<
    string,
    { agentId: string; environmentId: string; memoryStoreId: string }
  > = {};

  it("gives two accounts that share one Ark key separate workspaces and memory", async () => {
    for (const email of ["alice@example.com", "bob@example.com"]) {
      const d = device();
      await d.client.restore();
      expect(d.client.signedIn()).toBe(false);
      await expect(d.client.prepareWorkspace()).rejects.toThrow(
        "Sign in to your Muse account",
      );
      await d.signIn(email);
      await d.client.auth("api-key", {
        apiKey: sharedKey,
        project: "",
        confirm: true,
      });
      // The key lives in the account, not on this device.
      expect(d.vault.value).toBe("");
      expect(d.accountVault.value).not.toContain(sharedKey);
      const config = await d.prepare();
      workspaces[email] = config;
      const owner = d.account.accountOwner()!;
      const label = accountWorkspaceKey(sharedKey, "", owner);
      expect(
        upstream.rows.agents.find((row) => row.id === config.agentId)?.metadata,
      ).toMatchObject({ open_muse_workspace: label });
      expect(
        upstream.rows.memory_stores.find(
          (row) => row.id === config.memoryStoreId,
        )?.metadata,
      ).toMatchObject({ open_muse_identity: label });
      // Background work is allowed with the account's stored key only.
      await d.account.syncConfiguration(d.client);
      expect((await d.account.status()).backgroundReady).toBe(true);
    }
    const [alice, bob] = ["alice@example.com", "bob@example.com"].map(
      (email) => workspaces[email],
    );
    expect(alice.agentId).not.toBe(bob.agentId);
    expect(alice.memoryStoreId).not.toBe(bob.memoryStoreId);
    const owners = await fixture.db
      .prepare(
        "SELECT kind,resource_id,owner_id FROM account_resources ORDER BY resource_id",
      )
      .all<{ owner_id: string }>();
    expect(new Set(owners.results.map((row) => row.owner_id)).size).toBe(2);
  });

  it("seals agent and environment changes with the account and restores them on another device", async () => {
    const alice = device();
    await alice.client.restore();
    await alice.signIn("alice@example.com");
    const own = workspaces["alice@example.com"];
    const bob = workspaces["bob@example.com"];
    const agent = upstream.rows.agents.find((row) => row.id === own.agentId)!;
    const posts = () =>
      upstream.fetcher.mock.calls.filter(
        ([, init]) => (init?.method ?? "GET") === "POST",
      ).length;
    // Studio reaches only this account's resources.
    let before = posts();
    await expect(
      alice.client.ma("UpdateAgent", {
        params: { id: bob.agentId },
        body: { version: 1, system: "not mine" },
        confirm: true,
      }),
    ).rejects.toThrow("only this account's own");
    await expect(
      alice.client.ma("GetMemoryStore", {
        params: { memory_store_id: bob.memoryStoreId },
      }),
    ).rejects.toThrow("only this account's own");
    expect(
      (
        await alice.client.ma<{ data: { id: string }[] }>("ListAgents")
      ).data.map((row) => row.id),
    ).toEqual([own.agentId]);
    // Ownership labels cannot be edited through Open Muse.
    await expect(
      alice.client.ma("UpdateAgent", {
        params: { id: own.agentId },
        body: {
          version: agent.version,
          metadata: { open_muse_workspace: "anything" },
        },
        confirm: true,
      }),
    ).rejects.toThrow();
    expect(posts()).toBe(before);
    // A user's change is applied once by the service and sealed.
    const result = await alice.client.ma<{
      workspace: { model: string; agent: { system: string } };
      background: string;
    }>("UpdateAgent", {
      params: { id: own.agentId },
      body: {
        version: agent.version,
        model: { id: "user-chosen-model" },
        system: "A user-written instruction",
      },
      confirm: true,
    });
    expect(result.workspace.model).toBe("user-chosen-model");
    expect(result.workspace.agent.system).toBe("A user-written instruction");
    // Background work follows the new agent version (its schedule pauses).
    expect(result.background).toBe("rebound");
    expect(await alice.account.status()).toMatchObject({
      backgroundReady: true,
    });
    await alice.client.ma("UpdateEnvironment", {
      params: { id: own.environmentId },
      body: {
        config: { type: "cloud", networking: { type: "limited" } },
      },
      confirm: true,
    });
    const sealed = await fixture.db
      .prepare("SELECT encrypted FROM account_workspaces")
      .all<{ encrypted: string }>();
    for (const row of sealed.results)
      expect(row.encrypted).not.toContain("user-written");
    // Another device of the account reads the same sealed settings.
    const other = device();
    await other.client.restore();
    await other.signIn("alice@example.com");
    expect(await other.account.accountWorkspace()).toMatchObject({
      workspace: {
        model: "user-chosen-model",
        agent: {
          model: { id: "user-chosen-model" },
          system: "A user-written instruction",
        },
        environment: { config: { networking: { type: "limited" } } },
      },
    });
    // A change based on an older record revision is refused.
    const stale = (await other.account.accountWorkspace()).revision - 1;
    before = posts();
    await expect(
      other.account.updateAccountWorkspace(
        "environment",
        { description: "late" },
        stale,
        other.client.accountCredentialRevision()!,
      ),
    ).rejects.toThrow("another device");
    expect(posts()).toBe(before);
  });

  it("lets the same account continue on another device without creating resources", async () => {
    const second = device();
    await second.client.restore();
    await second.signIn("alice@example.com");
    expect(second.client.signedIn()).toBe(true);
    const creates = upstream.created.mock.calls.length;
    const config = await second.prepare();
    expect(config.agentId).toBe(workspaces["alice@example.com"].agentId);
    expect(config.memoryStoreId).toBe(
      workspaces["alice@example.com"].memoryStoreId,
    );
    expect(upstream.created.mock.calls.length).toBe(creates);
  });

  it("switches accounts on one device without carrying the previous account's key or workspace", async () => {
    const shared = device();
    await shared.client.restore();
    await shared.signIn("alice@example.com");
    expect((await shared.prepare()).agentId).toBe(
      workspaces["alice@example.com"].agentId,
    );
    const { revoked } = await shared.account.signOutAccount();
    expect(revoked).toBe(true);
    await shared.client.accountChanged();
    expect(shared.client.signedIn()).toBe(false);
    expect(shared.accountVault.value).toBe("");
    await expect(shared.client.companionIdentity()).resolves.toMatchObject({
      name: "Muse",
    });
    await expect(shared.client.prepareWorkspace()).rejects.toThrow(
      "Sign in to your Muse account",
    );
    await shared.signIn("bob@example.com");
    expect((await shared.prepare()).agentId).toBe(
      workspaces["bob@example.com"].agentId,
    );
  });

  it("replaces a device's earlier workspace mapping with the service's record", async () => {
    const upgraded = device();
    await upgraded.client.restore();
    await upgraded.signIn("alice@example.com");
    const owner = upgraded.account.accountOwner()!;
    const key = accountWorkspaceKey(sharedKey, "", owner);
    // An earlier release created or adopted these by label on this device;
    // the service never recorded them.
    upstream.rows.agents.push({
      id: "agents-label-era",
      version: 1,
      metadata: { open_muse_workspace: key },
    });
    upstream.rows.memory_stores.push({
      id: "memory-label-era",
      metadata: { open_muse_identity: key },
    });
    const earlier = {
      agent_id: "agents-label-era",
      environment_id: "environments-label-era",
      model_id: "earlier-model",
      resource_name: "open-muse-earlier",
      agent_pending: false,
      environment_pending: false,
      state: "ready",
      message: "",
    };
    await upgraded.db.set(`${key}:workspace`, earlier);
    await upgraded.db.set(`${key}:identity:v1`, {
      store_id: "memory-label-era",
    });
    const config = await upgraded.client.backgroundConfiguration(true);
    expect(config.agentId).toBe(workspaces["alice@example.com"].agentId);
    expect(config.memoryStoreId).toBe(
      workspaces["alice@example.com"].memoryStoreId,
    );
    expect(
      upstream.fetcher.mock.calls.some(([input]) =>
        /label-era/.test(String(input)),
      ),
    ).toBe(false);
    // The earlier mapping is kept on the device, not deleted.
    const kept = await Promise.all(
      (await upgraded.keys())
        .filter((name) => name.includes(":unrecorded:"))
        .sort()
        .map((name) => upgraded.db.get(name)),
    );
    expect(kept).toEqual([{ store_id: "memory-label-era" }, earlier]);
  });

  it("keeps an upgraded device's saved key unused until the user saves it to the account", async () => {
    const legacy = JSON.stringify({
      kind: "api_key",
      apiKey: sharedKey,
      project: "",
    });
    provider.register("carol@example.com");
    const upgraded = device(legacy);
    await upgraded.client.restore();
    expect(await upgraded.client.auth("status")).toMatchObject({
      loggedIn: false,
      legacy: "api_key",
      legacyKey: true,
      account: { signedIn: false },
    });
    const calls = upstream.fetcher.mock.calls.length;
    await expect(upgraded.client.prepareWorkspace()).rejects.toThrow(
      "Sign in to your Muse account",
    );
    await upgraded.signIn("carol@example.com");
    expect(upgraded.client.signedIn()).toBe(false);
    expect(upstream.fetcher.mock.calls.length).toBe(calls);
    await upgraded.client.auth("import-legacy", { confirm: true });
    expect(upgraded.client.signedIn()).toBe(true);
    // The earlier record stays on the device until explicitly removed.
    expect(upgraded.vault.value).toBe(legacy);
    const config = await upgraded.prepare();
    expect(Object.values(workspaces).map((w) => w.agentId)).not.toContain(
      config.agentId,
    );
    await upgraded.client.auth("remove-legacy", { confirm: true });
    expect(upgraded.vault.value).toBe("");
  });

  it("removing the key from the account stops every device from using it", async () => {
    const first = device();
    await first.client.restore();
    await first.signIn("bob@example.com");
    const other = device();
    await other.client.restore();
    await other.signIn("bob@example.com");
    await other.prepare();
    await first.client.auth("logout", { confirm: true });
    expect((await first.account.status()).backgroundReady).toBe(false);
    // The other device was not told; its next Ark request is refused first.
    const calls = upstream.fetcher.mock.calls.length;
    await expect(other.client.companionIdentity()).rejects.toThrow(
      "changed on another device",
    );
    expect(upstream.fetcher.mock.calls.length).toBe(calls);
    expect(other.client.signedIn()).toBe(false);
    await expect(
      other.client.auth("api-key", {
        apiKey: sharedKey,
        project: "",
        confirm: true,
      }),
    ).resolves.toMatchObject({ ready: true });
  });

  it("stops a running device as soon as its session is revoked at the provider", async () => {
    provider.register("dana@example.com");
    const running = device();
    await running.client.restore();
    await running.signIn("dana@example.com");
    await running.client.auth("api-key", {
      apiKey: sharedKey,
      project: "",
      confirm: true,
    });
    await running.prepare();
    provider.revoke("dana@example.com");
    const calls = upstream.fetcher.mock.calls.length;
    await expect(
      running.client.send("any-session", {
        type: "user.message",
        text: "hello",
      }),
    ).rejects.toThrow();
    await expect(running.client.companionIdentity()).resolves.toMatchObject({
      name: "Muse",
    });
    // No Ark request left the device after the revocation.
    expect(upstream.fetcher.mock.calls.length).toBe(calls);
    expect(running.client.signedIn()).toBe(false);
    expect(running.account.accountOwner()).toBeUndefined();
    expect(running.accountVault.value).toBe("");
  });

  describe("with the production verification windows", () => {
    let clock = Date.now();
    const now = () => clock;
    const credentialChecks = () =>
      worker.mock.calls.filter(([input]) =>
        String(input).endsWith("/v1/account/credential"),
      ).length;
    async function ready(email: string, interval = 60_000) {
      provider.register(email);
      const d = device("", { read: 60_000, write: 10_000, interval }, now);
      await d.client.restore();
      await d.signIn(email);
      await d.client.auth("api-key", {
        apiKey: sharedKey,
        project: "",
        confirm: true,
      });
      await d.prepare();
      return d;
    }

    it("reuses a verification for reads for 60 s and for writes for 10 s", async () => {
      const d = await ready("frank@example.com");
      const checks = credentialChecks();
      clock += 30_000;
      await d.client.companionIdentity();
      expect(credentialChecks()).toBe(checks);
      const identity = await d.client.companionIdentity();
      clock += 1_000;
      await d.client.saveIdentityDocument(
        "IDENTITY.md",
        JSON.stringify({ name: "Frank" }),
        identity.documents["IDENTITY.md"].revision,
      );
      // The write came more than 10 s after the last verification.
      expect(credentialChecks()).toBeGreaterThan(checks);
    });

    it("stops a runtime inside the window as soon as the session is gone locally", async () => {
      const d = await ready("grace@example.com");
      await d.client.companionIdentity();
      provider.revoke("grace@example.com");
      // A background-service request is the first to see the revocation.
      await expect(d.account.status()).rejects.toThrow();
      expect(d.account.accountOwner()).toBeUndefined();
      const calls = upstream.fetcher.mock.calls.length;
      await expect(d.client.companionIdentity()).resolves.toMatchObject({
        name: "Muse",
      });
      await expect(d.client.prepareWorkspace()).rejects.toThrow(
        "Sign in to your Muse account",
      );
      expect(upstream.fetcher.mock.calls.length).toBe(calls);
    });

    it("sends nothing to Ark while the account service cannot be reached", async () => {
      const d = await ready("heidi@example.com");
      clock += 61_000;
      const calls = upstream.fetcher.mock.calls.length;
      serviceDown = true;
      try {
        await expect(d.client.companionIdentity()).rejects.toThrow();
        expect(upstream.fetcher.mock.calls.length).toBe(calls);
      } finally {
        serviceDown = false;
      }
      await expect(d.client.companionIdentity()).resolves.toMatchObject({
        store_id: expect.any(String),
      });
    });

    it("stops an operation already running when the session ends between its requests", async () => {
      const d = await ready("judy@example.com");
      let after = 0;
      upstream.state.beforeReply = async () => {
        provider.revoke("judy@example.com");
        await d.account.status().catch(() => {});
        after = upstream.fetcher.mock.calls.length;
      };
      // Reading identity makes several Ark requests with one runtime.
      await expect(d.client.companionIdentity()).rejects.toThrow(
        "session ended",
      );
      expect(upstream.fetcher.mock.calls.length).toBe(after);
    });

    it("applies a key removed on another device within one check interval", async () => {
      const d = await ready("kim@example.com", 100);
      const other = device(
        "",
        { read: 60_000, write: 10_000, interval: 60_000 },
        now,
      );
      await other.client.restore();
      await other.signIn("kim@example.com");
      await other.client.auth("logout", { confirm: true });
      // Inside the read window the running device has not heard yet: this is
      // the documented bound, not an immediate revocation.
      const calls = upstream.fetcher.mock.calls.length;
      await d.client.companionIdentity();
      expect(upstream.fetcher.mock.calls.length).toBeGreaterThan(calls);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(d.client.signedIn()).toBe(false);
      const after = upstream.fetcher.mock.calls.length;
      await expect(d.client.prepareWorkspace()).rejects.toThrow();
      expect(upstream.fetcher.mock.calls.length).toBe(after);
    });

    it("closes an open stream when the account service becomes unreachable", async () => {
      const d = await ready("liam@example.com", 50);
      const stream = d.client.stream(
        "session-live",
        new AbortController().signal,
        () => {},
        () => {},
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      serviceDown = true;
      try {
        await expect(
          Promise.race([
            stream.then(
              () => "closed",
              () => "closed",
            ),
            new Promise((resolve) => setTimeout(() => resolve("open"), 1_000)),
          ]),
        ).resolves.toBe("closed");
      } finally {
        serviceDown = false;
      }
    });

    it("closes an open event stream once the session ends", async () => {
      const d = await ready("ivan@example.com", 50);
      const stream = d.client.stream(
        "session-live",
        new AbortController().signal,
        () => {},
        () => {},
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      provider.revoke("ivan@example.com");
      await expect(d.account.status()).rejects.toThrow();
      // The runtime's periodic check aborts the stream within its interval.
      await expect(
        Promise.race([
          stream.then(
            () => "closed",
            () => "closed",
          ),
          new Promise((resolve) => setTimeout(() => resolve("open"), 1_000)),
        ]),
      ).resolves.toBe("closed");
    });
  });
});
