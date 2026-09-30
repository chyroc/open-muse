import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./legacy-server/app";
import { ArkClient, ApiError } from "./legacy-server/ark";
import { loadConfig } from "./legacy-server/config";
import { approvalKey } from "./legacy-server/approvals";
import { canAutoApprove } from "../shared/approval-policy";
import { pendingPermissions, type AgentEvent } from "../shared/types";
import { AutoApprover } from "../src/autoApprove";

const tool = (
  id = "search",
  name = "web_search",
  extra: Partial<AgentEvent> = {},
): AgentEvent => ({
  id,
  type: "agent.tool_use",
  name,
  evaluated_permission: "ask",
  session_thread_id: "thread-original",
  ...extra,
});
const waiting = (...tools: AgentEvent[]): AgentEvent[] => [
  ...tools,
  {
    id: "wait",
    type: "session.status_idle",
    stop_reason: {
      type: "requires_action",
      event_ids: tools.map((item) => item.id),
    },
  },
];

describe("Auto-approval allowlist", () => {
  it.each(["web_search", "web_fetch"])("allows built-in %s", (name) => {
    expect(canAutoApprove(tool("tool", name))).toBe(true);
  });
  it.each([
    tool("a", "web_search_evil"),
    tool("a", "mcp.web_search"),
    tool("a", "web-search"),
    tool("a", "web_fetch "),
    tool("a", "Web_Search"),
    tool("a", "bash"),
    tool("a", "send_email"),
    tool("a", "web_search", { type: "agent.mcp_tool_use" }),
    tool("a", "web_search", { type: "agent.message" }),
    tool("a", "web_fetch", { evaluated_permission: "deny" }),
    tool("a", "web_fetch", { evaluated_permission: "allow" }),
    tool("a", "web_fetch", { evaluated_permission: undefined }),
  ])("rejects out-of-scope $type / $name / $evaluated_permission", (event) => {
    expect(canAutoApprove(event)).toBe(false);
  });
});

