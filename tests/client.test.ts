import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { welcomePrompt } from "../shared/welcome";
import { Client } from "../src/api";
import { DirectAuth, type AccountProvider } from "../src/direct/auth";
import {
  credentials,
  LocalDatabase,
  type CredentialStore,
} from "../src/direct/storage";
import {
  MA_BASE_URL as ARK_BASE_URL,
  directFetch,
} from "../src/direct/transport";
import { boundedSignal } from "../shared/abort";
import { digest, uuid } from "../shared/crypto";
import { operations } from "../shared/ma";
import { buildRequest } from "../shared/ma-request";
import type { AgentEvent } from "../shared/types";
import { identityInstructions } from "../shared/identity";
import { canonicalJson } from "../shared/session-refresh";
import { deviceTools } from "../shared/workspace-spec";
import { testAccount } from "./account-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const key = "test-only-direct-key-123456789";
function vaultFixture() {
  let saved = "";
  const vault: CredentialStore = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value) => {
      saved = value;
    }),
  };
  return vault;
}
function fixture() {
  const vault = vaultFixture();
  const db = new LocalDatabase(`test-${uuid()}`);
  const resources: Record<string, Record<string, unknown>[]> = {
    agents: [],
    environments: [],
    sessions: [],
    memory_stores: [],
  };
  const documents: Record<string, Record<string, unknown>[]> = {};
  const events: AgentEvent[] = [];
  const sessionEvents = new Map<string, AgentEvent[]>();
  const files: Record<string, unknown>[] = [];
  const mounts: Record<string, unknown>[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://ark.cn-beijing.volces.com");
    expect(new Headers(init.headers).get("Authorization")).toMatch(
      /^Bearer test-/,
    );
    const path = url.pathname.slice("/api/v3".length);
    const memoryPath = path.match(
      /^\/memory_stores\/([^/]+)\/memories(?:\/([^/]+))?$/,
    );
    if (memoryPath) {
      const [, store, id] = memoryPath;
      const docs = (documents[store] ??= []);
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (id)
          Object.assign(
            docs.find((doc) => doc.id === id)!,
            body,
          );
        else docs.push({ ...body, id: `memory-${docs.length + 1}` });
        return Response.json({ ok: true });
      }
      return Response.json(
        id ? docs.find((doc) => doc.id === id) : { data: docs },
      );
    }
    const resourcePath = path.match(/^\/sessions\/([^/]+)\/resources$/);
    if (resourcePath && init.method === "POST") {
      const row = resources.sessions.find(
        (item) => item.id === resourcePath[1],
      );
      const { file_id } = JSON.parse(String(init.body));
      const source = files.find((file) => file.id === file_id);
      if (!row || !source) return Response.json({}, { status: 404 });
      const mount = {
        id: `sesrsc-${mounts.length + 1}`,
        type: "file",
        file_id: `file-copy-${mounts.length + 1}`,
        mount_path: `/mnt/session/uploads/${source.filename}`,
      };
      mounts.push({ session: row.id, ...mount });
      row.resources = [...((row.resources as unknown[]) ?? []), mount];
      return Response.json(mount);
    }
    if (resourcePath)
      return Response.json({
        data:
          resources.sessions.find((row) => row.id === resourcePath[1])
            ?.resources ?? [],
      });
    if (path === "/models")
      return Response.json({
        data: [
          {
            id: "model-tools",
            task_type: ["TextGeneration"],
            features: { tools: { function_calling: true } },
          },
        ],
      });
    if (path.endsWith("/events/stream"))
      return new Response(
        'data: {"id":"live","type":"agent.message"}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      );
    if (path.endsWith("/events")) {
      const rows = sessionEvents.get(path.split("/")[2]) ?? events;
      if (init.method === "POST") {
        const incoming = JSON.parse(String(init.body)).events;
        rows.push(...incoming);
        return Response.json({ data: incoming });
      }
      return Response.json({
        data:
          url.searchParams.get("order") === "desc" ? [...rows].reverse() : rows,
      });
    }
    if (path === "/files" && init.method === "POST") {
      const form = init.body as FormData;
      const file = form.get("file") as File;
      const uploaded = {
        id: `file-upload-${files.length + 1}`,
        purpose: String(form.get("purpose")),
        filename: file.name,
        bytes: file.size,
        status: "active",
      };
      files.push(uploaded);
      return Response.json(uploaded);
    }
    if (path === "/files")
      return Response.json({
        object: "list",
        data: files,
        has_more: false,
        last_id: String(files.at(-1)?.id ?? ""),
      });
    if (path.startsWith("/files/"))
      return Response.json(files.find((file) => path === `/files/${file.id}`));
    const [, group, id] = path.split("/");
    if (!resources[group]) return Response.json({ data: [] });
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (id) {
        Object.assign(
          resources[group].find((r) => r.id === id)!,
          body,
        );
        return Response.json({ ok: true });
      }
      const resource = {
        ...body,
        id: `${group}-${resources[group].length + 1}`,
        version: 1,
        status: "idle",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (group === "sessions") {
        const ref = body.agent;
        const agent = resources.agents.find(
          (row) => row.id === (typeof ref === "string" ? ref : ref.id),
        );
        resource.agent = structuredClone({
          ...agent,
          ...(typeof ref === "object" ? ref : {}),
        });
      }
      resources[group].push(resource);
      return Response.json(resource);
    }
    if (id)
      return resources[group].some((r) => r.id === id)
        ? Response.json(resources[group].find((r) => r.id === id))
        : Response.json({}, { status: 404 });
    // Like Ark, sessions can be listed per agent, and lists honor a limit.
    const agentId = url.searchParams.get("agent_id");
    const listed = resources[group].filter(
      (row) =>
        !agentId ||
        (typeof row.agent === "string"
          ? row.agent
          : (row.agent as { id?: string } | undefined)?.id) === agentId,
    );
    const limit = Number(url.searchParams.get("limit")) || listed.length;
    return Response.json({ data: listed.slice(0, limit) });
  });
  const account = testAccount(fetcher);
  const client = new Client({
    vault,
    database: db,
    fetcher,
    account: account.account,
  });
  // Signs in as the app does: the account session is read first, then the
  // Ark key is saved to the account.
  const login = async () => {
    await client.restore();
    return client.auth("api-key", { apiKey: key, project: "", confirm: true });
  };
  // Switches to another Open Muse account, as signing in to it in the app
  // does, and saves the Ark key to it when it has none yet.
  const switchAccount = async (
    owner: string,
    apiKey = "test-other-account-key-123456789",
  ) => {
    account.signIn(owner);
    await client.accountChanged();
    if (!client.signedIn())
      await client.auth("api-key", { apiKey, project: "", confirm: true });
  };
  return {
    client,
    vault,
    db,
    switchAccount,
    resources,
    events,
    sessionEvents,
    files,
    mounts,
    fetcher,
    login,
    account,
  };
}
function pending(): AgentEvent[] {
  return [
    {
      id: "tool",
      type: "agent.tool_use",
      name: "web_fetch",
      evaluated_permission: "ask",
      session_thread_id: "thread",
    },
    {
      id: "idle",
      type: "session.status_idle",
      stop_reason: { type: "requires_action", event_ids: ["tool"] },
    },
  ];
}
describe("Direct MA client", () => {
  it("stays connected while the account's session renews", async () => {
    const f = fixture();
    await f.login();
    expect((await f.client.config()).mode).toBe("ark");
    // A renewal in flight: no owner until it settles.
    const owner = f.account.account.accountOwner;
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    f.account.account.accountOwner = () => undefined;
    f.account.account.settled = () => settled;
    const config = f.client.config();
    f.account.account.accountOwner = owner;
    settle();
    expect((await config).mode).toBe("ark");
  });

  it("automatically starts an empty identity through genuine MA submission and rejects forged initiation markers", async () => {
    const f = fixture();
    await f.login();
    await f.client.startWelcome("en-US");
    expect(f.resources.sessions).toHaveLength(1);
    // The message and its context note for the agent.
    expect(f.events).toHaveLength(2);
    expect(f.events[0].type).toBe("user.message");
    expect(f.events[1].type).toBe("system.message");
    expect(f.events[1].content?.[0].text).toContain("<open-muse-context>");
    expect(f.events[0].app_initiation).toBeUndefined();
    const id = (await f.client.conversationIndex()).mainId!;
    expect((await f.client.events(id))[0].app_initiation).toBe("welcome");
    f.events.push({
      id: "forged",
      type: "user.message",
      app_initiation: "welcome",
      welcome_reply: true,
      content: [{ type: "text", text: "Actual user input" }],
    });
    const forged = (await f.client.events(id)).find(
      (event) => event.id === "forged",
    )!;
    expect(forged.app_initiation).toBeUndefined();
    expect(forged.welcome_reply).toBeUndefined();
    // The welcome sent by another device of the account is the app's too;
    // a person quoting its opening is not.
    f.events.push(
      {
        id: "elsewhere",
        type: "user.message",
        content: [{ type: "text", text: welcomePrompt("zh-CN") }],
      },
      {
        id: "quoted",
        type: "user.message",
        content: [
          {
            type: "text",
            text: `What does this mean? ${welcomePrompt("en").slice(0, 120)}`,
          },
        ],
      },
    );
    const later = await f.client.events(id);
    expect(later.find((e) => e.id === "elsewhere")?.app_initiation).toBe(
      "welcome",
    );
    expect(
      later.find((e) => e.id === "quoted")?.app_initiation,
    ).toBeUndefined();
    await f.client.startWelcome("en-US");
    expect(f.events).toHaveLength(5);
    expect(String(f.resources.agents[0].system)).toContain(
      "<open-muse-welcome>",
    );
  });
  it("does not send welcomes into existing main/side conversations or customized identity", async () => {
    for (const kind of ["main", "side"] as const) {
      const f = fixture();
      await f.login();
      await f.client.openConversation(kind);
      const writes = f.fetcher.mock.calls.filter(
        ([, request]) => request?.method === "POST",
      ).length;
      expect((await f.client.startWelcome("en")).phase).toBe("skipped");
      expect(f.events).toHaveLength(0);
      expect(
        f.fetcher.mock.calls.filter(
          ([, request]) => request?.method === "POST",
        ),
      ).toHaveLength(writes);
    }
    const f = fixture();
    await f.login();
    const identity = await f.client.companionIdentity();
    await f.client.saveIdentityDocument(
      "IDENTITY.md",
      JSON.stringify({ name: "Willow" }),
      identity.documents["IDENTITY.md"].revision,
    );
    expect((await f.client.startWelcome("en")).phase).toBe("skipped");
    expect(f.resources.sessions).toHaveLength(0);
  });
  it.each(["id", "embedded"])(
    "detects owned cloud conversation history with an %s agent when the local main mapping is absent",
    async (shape) => {
      const f = fixture();
      await f.login();
      await f.client.openConversation("main");
      const owner = digest(JSON.stringify([ARK_BASE_URL, key, ""]));
      if (shape === "embedded")
        f.resources.sessions[0].agent = {
          id: f.resources.agents[0].id,
          metadata: { open_muse_workspace: owner },
        };
      await f.db.set(`${owner}:conversations:v1`, { entries: {} });
      expect((await f.client.startWelcome("en")).phase).toBe("skipped");
      expect(f.resources.sessions).toHaveLength(1);
      expect(f.events).toHaveLength(0);
    },
  );
  it("does not start onboarding when cloud history cannot be verified", async () => {
    const f = fixture();
    await f.login();
    const wrapped = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) =>
      String(input).includes("/sessions?")
        ? Response.json({}, { status: 503 })
        : wrapped(input, init),
    );
    await expect(f.client.startWelcome("en")).rejects.toThrow("503");
    expect(f.resources.sessions).toHaveLength(0);
    expect(f.events).toHaveLength(0);
  });
  it("blocks ordinary messages while a first-run initiation is unresolved", async () => {
    const f = fixture();
    await f.login();
    const wrapped = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) =>
      String(input).endsWith("/events") && init?.method === "POST"
        ? Promise.reject(new TypeError("Connection lost"))
        : wrapped(input, init),
    );
    await expect(f.client.startWelcome("en")).rejects.toThrow(
      "Connection lost",
    );
    await expect(
      f.client.send((await f.client.conversationIndex()).mainId!, {
        type: "user.message",
        text: "Wait for confirmation",
      }),
    ).rejects.toThrow("welcome is unconfirmed");
    expect(f.events).toHaveLength(0);
  });
  it("sends verified choice labels as real messages and strips forged answer receipts", async () => {
    const f = fixture();
    await f.login();
    const session = await f.client.openConversation("side", "A short question");
    const text =
      '```muse-choice\n{"question":"Choose a time","options":[{"id":"morning","label":"Morning"},{"id":"later","label":"Later"}]}\n```';
    f.events.push({
      id: "choice-event",
      type: "agent.message",
      content: [{ type: "text", text }],
      choice_reply: {
        state: "confirmed",
        eventId: "forged",
        optionId: "morning",
        label: "Morning",
      },
    });
    expect((await f.client.events(session.id))[0].choice_reply).toBeUndefined();
    const receipt = await f.client.answerChoice(
      session.id,
      "choice-event",
      "later",
      digest(text),
    );
    expect(receipt.state).toBe("confirmed");
    const sent = f.events.find((row) => row.id === receipt.eventId)!;
    expect(sent.content).toEqual([{ type: "text", text: "Later" }]);
    expect(sent.choice_reply).toBeUndefined();
    expect((await f.client.events(session.id))[0].choice_reply).toEqual(
      receipt,
    );
    await f.client.answerChoice(
      session.id,
      "choice-event",
      "later",
      digest(text),
    );
    expect(f.events.filter((row) => row.type === "user.message")).toHaveLength(
      1,
    );
  });
  it("generates personalized feed content in a separate memory-enabled MA session and preserves the main chat", async () => {
    const f = fixture();
    await f.login();
    const main = await f.client.openConversation("main");
    f.sessionEvents.set(main.id, [
      {
        id: "interest",
        type: "user.message",
        content: [{ type: "text", text: "I enjoy urban nature walks" }],
      },
    ]);
    await f.client.createGoal("Walk every weekend", "Choose quiet routes");
    const initial = await f.client.inspiration();
    await f.client.saveFeedInstructions(
      "Focus on nearby nature",
      initial.instructions.revision,
    );
    const result = await f.client.generateInspiration("feed");
    const run = result.runs.feed!;
    expect(run.session_id).not.toBe(main.id);
    expect((await f.client.session(run.session_id!)).title).toBe(
      "Feed generation",
    );
    expect((await f.client.session(run.session_id!)).generation).toBe("feed");
    expect((await f.client.conversationIndex()).mainId).toBe(main.id);
    const request = f.events.find((e) => e.id === run.event_id)!;
    expect(request.content?.[0].text).toContain("urban nature walks");
    expect(request.content?.[0].text).toContain("Walk every weekend");
    expect(request.content?.[0].text).toContain("Focus on nearby nature");
    expect(
      f.resources.sessions.find((s) => s.id === run.session_id)?.resources,
    ).toEqual([{ type: "memory_store", memory_store_id: "memory_stores-1" }]);
    expect(result.items).toEqual([]);
    f.events.push(
      {
        id: "generated",
        type: "agent.message",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              items: [
                {
                  title: "Explore a nearby greenway",
                  body: "Plan a short walk.",
                  emoji: "🌳",
                  category: "Outdoors",
                  reason: "You enjoy nature walks.",
                  prompt: "Help plan a nature walk",
                  sources: [],
                },
              ],
            }),
          },
        ],
      },
      {
        id: "finished",
        type: "session.status_idle",
        stop_reason: { type: "end_turn" },
      },
    );
    const refreshed = await f.client.refreshInspiration("feed");
    expect(refreshed.items[0]).toMatchObject({
      title: "Explore a nearby greenway",
      event_id: "generated",
      session_id: run.session_id,
    });
  });
  it("keeps signed-out feed reads empty and does not make network calls", async () => {
    const f = fixture();
    expect((await f.client.inspiration()).items).toEqual([]);
    expect(f.fetcher).not.toHaveBeenCalled();
    await expect(f.client.generateInspiration("ideas")).rejects.toThrow(
      "Add an Ark API key",
    );
  });
  it("refreshes a stale memory-enabled main once, pins its original version and preserves custom session instructions", async () => {
    const f = fixture();
    await f.login();
    const old = await f.client.openConversation("main");
    const side = await f.client.openConversation("side", "Separate topic");
    const source = f.resources.sessions[0].agent as Record<string, unknown>;
    // MA's public response uses null for an unbound Vault collection.
    f.resources.sessions[0].vault_ids = null;
    source.system =
      "Custom prefix.\n<open-muse-identity>Old capability rules.</open-muse-identity>\nCustom suffix.";
    f.events.push({
      id: "u-before",
      type: "user.message",
      content: [{ type: "text", text: "Preserved source turn" }],
    });
    const before = structuredClone(source);
    const writes = f.fetcher.mock.calls.length;
    const next = await f.client.openConversation("main");
    const ref = f.resources.sessions[2].agent as Record<string, unknown>;
    expect(next.id).not.toBe(old.id);
    expect(ref.version).toBe(before.version);
    expect(ref.system).toContain(identityInstructions);
    expect(ref.system).toContain("Custom prefix.");
    expect(ref.system).toContain("Custom suffix.");
    expect(ref.system).not.toContain("Old capability rules.");
    expect(source).toEqual(before);
    expect(
      (await f.client.conversationIndex()).entries[next.id].previousIds,
    ).toEqual([old.id]);
    expect(f.resources.sessions[1].id).toBe(side.id);
    expect(
      f.fetcher.mock.calls
        .slice(writes)
        .some(([url]) => String(url).endsWith("/agents/agents-1?version=1")),
    ).toBe(true);
    expect(
      f.fetcher.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/sessions") && init?.method === "POST",
      ),
    ).toHaveLength(3);
    expect((await f.client.openConversation("main")).id).toBe(next.id);
    const restored = new Client({
      account: f.account.account,
      vault: f.vault,
      database: f.db,
      fetcher: f.fetcher,
    });
    await restored.restore();
    expect((await restored.openConversation("main")).id).toBe(next.id);
    expect(f.resources.sessions).toHaveLength(3);
    f.sessionEvents.set(next.id, []);
    expect((await restored.events(next.id))[0].source_session_id).toBe(old.id);
  });
  it("does not refresh an active or foreign memory-enabled main snapshot", async () => {
    for (const foreign of [false, true]) {
      const f = fixture();
      await f.login();
      const old = await f.client.openConversation("main");
      const source = f.resources.sessions[0].agent as Record<string, unknown>;
      source.system = "Old instructions.";
      if (foreign) source.metadata = { open_muse_workspace: "someone-else" };
      else f.resources.sessions[0].status = "running";
      expect((await f.client.openConversation("main")).id).toBe(old.id);
      expect(f.resources.sessions).toHaveLength(1);
    }
  });
  it.each(["en", "zh-CN"])(
    "localizes a safe configuration refusal in %s without locking side-chat creation",
    async (language) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
      const f = fixture();
      await f.login();
      const old = await f.client.openConversation("main");
      (f.resources.sessions[0].agent as Record<string, unknown>).system =
        "Old instructions.";
      f.resources.sessions[0].resources = [
        { type: "file", file_id: "file-test" },
      ];
      await expect(f.client.openConversation("main")).rejects.toThrow(
        language === "zh-CN" ? "历史记录完整保留" : "history is intact",
      );
      expect((await f.client.conversationIndex()).mainId).toBe(old.id);
      expect((await f.client.conversationIndex()).pending).toBeUndefined();
      expect(
        (await f.client.openConversation("side", "Safe alternative")).id,
      ).not.toBe(old.id);
    },
  );
  it("refuses a rollover that would lose custom runtime overrides, credentials or resource mounts", async () => {
    for (const kind of ["tools", "file", "vault"] as const) {
      const f = fixture();
      await f.login();
      const old = await f.client.openConversation("main");
      const source = f.resources.sessions[0].agent as Record<string, unknown>;
      source.system = "Old instructions.";
      if (kind === "tools") source.tools = [{ type: "custom-session-toolset" }];
      if (kind === "file")
        (f.resources.sessions[0].resources as unknown[]).push({
          type: "file",
          file_id: "file-test",
        });
      if (kind === "vault") f.resources.sessions[0].vault_ids = ["vault-test"];
      const before = canonicalJson(f.resources.sessions[0]);
      await expect(f.client.openConversation("main")).rejects.toThrow(
        "history is intact",
      );
      expect((await f.client.conversationIndex()).mainId).toBe(old.id);
      expect(f.resources.sessions).toHaveLength(1);
      expect(canonicalJson(f.resources.sessions[0])).toBe(before);
      expect((await f.client.conversationIndex()).pending).toBeUndefined();
      const side = await f.client.openConversation("side", "Continue safely");
      expect(side.id).not.toBe(old.id);
    }
  });
  it("does not mistake tool-input key serialization order for changed source history", async () => {
    const f = fixture();
    await f.login();
    await f.client.openConversation("main");
    (f.resources.sessions[0].agent as Record<string, unknown>).system =
      "Old instructions.";
    f.events.push({
      id: "tool-old",
      type: "agent.tool_use",
      input: { a: 1, b: 2 },
    });
    const handler = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) => {
      const result = await handler(input, init);
      if (init?.method === "POST" && String(input).endsWith("/memories"))
        f.events[0].input = { b: 2, a: 1 };
      return result;
    });
    await f.client.openConversation("main");
    expect(f.resources.sessions).toHaveLength(2);
  });
  it("continues a legacy main chat with memory, a scoped history archive and source-preserving UI events", async () => {
    const f = fixture();
    await f.login();
    const original = await f.client.openConversation("main");
    f.resources.sessions[0].resources = [];
    f.events.push(
      {
        id: "old-user",
        type: "user.message",
        content: [{ type: "text", text: "My previous marker is woodland-42" }],
      },
      {
        id: "old-answer",
        type: "agent.message",
        content: [{ type: "text", text: "The result is 42" }],
      },
    );
    const next = await f.client.openConversation("main");
    expect(next.id).not.toBe(original.id);
    expect(f.resources.sessions).toHaveLength(2);
    const override = f.resources.sessions[1].agent as Record<string, unknown>;
    expect(override.type).toBe("agent_with_overrides");
    expect(String(override.system)).toContain(
      "<open-muse-conversation-history>",
    );
    expect(String(override.system)).toContain("<open-muse-identity>");
    expect(
      (await f.client.conversationIndex()).entries[next.id].previousIds,
    ).toEqual([original.id]);
    f.sessionEvents.set(next.id, []);
    const history = await f.client.events(next.id);
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      source_session_id: original.id,
      source_event_id: "old-answer",
    });
    expect(history[1].id).not.toBe("old-answer");
    const saved = await f.client.saveReply(
      history[1].source_session_id!,
      history[1].source_event_id!,
    );
    expect(saved.session_id).toBe(original.id);
    await expect(
      f.client.send(original.id, {
        type: "user.message",
        text: "Do not send to the older chapter",
      }),
    ).rejects.toThrow("has continued");
    await f.client.send(next.id, {
      type: "user.message",
      text: "Continue the same conversation",
    });
    expect(f.sessionEvents.get(next.id)?.map((event) => event.type)).toEqual([
      "user.message",
      "system.message",
    ]);
    expect(
      f.fetcher.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });
  it("gives each conversation's cloud environment its Lark token once, in the hidden note", async () => {
    const f = fixture();
    await f.login();
    const session = await f.client.openConversation("side", "Lark");
    // The account service issues each conversation its Lark token.
    const issueLarkToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ token: "t".repeat(43), expires_at: 0 });
    Object.assign(f.account.account, {
      issueLarkToken,
      larkStateUrl: () => "https://svc.example/v1/lark/sandbox/state",
    });
    const notes = () =>
      f.events
        .filter((event) => event.type === "system.message")
        .map((event) => event.content?.[0]?.text ?? "");
    // A token that cannot be issued never holds the message back.
    await f.client.send(session.id, { type: "user.message", text: "One" });
    expect(notes()[0]).not.toContain("[Open Muse Lark sign-in]");
    await f.client.send(session.id, { type: "user.message", text: "Two" });
    expect(notes()[1]).toContain(
      `/opt/open-muse/lark-link 'https://svc.example/v1/lark/sandbox/state' '${"t".repeat(43)}'`,
    );
    await f.client.send(session.id, { type: "user.message", text: "Three" });
    expect(notes()[2]).not.toContain("[Open Muse Lark sign-in]");
    expect(issueLarkToken).toHaveBeenCalledTimes(2);
  });
  it("continues a main chat that has attachment mounts, refusing other mounts", async () => {
    const f = fixture();
    await f.login();
    const original = await f.client.openConversation("main");
    // Files this app mounted for attachments may stay behind.
    f.resources.sessions[0].resources = [
      {
        type: "file",
        file_id: "file-1",
        mount_path: "/mnt/session/uploads/clip-frame-00s-1a2b3c4d.jpg",
      },
    ];
    const next = await f.client.openConversation("main");
    expect(next.id).not.toBe(original.id);
    expect(f.resources.sessions).toHaveLength(2);
    // Anything else is not migrated silently.
    f.resources.sessions[1].resources = [
      { type: "file", file_id: "file-2", mount_path: "/workspace/data.csv" },
    ];
    await expect(f.client.openConversation("main")).rejects.toThrow(
      "cannot be safely updated",
    );
    expect(f.resources.sessions).toHaveLength(2);
  });
  it("keeps a changed source history intact and resumes with a fresh archive", async () => {
    const f = fixture();
    await f.login();
    const original = await f.client.openConversation("main");
    f.resources.sessions[0].resources = [];
    const handler = f.fetcher.getMockImplementation()!;
    let mutated = false;
    f.fetcher.mockImplementation(async (input, init) => {
      const result = await handler(input, init);
      if (
        !mutated &&
        init?.method === "POST" &&
        String(input).endsWith("/memories")
      ) {
        mutated = true;
        f.events.push({
          id: "late",
          type: "user.message",
          content: [{ type: "text", text: "Arrived during preparation" }],
        });
      }
      return result;
    });
    await expect(f.client.openConversation("main")).rejects.toThrow(
      "changed while preparing",
    );
    expect((await f.client.conversationIndex()).mainId).toBe(original.id);
    expect(f.resources.sessions).toHaveLength(1);
    const next = await f.client.openConversation("main");
    expect(next.id).not.toBe(original.id);
    expect(f.resources.sessions).toHaveLength(2);
  });
  it("requires history evidence before another main message after an ambiguous submission", async () => {
    const f = fixture();
    await f.login();
    const main = await f.client.openConversation("main");
    const handler = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) => {
      if (init?.method === "POST" && String(input).endsWith("/events"))
        throw new TypeError("Submission lost");
      return handler(input, init);
    });
    await expect(
      f.client.send(main.id, { type: "user.message", text: "One message" }),
    ).rejects.toThrow("Submission lost");
    await expect(
      f.client.send(main.id, { type: "user.message", text: "Another message" }),
    ).rejects.toThrow("unconfirmed");
    const pending = (await f.client.conversationIndex()).sending!;
    f.events.push({
      id: pending.event,
      type: "user.message",
      content: [{ type: "text", text: "One message" }],
    });
    await f.client.events(main.id);
    expect((await f.client.conversationIndex()).sending).toBeUndefined();
    f.fetcher.mockImplementation(handler);
    await f.client.send(main.id, {
      type: "user.message",
      text: "Now confirmed",
    });
    expect(f.events.map((event) => event.type)).toEqual([
      "user.message",
      "user.message",
      "system.message",
    ]);
  });
  it("does not mark a session creation as ambiguous when memory preparation fails first", async () => {
    const f = fixture();
    await f.login();
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation((input, init) =>
      String(input).endsWith("/memory_stores") && init?.method === "POST"
        ? Promise.resolve(Response.json({}, { status: 503 }))
        : original(input, init),
    );
    await expect(f.client.openConversation("main")).rejects.toThrow("503");
    expect((await f.client.conversationIndex()).pending).toBeUndefined();
    expect(f.resources.sessions).toHaveLength(0);
  });
  it("restores one main conversation and locally archives side chats through the direct client", async () => {
    const f = fixture();
    await f.login();
    const main = await f.client.openConversation("main");
    const side = await f.client.openConversation("side", "A separate topic");
    await f.client.archiveConversation(side.id, true);
    const restored = new Client({
      account: f.account.account,
      vault: f.vault,
      database: f.db,
      fetcher: f.fetcher,
    });
    await restored.restore();
    expect((await restored.openConversation("main")).id).toBe(main.id);
    expect((await restored.conversationIndex()).entries[side.id].archived).toBe(
      true,
    );
    expect(f.resources.sessions).toHaveLength(2);
    expect(f.resources.memory_stores).toHaveLength(1);
    expect(
      f.resources.sessions.every(
        (row) =>
          JSON.stringify(row.resources) ===
          JSON.stringify([
            { type: "memory_store", memory_store_id: "memory_stores-1" },
          ]),
      ),
    ).toBe(true);
    expect(await f.client.identityMounted(main.id)).toBe(true);
    expect(String(f.resources.agents[0].system)).toContain(
      "<open-muse-identity>",
    );
    expect(
      f.fetcher.mock.calls.some(([, request]) => request?.method === "DELETE"),
    ).toBe(false);
    expect((await restored.sessions()).data.map((row) => row.id)).toContain(
      side.id,
    );
  });
  it("keeps conversation navigation read-only while signed out", async () => {
    const f = fixture();
    expect(await f.client.conversationIndex()).toEqual({ entries: {} });
    expect((await f.client.companionIdentity()).name).toBe("Muse");
    await expect(f.client.openConversation("main")).rejects.toThrow(
      "Add an Ark API key",
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each(
    operations.filter(
      (op) =>
        op.transport === "rest" &&
        !["UploadFile", "CreateSkill", "StreamSessionEvents"].includes(op.id),
    ),
  )(
    "calls $id directly using the catalog method and fields, within the account",
    async (op) => {
      const f = fixture();
      await f.login();
      await f.client.prepareWorkspace();
      f.fetcher.mockImplementation(async () => Response.json({ data: [] }));
      const params = Object.fromEntries(
        op.fields
          .filter((field) => field.in === "path")
          .map((field) => [field.name, "resource-123"]),
      );
      const body = Object.fromEntries(
        op.fields
          .filter((field) => field.in === "body" && field.required)
          .map((field) => [
            field.name,
            field.type === "array" ? [] : field.type === "integer" ? 1 : "test",
          ]),
      );
      const query = op.fields.some(
        (field) => field.name === "page" && field.in === "query",
      )
        ? { page: "opaque+/=" }
        : {};
      const input = { params, body, query, confirm: true };
      // An account reaches only its own agent, environment, memory store and
      // sessions; anything else is refused before any request.
      const refused = await f.client.ma(op.id, input).then(
        () => undefined,
        (error: Error) => error.message,
      );
      if (refused) {
        expect(refused).toContain("Studio reaches only");
        return;
      }
      const [url, request] = f.fetcher.mock.calls.at(-1)!;
      expect(url).toBe(ARK_BASE_URL + buildRequest(op, input));
      expect(request?.method).toBe(op.method);
      expect(request?.body).toBe(
        op.method === "POST" ? JSON.stringify(body) : undefined,
      );
    },
  );
  it("has no backend dependency while signed out", async () => {
    const f = fixture();
    await f.client.restore();
    expect((await f.client.config()).mode).toBe("disconnected");
    expect((await f.client.sessions()).data).toEqual([]);
    expect((await f.client.goals()).data).toEqual([]);
    expect((await f.client.library()).data).toEqual([]);
    await expect(f.client.prepareWorkspace()).rejects.toThrow(
      "Add an Ark API key",
    );
    await expect(
      f.client.send("session", { type: "user.message", text: "hello" }),
    ).rejects.toThrow("Add an Ark API key");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("verifies keys directly and restores them from the account, never this device", async () => {
    const f = fixture();
    await f.login();
    // The key is kept with the account, not on this device.
    expect(await f.vault.read()).toBe("");
    expect(f.fetcher.mock.calls[0][0]).toBe(`${ARK_BASE_URL}/agents?limit=1`);
    const next = new Client({
      account: f.account.account,
      vault: f.vault,
      database: f.db,
      fetcher: f.fetcher,
    });
    await next.restore();
    expect(await next.auth("status")).toMatchObject({
      ready: true,
      method: "api_key",
    });
    await next.auth("logout", { confirm: true });
    expect(next.signedIn()).toBe(false);
  });
  it("does not save invalid keys or hide upstream failures", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
      Response.json(
        { error: { code: "AuthenticationError" } },
        { status: 401 },
      ),
    );
    await expect(f.login()).rejects.toThrow("HTTP 401");
    expect(await f.vault.read()).toBe("");
    expect(f.client.signedIn()).toBe(false);
  });
  it("replaces the account's key when another one is saved", async () => {
    const f = fixture();
    await f.login();
    await f.client.auth("api-key", {
      apiKey: "test-replacement-key-123456789",
      project: "",
      confirm: true,
    });
    expect(f.client.signedIn()).toBe(true);
    expect((await f.account.account.accountCredential()).credential).toEqual({
      apiKey: "test-replacement-key-123456789",
      project: "",
    });
  });
  it("does not claim login success when the account cannot save the key", async () => {
    const f = fixture();
    vi.spyOn(f.account.account, "saveAccountCredential").mockRejectedValue(
      new Error("service unavailable"),
    );
    await expect(f.login()).rejects.toThrow("service unavailable");
    expect(f.client.signedIn()).toBe(false);
  });
  it("creates and reuses automatic workspaces with Chrome/CDP/Lark and always_allow", async () => {
    const f = fixture();
    await f.login();
    await f.client.prepareWorkspace();
    expect(await f.client.workspaceStatus()).toMatchObject({ state: "ready" });
    expect(f.resources.agents[0]).toMatchObject({
      tools: [
        { default_config: { permission_policy: { type: "always_allow" } } },
        ...deviceTools,
      ],
    });
    expect(JSON.stringify(f.resources.environments[0])).toContain("Chrome");
    expect(JSON.stringify(f.resources.agents[0])).toContain("CDP");
    expect(
      f.fetcher.mock.calls.some(([url]) => String(url).includes("/models")),
    ).toBe(false);
    await f.client.prepareWorkspace();
    expect(f.resources.agents).toHaveLength(1);
    expect(f.resources.environments).toHaveLength(1);
  });
  it("adds the device tools to an owned agent once and keeps its other tools", async () => {
    const f = fixture();
    await f.login();
    await f.client.prepareWorkspace();
    const agent = f.resources.agents[0];
    const foreign = {
      type: "custom",
      name: "query_order",
      description: "Someone else's tool",
      input_schema: { type: "object", properties: {} },
    };
    const toolset = (agent.tools as Record<string, unknown>[])[0];
    // An agent from before device tools, with an older mac_open definition.
    agent.tools = [toolset, foreign, { ...deviceTools[2], description: "old" }];
    const updates = () =>
      f.fetcher.mock.calls.filter(
        ([url, init]) =>
          init?.method === "POST" &&
          /\/agents\/[^/]+$/.test(new URL(String(url)).pathname),
      ).length;
    // Policy is synchronized before each new conversation is created.
    const sync = () =>
      (
        f.client as unknown as {
          context(): { workspace: { syncPolicy(): Promise<void> } };
        }
      )
        .context()
        .workspace.syncPolicy();
    const before = updates();
    await sync();
    expect(updates()).toBe(before + 1);
    expect(f.resources.agents[0].tools).toEqual([
      toolset,
      foreign,
      ...deviceTools,
    ]);
    await sync();
    expect(updates()).toBe(before + 1);
  });
  it("leaves the agent alone when Ark stored its tools without additionalProperties", async () => {
    const f = fixture();
    await f.login();
    await f.client.prepareWorkspace();
    const sync = () =>
      (
        f.client as unknown as {
          context(): { workspace: { syncPolicy(): Promise<void> } };
        }
      )
        .context()
        .workspace.syncPolicy();
    await sync();
    // As Ark returns an agent: tool input schemas lose additionalProperties.
    const drop = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(drop)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => key !== "additionalProperties")
                .map(([key, item]) => [key, drop(item)]),
            )
          : value;
    const agent = f.resources.agents[0];
    expect(JSON.stringify(agent.tools)).toContain("additionalProperties");
    agent.tools = drop(agent.tools) as typeof agent.tools;
    const updates = () =>
      f.fetcher.mock.calls.filter(
        ([url, init]) =>
          init?.method === "POST" &&
          /\/agents\/[^/]+$/.test(new URL(String(url)).pathname),
      ).length;
    const before = updates();
    await sync();
    await sync();
    expect(updates()).toBe(before);
  });
  it("recovers owned resources on another device without creating duplicates", async () => {
    const f = fixture();
    await f.login();
    await f.client.prepareWorkspace();
    const next = new Client({
      account: f.account.account,
      vault: f.vault,
      database: new LocalDatabase(`other-${uuid()}`),
      fetcher: f.fetcher,
    });
    await next.restore();
    await next.prepareWorkspace();
    // The account's workspace is reused, as the service recorded it.
    expect(f.resources.agents).toHaveLength(1);
    expect(f.resources.environments).toHaveLength(1);
  });
  it("persists real replies locally, preserves context history and isolates account data", async () => {
    const f = fixture();
    await f.login();
    await f.client.prepareWorkspace();
    const session = await f.client.create("A real task", "research");
    await f.client.send(session.id, { type: "user.message", text: "hello" });
    f.events.push({
      id: "reply",
      type: "agent.message",
      content: [{ type: "text", text: "42" }],
    });
    const saved = await f.client.saveReply(session.id, "reply");
    expect(saved.text).toBe("42");
    expect(
      (await f.client.events(session.id)).map((event) => event.type),
    ).toEqual(["user.message", "system.message", "agent.message"]);
    expect((await f.client.sessions()).data[0].category).toBe("research");
    await Promise.all([
      f.client.saveReply(session.id, "reply"),
      f.client.saveReply(session.id, "reply"),
    ]);
    expect((await f.client.library()).data).toHaveLength(1);
    const goal = await f.client.createGoal("Plan", "Details");
    await f.client.updateGoal(goal.id, {
      status: "completed",
      session_id: session.id,
    });
    expect((await f.client.goals()).data[0].status).toBe("completed");
    await f.switchAccount("muse_user_other");
    expect((await f.client.library()).data).toHaveLength(0);
    expect((await f.client.goals()).data).toHaveLength(0);
    await f.switchAccount("muse_user_test");
    expect((await f.client.library()).data).toHaveLength(1);
  });
  it("lists session outputs only from this identity's Open Muse sessions", async () => {
    const f = fixture();
    expect((await f.client.libraryFiles()).data).toEqual([]);
    await f.login();
    await f.client.prepareWorkspace();
    const own = await f.client.create("Report task", "research");
    f.resources.sessions.push({
      id: "sesn-foreign",
      title: "Someone else",
      agent: { id: "agent-foreign", metadata: {} },
    });
    const created = Math.floor(Date.now() / 1000);
    const file = (id: string, session: string) => ({
      id,
      purpose: "agent",
      filename: `${id}.md`,
      bytes: 10,
      mime_type: "text/markdown",
      created_at: created,
      expire_at: created + 3600,
      status: "active",
      scope: { type: "session", id: session },
      download_url: `https://bucket.tos-cn-beijing.volces.com/${id}?sig=1`,
    });
    f.files.push(
      file("file-own", own.id),
      file("file-foreign", "sesn-foreign"),
    );
    const listed = (await f.client.libraryFiles()).data;
    expect(listed.map((item) => item.id)).toEqual(["file-own"]);
    expect(listed[0].session_title).toBe("Report task");
    expect(JSON.stringify(listed)).not.toContain("sig=1");
    const opened = await f.client.libraryFileDownload("file-own");
    expect(opened.url).toContain("sig=1");
    const request = f.fetcher.mock.calls.find(([input]) =>
      String(input).endsWith("/files/file-own"),
    );
    expect(
      new Headers(request?.[1]?.headers).get("X-Ark-PreSignedURL-ExpiresAfter"),
    ).toBe("300");
    await expect(
      f.client.libraryFileDownload("file-foreign"),
    ).rejects.toMatchObject({ status: 404 });
    await f.switchAccount("muse_user_other");
    expect((await f.client.libraryFiles()).data).toEqual([]);
  });
  it("uploads images as user data and sends text documents inline", async () => {
    const f = fixture();
    await f.login();
    await f.client.prepareWorkspace();
    const session = await f.client.create("Attachment task", "general");
    const image = await f.client.uploadAttachment(
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      "cat.png",
      0,
    );
    const note = await f.client.uploadAttachment(
      new Blob(["# Notes"], { type: "" }),
      "notes.md",
      1,
    );
    if (!("file_id" in image) || !("text" in note))
      throw new Error("Unexpected attachment shape");
    // MA's file store rejects plain text, so only the image is uploaded.
    expect(f.files.map((file) => file.purpose)).toEqual(["user_data"]);
    expect(note.text).toBe("# Notes");
    expect(await f.client.attachmentNames()).toEqual({
      [image.file_id]: "cat.png",
    });
    await expect(
      f.client.send(session.id, { type: "user.message", text: "  " }),
    ).rejects.toThrow("Write a message or attach a file.");
    await f.client.send(session.id, {
      type: "user.message",
      text: "",
      attachments: [image, note],
    });
    const [message, guidance] = f.events.slice(-2);
    expect(message.content).toEqual([
      { type: "image", source: { type: "file", file_id: image.file_id } },
      {
        type: "document",
        source: { type: "text", media_type: "text/plain", data: "# Notes" },
        title: "notes.md",
      },
    ]);
    // The file is mounted before sending, and its path reaches the tools.
    expect(f.mounts).toHaveLength(1);
    expect(f.mounts[0]).toMatchObject({ session: session.id });
    expect(image.stored).toMatch(/^cat-[a-f0-9]{8}\.png$/);
    const path = `/mnt/session/uploads/${image.stored}`;
    expect(guidance.type).toBe("system.message");
    expect(guidance.content?.[0].text).toContain(`"cat.png": ${path}`);
    expect(guidance.content?.[0].text).toContain('"notes.md"');
    expect(guidance.content?.[0].text).not.toContain("# Notes");
    await f.client.send(session.id, {
      type: "user.message",
      text: "Compare them",
      attachments: [image],
    });
    expect(f.mounts).toHaveLength(1);
    expect(f.events.at(-2)?.content?.at(-1)).toEqual({
      type: "text",
      text: "Compare them",
    });
    expect(f.events.at(-1)?.content?.[0].text).toContain(path);
    await f.client.send(session.id, { type: "user.message", text: "Plain" });
    expect(f.events.at(-2)?.type).toBe("user.message");
    expect(f.events.at(-1)?.content?.[0].text).toContain("<open-muse-context>");
    expect(f.events.at(-1)?.content?.[0].text).not.toContain(
      "<open-muse-attachments>",
    );
    await expect(
      f.client.send(session.id, {
        type: "user.message",
        text: "x",
        attachments: Array(5).fill(image),
      }),
    ).rejects.toThrow();
    await f.switchAccount("muse_user_other");
    expect(await f.client.attachmentNames()).toEqual({});
  });
  it("keeps a sent photo in the account and shows it on other devices", async () => {
    const f = fixture();
    const saved = new Map<string, Blob>();
    const reads: string[] = [];
    f.account.account.storeAttachmentImage = vi.fn(
      async (fileId: string, image: Blob) => {
        saved.set(fileId, image);
      },
    );
    f.account.account.attachmentImage = vi.fn(async (fileId: string) => {
      reads.push(fileId);
      return saved.get(fileId);
    });
    await f.login();
    await f.client.prepareWorkspace();
    const session = await f.client.create("Photo task", "general");
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], {
      type: "image/png",
    });
    const image = await f.client.uploadAttachment(blob, "cat.png", 0);
    if (!("file_id" in image)) throw new Error("Unexpected attachment shape");
    await f.client.keepSentImage(image.file_id, blob);
    // Staging alone keeps nothing in the account.
    expect(saved.size).toBe(0);
    await f.client.send(session.id, {
      type: "user.message",
      text: "",
      attachments: [image],
    });
    await vi.waitFor(() => expect(saved.get(image.file_id)?.size).toBe(4));
    // This device shows its own copy without asking the account.
    expect((await f.client.sentMedia(image.file_id))?.kind).toBe("image");
    expect(reads).toEqual([]);
    // A photo sent from another device comes from the account once, then
    // from this device's copy.
    saved.set("file_elsewhere", blob);
    expect((await f.client.sentMedia("file_elsewhere"))?.blob.size).toBe(4);
    await vi.waitFor(async () =>
      expect((await f.client.sentMedia("file_elsewhere"))?.kind).toBe("image"),
    );
    expect(reads).toEqual(["file_elsewhere"]);
    // One the account has no copy of yet is not asked for again at once,
    // but is after a while, when the sending device has saved it.
    let clock = Date.now();
    (f.client as unknown as { now: () => number }).now = () => clock;
    expect(await f.client.sentMedia("file_late")).toBeUndefined();
    expect(await f.client.sentMedia("file_late")).toBeUndefined();
    expect(reads).toEqual(["file_elsewhere", "file_late"]);
    saved.set("file_late", blob);
    clock += 5_000;
    expect((await f.client.sentMedia("file_late"))?.kind).toBe("image");
    expect(reads).toEqual(["file_elsewhere", "file_late", "file_late"]);
  });
  it("lists and opens only this identity's sessions under a shared key", async () => {
    const f = fixture();
    await f.login();
    await f.client.prepareWorkspace();
    const own = await f.client.create("Mine", "general");
    f.resources.agents.push({
      id: "agent-other",
      metadata: { open_muse_workspace: "another-identity" },
    });
    f.resources.sessions.push(
      {
        id: "sesn-other",
        title: "Another account's chat",
        status: "idle",
        agent: "agent-other",
      },
      {
        id: "sesn-plain",
        title: "Created outside Open Muse",
        status: "idle",
        agent: { id: "agent-plain", metadata: {} },
      },
    );
    const listed = (await f.client.sessions()).data.map((row) => row.id);
    expect(listed).toContain(own.id);
    expect(listed).not.toContain("sesn-other");
    expect(listed).not.toContain("sesn-plain");
    await expect(f.client.session("sesn-other")).rejects.toThrow(
      "This conversation was not found.",
    );
    expect((await f.client.session(own.id)).id).toBe(own.id);
  });
  it("creates conversations on the chosen model and moves the main chat to it", async () => {
    const f = fixture();
    await f.login();
    await f.client.prepareWorkspace();
    expect(await f.client.modelChoice()).toBeUndefined();
    const main = await f.client.openConversation("main");
    await f.client.setModelChoice({
      model: "doubao-seed-2-1-lite-260915",
      effort: "low",
    });
    const side = await f.client.create("Side", "general");
    const created = f.resources.sessions.find((row) => row.id === side.id)!;
    expect((created.agent as { model?: unknown }).model).toEqual({
      id: "doubao-seed-2-1-lite-260915",
      reasoning_effort: "low",
    });
    // The main chat continues into a chapter on the chosen model.
    const next = await f.client.openConversation("main");
    expect(next.id).not.toBe(main.id);
    const chapter = f.resources.sessions.find((row) => row.id === next.id)!;
    expect((chapter.agent as { model?: unknown }).model).toEqual({
      id: "doubao-seed-2-1-lite-260915",
      reasoning_effort: "low",
    });
    expect((await f.client.openConversation("main")).id).toBe(next.id);
    // A level the model does not accept is refused.
    await expect(
      f.client.setModelChoice({
        model: "deepseek-v4-1-flash-260910",
        effort: "minimal",
      }),
    ).rejects.toThrow();
    await f.client.setModelChoice(null);
    expect(await f.client.modelChoice()).toBeUndefined();
    const plain = await f.client.create("Plain", "general");
    const row = f.resources.sessions.find((item) => item.id === plain.id)!;
    expect((row.agent as { model?: unknown }).model).not.toEqual({
      id: "doubao-seed-2-1-lite-260915",
      reasoning_effort: "low",
    });
  });
  it("keeps the Apple Health connection per identity on this device", async () => {
    const f = fixture();
    expect(await f.client.healthConnected()).toBe(false);
    await f.login();
    expect(await f.client.healthConnected()).toBe(false);
    await f.client.setHealthConnected(true);
    expect(await f.client.healthConnected()).toBe(true);
    await f.switchAccount("muse_user_other");
    // Another identity on this device has not connected Health.
    expect(await f.client.healthConnected()).toBe(false);
  });
  it("keeps each device source's read permission per identity", async () => {
    const f = fixture();
    await f.login();
    expect(await f.client.devicePermission("health")).toBe("ask");
    await f.client.setDevicePermission("health", "allow");
    // Allowing Health is the same as connecting it.
    expect(await f.client.healthConnected()).toBe(true);
    expect(await f.client.devicePermission("health")).toBe("allow");
    await f.client.setDevicePermission("health", "deny");
    expect(await f.client.healthConnected()).toBe(false);
    expect(await f.client.devicePermission("health")).toBe("deny");
    // Calendar, Reminders and Contacts are only ever asked or declined.
    await expect(
      f.client.setDevicePermission("calendar", "allow"),
    ).rejects.toThrow();
    expect(await f.client.devicePermission("calendar")).toBe("ask");
    await f.client.setDevicePermission("contacts", "deny");
    expect(await f.client.devicePermission("contacts")).toBe("deny");
    await f.client.setDevicePermission("contacts", "ask");
    expect(await f.client.devicePermission("contacts")).toBe("ask");
    await f.switchAccount("muse_user_other");
    expect(await f.client.devicePermission("health")).toBe("ask");
  });
  it("keeps reactions on this device for the signed-in identity only", async () => {
    const f = fixture();
    await f.login();
    const before = f.events.length;
    expect(await f.client.reactions()).toEqual({});
    expect(await f.client.setReaction("evt_1", "👍")).toEqual({ evt_1: "👍" });
    await f.client.setReaction("evt_2", "🔥");
    expect(await f.client.setReaction("evt_1", null)).toEqual({ evt_2: "🔥" });
    expect(await f.client.reactions()).toEqual({ evt_2: "🔥" });
    // Reactions are local marks; nothing is sent to Ark.
    expect(f.events).toHaveLength(before);
    await f.switchAccount("muse_user_other");
    expect(await f.client.reactions()).toEqual({});
  });
  it("serializes concurrent cloud goal updates without losing records", async () => {
    const f = fixture();
    await f.login();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        f.client.createGoal(`Goal ${i}`, ""),
      ),
    );
    expect((await f.client.goals()).data).toHaveLength(10);
  });
  it("only auto-approves pending safe reads and preserves a local audit marker", async () => {
    const f = fixture();
    await f.login();
    f.events.push(...pending());
    const body = {
      type: "user.tool_confirmation",
      tool_use_id: "tool",
      result: "allow",
      automatic: true,
    };
    const result = await f.client.send("session", body);
    expect(result.data[0]).toMatchObject({
      session_thread_id: "thread",
      approval_source: "automatic",
    });
    const sent = JSON.parse(
      String(
        f.fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]
          ?.body,
      ),
    );
    expect(sent.events[0].approval_source).toBeUndefined();
    await f.client.send("session", body);
    expect(
      f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it("does not auto-approve unsafe tools or overwrite an upstream denial", async () => {
    const f = fixture();
    await f.login();
    f.events.push(...pending());
    f.events[0].name = "bash";
    const body = {
      type: "user.tool_confirmation",
      tool_use_id: "tool",
      result: "allow",
      automatic: true,
    };
    await expect(f.client.send("session", body)).rejects.toThrow(
      "manual approval",
    );
    f.events.push({
      id: "denial",
      type: "user.tool_confirmation",
      tool_use_id: "tool",
      result: "deny",
    });
    expect((await f.client.send("session", body)).data[0].result).toBe("deny");
    expect(
      f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });
  it("does not repeat an uncertain auto-approval after relaunch", async () => {
    const f = fixture();
    await f.login();
    f.events.push(...pending());
    const base = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation((url, init) =>
      init?.method === "POST"
        ? Promise.reject(new Error("lost"))
        : base(url, init),
    );
    const body = {
      type: "user.tool_confirmation",
      tool_use_id: "tool",
      result: "allow",
      automatic: true,
    };
    await expect(f.client.send("session", body)).rejects.toThrow("lost");
    const next = new Client({
      account: f.account.account,
      vault: f.vault,
      database: f.db,
      fetcher: f.fetcher,
    });
    await next.restore();
    await expect(next.send("session", body)).rejects.toThrow("unconfirmed");
    expect(
      f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it("reads streaming events directly from Ark", async () => {
    const f = fixture();
    await f.login();
    const events: AgentEvent[] = [];
    const connected = vi.fn();
    await f.client.stream(
      "session",
      new AbortController().signal,
      (e) => events.push(e),
      connected,
    );
    expect(connected).toHaveBeenCalledOnce();
    expect(events[0].id).toBe("live");
    expect(f.fetcher.mock.calls.at(-1)![0]).toBe(
      `${ARK_BASE_URL}/sessions/session/events/stream`,
    );
  });
  it("reads the latest events first and never loops on page tokens", async () => {
    const f = fixture();
    await f.login();
    f.fetcher
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "2", type: "agent.message" }],
          next_page: "opaque+/=",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "1", type: "agent.message" }] }),
      );
    expect((await f.client.events("session")).map((e) => e.id)).toEqual([
      "1",
      "2",
    ]);
    expect(f.fetcher.mock.calls.at(-2)![0]).toContain("order=desc");
    expect(f.fetcher.mock.calls.at(-1)![0]).toContain("page=opaque%2B%2F%3D");
    // A token Ark gives twice ends the read instead of failing it.
    f.fetcher.mockImplementation(async () =>
      Response.json({
        data: [{ id: "same", type: "agent.message" }],
        next_page: "repeat",
      }),
    );
    expect((await f.client.events("session")).map((e) => e.id)).toEqual([
      "same",
    ]);
    // An endless history opens with its latest part and reads the rest on
    // request, a few pages at a time.
    let page = 0;
    f.fetcher.mockImplementation(async () => {
      page++;
      return Response.json({
        data: Array.from({ length: 200 }, (_, row) => ({
          id: `${page}-${row}`,
          type: "agent.message",
        })),
        next_page: `page-${page}`,
      });
    });
    const window = await f.client.eventWindow("session");
    expect(window.events).toHaveLength(400);
    expect(window.older).toEqual({ session: "session", page: "page-2" });
    expect(page).toBe(2);
    const older = await f.client.olderEvents("session", window.older!);
    expect(older.events).toHaveLength(400);
    expect(older.older).toEqual({ session: "session", page: "page-4" });
    // Later reads only take what came after the events already shown.
    page = 10;
    const known = new Set(window.events.map((event) => event.id));
    f.fetcher.mockImplementation(async () =>
      Response.json({
        data: [
          { id: "new", type: "agent.message" },
          { id: window.events.at(-1)!.id, type: "agent.message" },
        ],
        next_page: "more",
      }),
    );
    const update = await f.client.eventWindow("session", undefined, known);
    expect(update.replace).toBe(false);
    expect(update.events.map((event) => event.id)).toEqual([
      window.events.at(-1)!.id,
      "new",
    ]);
  });
  it("keeps failures real without manufacturing assistant replies", async () => {
    const f = fixture();
    await f.login();
    f.fetcher.mockResolvedValue(Response.json({}, { status: 500 }));
    await expect(
      f.client.send("session", { type: "user.message", text: "hello" }),
    ).rejects.toThrow("HTTP 500");
    expect(f.events).toEqual([]);
  });
  it("retains operation validation and control-plane authorization requirements", async () => {
    const f = fixture();
    await f.login();
    await expect(f.client.ma("Unregistered", {})).rejects.toThrow(
      "Unregistered",
    );
    await f.client.prepareWorkspace();
    await expect(
      f.client.ma("UpdateAgent", {
        params: { id: f.resources.agents[0].id as string },
        body: { description: "x" },
      }),
    ).rejects.toThrow("Confirm");
    const top = operations.find(
      (o) => o.transport === "top" && o.id.startsWith("List"),
    )!;
    // Console-only operations are out of an account's reach as well.
    await expect(f.client.ma(top.id)).rejects.toThrow("Studio reaches only");
    expect(f.fetcher).not.toHaveBeenCalledWith(
      expect.stringContaining("volcengineapi.com"),
      expect.anything(),
    );
    expect(
      (await f.client.ma<{ data: unknown[] }>("ListAgents")).data,
    ).toHaveLength(1);
  });
});

