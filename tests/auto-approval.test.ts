import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { ArkClient, ApiError } from "../server/ark";
import { loadConfig } from "../server/config";
import { approvalKey } from "../server/approvals";
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

describe("自动批准白名单", () => {
  it.each(["web_search", "web_fetch"])("允许内置 %s", (name) => {
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
  ])("拒绝越界的 $type / $name / $evaluated_permission", (event) => {
    expect(canAutoApprove(event)).toBe(false);
  });
});

describe("自动批准服务端", () => {
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
      title: "自动批准测试",
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
    "批准 %s，保留线程且不上传本地标记",
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
  ])("客户端伪造名称不能自动批准 $name / $type", async (event) => {
    history = waiting(event);
    await submit("search", {
      name: "web_search",
      evaluated_permission: "ask",
    }).expect(403);
    expect(ark.send).not.toHaveBeenCalled();
  });
  it("未进入 requires_action、已恢复运行和已中断时不批准", async () => {
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
  it("只读历史不会触发批准，不存在会话拒绝访问", async () => {
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
  it("逐项批准网页工具，混合队列里的其他工具保持待确认", async () => {
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
    "已有 %s 确认时只返回历史，不重复发送",
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
  it("并发自动/手动提交共享锁，只有一个请求发送到上游", async () => {
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
  it("成功记录持久化：重启且历史滞后时也不重复批准", async () => {
    const accepted = await submit().expect(200);
    history = waiting(tool());
    app.close();
    app = await createApp(configFor(), { ark });
    const replay = await submit().expect(200);
    expect(replay.body).toEqual(accepted.body);
    expect(ark.send).toHaveBeenCalledTimes(1);
  });
  it("兼容只返回受理信封的上游，不把已受理误报为失败", async () => {
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
  it("失败后刷新与重启不盲目重试，仍可显式手动处理", async () => {
    vi.mocked(ark.send).mockRejectedValueOnce(new ApiError(502, "模拟失败"));
    await submit().expect(502);
    await submit().expect(409);
    app.close();
    app = await createApp(configFor(), { ark });
    await submit().expect(409);
    expect(ark.send).toHaveBeenCalledTimes(1);
    await submit("search", { automatic: undefined }).expect(200);
    expect(ark.send).toHaveBeenCalledTimes(2);
  });
  it("上游接收后响应丢失：先核对历史，不重复提交", async () => {
    vi.mocked(ark.send).mockImplementationOnce(async (_id, event) => {
      history.push(event as AgentEvent);
      throw new ApiError(502, "模拟响应丢失");
    });
    await submit().expect(502);
    const recovered = await submit().expect(200);
    expect(recovered.body.data[0].approval_source).toBe("automatic");
    expect(ark.send).toHaveBeenCalledTimes(1);
  });
  it("重启前停在 sending 状态时不重发", async () => {
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
  it("读取完整分页后才批准，异常游标不提交", async () => {
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
  it("自动拒绝请求与跨站请求不提交", async () => {
    await submit("search", { result: "deny" }).expect(400);
    await submit().set("Origin", "https://untrusted.example").expect(403);
    expect(ark.send).not.toHaveBeenCalled();
  });
});

describe("客户端自动批准队列", () => {
  it("历史补拉和 SSE 重复事件只发送一次，其他工具不发送", async () => {
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
  it("只有工具事件时不提前提交，收到 requires_action 后才批准", async () => {
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
  it("失败后回退手动入口，不因反复观察而重试", async () => {
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
  it("切换会话后不启动排队项，也不将旧结果写入新会话", async () => {
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
  it("排队期间工具不再待确认，则不提交过期的下一项", async () => {
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