describe("Auto-approval server", () => {
  let directory: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  let ark: ArkClient;
  let history: AgentEvent[];
  const configFor = () =>
    loadConfig({
      MUSE_MODE: "ark",
      MUSE_DATA_DIR: directory,
      ARK_API_KEY: "fake-test-key",
      ARK_AGENT_ID: "agt-test",
      ARK_ENVIRONMENT_ID: "env-test",
    });
  const submit = (toolId = "search", extra: object = {}) =>
    request(app.app)
      .post("/api/sessions/sesn-test/events")
      .send({
        type: "user.tool_confirmation",
        tool_use_id: toolId,
        result: "allow",
        automatic: true,
        ...extra,
      });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "muse-auto-approval-"));
    ark = new ArkClient(configFor());
    history = waiting(tool());
    vi.spyOn(ark, "events").mockImplementation(async () => ({
      data: structuredClone(history),
    }));
    vi.spyOn(ark, "send").mockImplementation(async (_id, event) => {
      const accepted = {
        ...event,
        processed_at: new Date().toISOString(),
      } as AgentEvent;
      history.push(accepted);
      return { data: [accepted] };
    });
    app = await createApp(configFor(), { ark });
    app.store.data.sessions.push({
      id: "sesn-test",
      title: "Auto-approval test",
      category: "general",
      status: "idle",
      created_at: "2026-09-29",
      updated_at: "2026-09-29",
    });
    await app.store.save();
  });
  afterEach(async () => {
    app.close();
    await rm(directory, { recursive: true, force: true });
  });
  it.each(["web_search", "web_fetch"])(
    "approves %s, keeping the thread and not uploading a local marker",
    async (name) => {
      history = waiting(tool("search", name));
      const result = await submit("search", {
        name: "forged",
        session_thread_id: "forged",
      }).expect(200);
      expect(ark.send).toHaveBeenCalledWith("sesn-test", {
        id: expect.any(String),
        type: "user.tool_confirmation",
        tool_use_id: "search",
        result: "allow",
        session_thread_id: "thread-original",
      });
      expect(result.body.data[0].approval_source).toBe("automatic");
      const page = await request(app.app)
        .get("/api/sessions/sesn-test/events")
        .expect(200);
      expect(page.body.data.at(-1).approval_source).toBe("automatic");
    },
  );
  it.each([
    tool("search", "bash"),
    tool("search", "send_email"),
    tool("search", "web_search", { type: "agent.mcp_tool_use" }),
    tool("search", "web_fetch", { evaluated_permission: "deny" }),
  ])(
    "a client-forged name cannot auto-approve $name / $type",
    async (event) => {
      history = waiting(event);
      await submit("search", {
        name: "web_search",
        evaluated_permission: "ask",
      }).expect(403);
      expect(ark.send).not.toHaveBeenCalled();
    },
  );
  it("does not approve when not in requires_action, already running again, or interrupted", async () => {
    for (const events of [
      [tool()],
      [...waiting(tool()), { id: "run", type: "session.status_running" }],
      [...waiting(tool()), { id: "stop", type: "user.interrupt" }],
    ]) {
      history = events;
      await submit().expect(409);
    }
    expect(ark.send).not.toHaveBeenCalled();
  });
  it("read-only history never triggers approval; a nonexistent session is denied access", async () => {
    await request(app.app).get("/api/sessions/sesn-test/events").expect(200);
    await request(app.app)
      .post("/api/sessions/foreign/events")
      .send({
        type: "user.tool_confirmation",
        tool_use_id: "search",
        result: "allow",
        automatic: true,
      })
      .expect(404);
    expect(ark.send).not.toHaveBeenCalled();
  });
  it("approves web tools one by one, leaving other tools in a mixed queue pending", async () => {
    history = waiting(
      tool(),
      tool("fetch", "web_fetch"),
      tool("email", "send_email"),
    );
    await submit().expect(200);
    await submit("fetch").expect(200);
    expect(pendingPermissions(history).map((event) => event.id)).toEqual([
      "email",
    ]);
    await submit("email").expect(403);
    expect(ark.send).toHaveBeenCalledTimes(2);
  });
  it.each(["allow", "deny"] as const)(
    "when a %s confirmation already exists, only returns history without resending",
    async (result) => {
      history.push({
        id: "manual",
        type: "user.tool_confirmation",
        tool_use_id: "search",
        result,
      });
      const response = await submit().expect(200);
      expect(response.body.data[0].result).toBe(result);
      expect(response.body.data[0].approval_source).toBeUndefined();
      expect(ark.send).not.toHaveBeenCalled();
    },
  );
  it("concurrent automatic/manual submissions share a lock, so only one request reaches upstream", async () => {
    let release!: () => void;
    vi.mocked(ark.send).mockImplementation(async (_id, event) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      history.push(event as AgentEvent);
      return { data: [event as AgentEvent] };
    });
    const first = submit().then((response) => response);
    await vi.waitFor(() => expect(ark.send).toHaveBeenCalledTimes(1));
    await submit().expect(409);
    await submit("search", { automatic: undefined }).expect(409);
    release();
    expect((await first).status).toBe(200);
    expect(ark.send).toHaveBeenCalledTimes(1);
  });
  it("persists the success record: no duplicate approval after restart with lagging history", async () => {
    const accepted = await submit().expect(200);
    history = waiting(tool());
    app.close();
    app = await createApp(configFor(), { ark });
    const replay = await submit().expect(200);
    expect(replay.body).toEqual(accepted.body);
    expect(ark.send).toHaveBeenCalledTimes(1);
  });
  it("supports upstreams that return only an acceptance envelope and does not misreport acceptance as failure", async () => {
    vi.mocked(ark.send).mockResolvedValueOnce({ ok: true } as never);
    const result = await submit().expect(200);
    expect(result.body.data[0]).toMatchObject({
      type: "user.tool_confirmation",
      tool_use_id: "search",
      result: "allow",
      approval_source: "automatic",
    });
    await submit().expect(200);
    expect(ark.send).toHaveBeenCalledTimes(1);
  });
  it("after a failure, refresh and restart do not blindly retry; explicit manual handling still works", async () => {
    vi.mocked(ark.send).mockRejectedValueOnce(
      new ApiError(502, "Simulated failure"),
    );
    await submit().expect(502);
    await submit().expect(409);
    app.close();
    app = await createApp(configFor(), { ark });
    await submit().expect(409);
    expect(ark.send).toHaveBeenCalledTimes(1);
    await submit("search", { automatic: undefined }).expect(200);
    expect(ark.send).toHaveBeenCalledTimes(2);
  });
  it("when the response is lost after upstream acceptance, checks history first and never resubmits", async () => {
    vi.mocked(ark.send).mockImplementationOnce(async (_id, event) => {
      history.push(event as AgentEvent);
      throw new ApiError(502, "Simulated lost response");
    });
    await submit().expect(502);
    const recovered = await submit().expect(200);
    expect(recovered.body.data[0].approval_source).toBe("automatic");
    expect(ark.send).toHaveBeenCalledTimes(1);
  });
  it("does not resend when it was in the sending state before a restart", async () => {
    app.store.data.autoApprovals = {
      [approvalKey("sesn-test", "search")]: {
        state: "sending",
        event: {
          id: "in-flight",
          type: "user.tool_confirmation",
          tool_use_id: "search",
          result: "allow",
        },
      },
    };
    await app.store.save();
    app.close();
    app = await createApp(configFor(), { ark });
    await submit().expect(409);
    expect(ark.send).not.toHaveBeenCalled();
  });
  it("approves only after reading full pages; an abnormal cursor is not submitted", async () => {
    vi.mocked(ark.events).mockImplementation(async (_id, page) =>
      page ? { data: [history[1]] } : { data: [history[0]], next_page: "next" },
    );
    await submit().expect(200);
    expect(ark.events).toHaveBeenCalledWith("sesn-test", "next");
    vi.mocked(ark.send).mockClear();
    vi.mocked(ark.events).mockResolvedValue({ data: [], next_page: "loop" });
    await submit().expect(502);
    expect(ark.send).not.toHaveBeenCalled();
  });
  it("automatic deny requests and cross-site requests are not submitted", async () => {
    await submit("search", { result: "deny" }).expect(400);
    await submit().set("Origin", "https://untrusted.example").expect(403);
    expect(ark.send).not.toHaveBeenCalled();
  });
});