describe("Direct credentials and origin boundaries", () => {
  it("leaves an earlier Volcano SSO sign-in on this device untouched and unused", async () => {
    const f = fixture();
    const legacy = JSON.stringify({
      accessKeyId: "test-legacy-ak",
      secretKey: "test-legacy-sk",
      sessionToken: "test-legacy-sts",
      refreshToken: "test-legacy-refresh",
      expiresAt: Date.now() + 60_000,
      apiKey: "test-legacy-minted-key-123456",
      project: "legacy-project",
    });
    await f.vault.write(legacy);
    vi.mocked(f.vault.write).mockClear();
    await f.client.restore();
    expect(f.client.signedIn()).toBe(false);
    expect(await f.client.auth("status")).toMatchObject({
      loggedIn: false,
      ready: false,
    });
    await expect(
      f.client.send("session", { type: "user.message", text: "hello" }),
    ).rejects.toThrow("API key");
    for (const path of ["begin", "complete", "projects", "project"])
      await expect(f.client.auth(path, {})).rejects.toThrow("Unknown");
    expect(f.fetcher).not.toHaveBeenCalled();
    // The retired record stays untouched; the key goes to the account.
    await f.login();
    expect(f.client.signedIn()).toBe(true);
    expect(await f.vault.read()).toBe(legacy);
    expect(f.vault.write).not.toHaveBeenCalled();
  });
  it("leaves an API key an earlier release saved on this device untouched and unused", async () => {
    const saved = JSON.stringify({
      kind: "api_key",
      apiKey: "test-local-build-key-123456",
      project: "local-project",
    });
    let value = saved;
    const vault = {
      read: vi.fn(async () => value),
      write: vi.fn(async (next: string) => {
        value = next;
      }),
    };
    const fetcher = vi.fn<typeof fetch>();
    const account = {
      accountConfigured: () => true,
      accountOwner: () => undefined,
      accountCredential: vi.fn(),
      saveAccountCredential: vi.fn(),
      removeAccountCredential: vi.fn(),
    } as unknown as AccountProvider;
    const auth = new DirectAuth(fetcher, account);
    await auth.restore();
    expect(auth.status()).toEqual({
      loggedIn: false,
      ready: false,
      method: undefined,
      project: undefined,
      account: { signedIn: false },
    });
    for (const path of ["import-legacy", "remove-legacy"])
      await expect(auth.execute(path, { confirm: true })).rejects.toThrow(
        "Unknown",
      );
    expect(value).toBe(saved);
    expect(vault.write).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(account.saveAccountCredential).not.toHaveBeenCalled();
  });
  it("keeps browser secrets only in session storage", async () => {
    const memory = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => memory.get(key),
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    });
    const local = { setItem: vi.fn() };
    vi.stubGlobal("localStorage", local);
    await credentials.write("test-secret");
    expect(await credentials.read()).toBe("test-secret");
    expect(local.setItem).not.toHaveBeenCalled();
    await credentials.write("");
    expect(await credentials.read()).toBe("");
  });
  it("uses native secure storage with an acknowledged write and fails closed", async () => {
    const postMessage = vi.fn(async ({ operation }: { operation: string }) =>
      operation === "read" ? "saved" : true,
    );
    vi.stubGlobal("webkit", {
      messageHandlers: { museCredentials: { postMessage } },
    });
    expect(await credentials.read()).toBe("saved");
    await credentials.write("new");
    expect(postMessage).toHaveBeenLastCalledWith({
      operation: "write",
      value: "new",
    });
    postMessage.mockRejectedValue(new Error("locked"));
    await expect(credentials.read()).rejects.toThrow("secure storage");
  });
  it("times out a stalled native credential bridge", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("webkit", {
      messageHandlers: {
        museCredentials: { postMessage: () => new Promise(() => {}) },
      },
    });
    const pending = expect(credentials.read()).rejects.toThrow(
      "secure storage",
    );
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
  });
  it("never sends credentials to a proxy, redirect, localhost, or arbitrary host", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetcher);
    for (const url of [
      "http://127.0.0.1:4311/api/sessions",
      "https://muse.example/api",
      "https://evil.example",
      // Retired Volcano SSO and console endpoints.
      "https://signin.volcengine.com/authorize/oauth/token",
      "https://open.volcengineapi.com/",
      "https://iam.volcengineapi.com/",
    ])
      await expect(directFetch(url)).rejects.toThrow("allowed Volcano");
    await directFetch(`${ARK_BASE_URL}/models`);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
  });
  it("replaces the browser's own network failure text with readable errors", async () => {
    const url = `${ARK_BASE_URL}/sessions`;
    // A response whose body breaks off, as WebKit reports when the app is
    // suspended mid-response.
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("Load failed"));
          },
        }),
      );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => broken()),
    );
    const read = (await directFetch(url)).json();
    await expect(read).rejects.toMatchObject({ name: "NetworkError" });
    await expect(read).rejects.not.toThrow("Load failed");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Load failed")),
    );
    await expect(directFetch(url)).rejects.toMatchObject({
      name: "NetworkError",
      message: expect.stringContaining("Couldn't reach Volcano"),
    });

    // Running out of time reads as a timeout, not "Fetch is aborted".
    const timing = boundedSignal([], 10);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          (_url, init: RequestInit) =>
            new Promise((_, reject) =>
              init.signal!.addEventListener("abort", () =>
                reject(new DOMException("Fetch is aborted", "AbortError")),
              ),
            ),
        ),
    );
    await expect(
      directFetch(url, { signal: timing.signal }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      message: expect.stringContaining("did not answer in time"),
    });
    timing.dispose();

    // A request the caller cancelled keeps its own error.
    const cancel = new AbortController();
    const cancelled = directFetch(url, { signal: cancel.signal });
    cancel.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  });
  it("keeps workspace identity compatible with the prior mapping without storing raw keys", () => {
    const hash = digest(JSON.stringify([ARK_BASE_URL, key, ""]));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(key);
  });
});