describe("Client auto-approval queue", () => {
  it("sends history backfills and duplicate SSE events only once, and never sends for other tools", async () => {
    const send = vi.fn().mockResolvedValue({ data: [] });
    const approver = new AutoApprover(
      { send },
      "session",
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
    );
    const events = waiting(
      tool(),
      tool("fetch", "web_fetch"),
      tool("mail", "send_email"),
    );
    approver.observe(events);
    approver.observe(events);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    approver.observe(events);
    expect(send.mock.calls.map((call) => call[1].tool_use_id)).toEqual([
      "search",
      "fetch",
    ]);
    expect(send.mock.calls[0][1]).toEqual({
      type: "user.tool_confirmation",
      tool_use_id: "search",
      result: "allow",
      automatic: true,
    });
  });
  it("does not submit early with only tool events; approves after receiving requires_action", async () => {
    const send = vi.fn().mockResolvedValue({ data: [] });
    const approver = new AutoApprover(
      { send },
      "session",
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
    );
    approver.observe([tool()]);
    expect(send).not.toHaveBeenCalled();
    approver.observe(waiting(tool()));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });
  it("falls back to the manual entry after failure without retrying on repeated observations", async () => {
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    const fail = vi.fn();
    const approver = new AutoApprover(
      { send },
      "session",
      new AbortController().signal,
      vi.fn(),
      fail,
    );
    approver.observe(waiting(tool()));
    await vi.waitFor(() => expect(fail).toHaveBeenCalledWith("search"));
    approver.observe(waiting(tool()));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not start queued items or write old results into the new session after switching sessions", async () => {
    let release!: (value: { data: AgentEvent[] }) => void;
    const send = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const onEvents = vi.fn();
    const abort = new AbortController();
    const approver = new AutoApprover(
      { send },
      "old-session",
      abort.signal,
      onEvents,
      vi.fn(),
    );
    approver.observe(waiting(tool(), tool("fetch", "web_fetch")));
    abort.abort();
    release({ data: [] });
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(onEvents).not.toHaveBeenCalled();
  });
  it("does not submit a stale next item when the tool is no longer pending during the queue wait", async () => {
    let release!: (value: { data: AgentEvent[] }) => void;
    const send = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const approver = new AutoApprover(
      { send },
      "session",
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
    );
    approver.observe(waiting(tool(), tool("fetch", "web_fetch")));
    approver.observe([{ id: "stop", type: "user.interrupt" }]);
    release({ data: [] });
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
