import { describe, expect, it } from "vitest";
import { readSSE } from "../shared/sse";
import {
  mergeEvents,
  pendingPermissions,
  taskState,
  type AgentEvent,
} from "../shared/types";
import { loadConfig } from "../server/config";
import { ArkClient } from "../server/ark";

function event(
  id: string,
  type: string,
  extra: Partial<AgentEvent> = {},
): AgentEvent {
  return {
    id,
    type,
    processed_at: `2026-09-29T10:00:0${id.length}Z`,
    ...extra,
  };
}
describe("SSE 协议", () => {
  it("解码跨字节的中文、多行 data、CRLF 和心跳", async () => {
    const bytes = new TextEncoder().encode(
      ': heartbeat\r\n\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\ndata: [DONE]\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const result = [];
    for await (const data of readSSE(stream)) result.push(data);
    expect(result).toEqual(['{"text":\n"你好"}', "[DONE]"]);
  });
  it("丢弃断线时不完整的帧，留待历史补拉", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"id":'));
        controller.close();
      },
    });
    const result = [];
    for await (const data of readSSE(stream)) result.push(data);
    expect(result).toEqual([]);
  });
  it("限制异常帧长度", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(2_000_001)));
        controller.close();
      },
    });
    await expect(async () => {
      for await (const _data of readSSE(stream)) {
        /* consume */
      }
    }).rejects.toThrow("size limit");
  });
});
describe("事件状态", () => {
  it("按事件 ID 去重并按时间合并历史和实时事件", () => {
    const first = event("a", "user.message");
    const last = event("bb", "agent.message");
    expect(mergeEvents([last], [first, last])).toEqual([first, last]);
  });
  it("模型消息不代表任务完成", () => {
    expect(
      taskState([
        event("a", "session.status_running"),
        event("bb", "agent.message"),
      ]),
    ).toBe("running");
  });
  it.each([
    ["requires_action", "attention"],
    ["retries_exhausted", "error"],
    ["end_turn", "complete"],
  ])("正确解释 stop_reason %s", (reason, state) => {
    expect(
      taskState([
        event("a", "session.status_idle", { stop_reason: { type: reason } }),
      ]),
    ).toBe(state);
  });
  it("停止后不显示已完成，重新运行时清除停止状态", () => {
    const stopped = [
      event("a", "user.interrupt"),
      event("bb", "session.status_idle", { stop_reason: { type: "end_turn" } }),
    ];
    expect(taskState(stopped)).toBe("stopped");
    expect(
      taskState([...stopped, event("ccc", "session.status_running")]),
    ).toBe("running");
  });
  it("批准只匹配当前 stop_reason，并排除已确认和过期请求", () => {
    const tool = event("tool", "agent.tool_use", {
      name: "send_email",
      evaluated_permission: "ask",
    });
    const events = [
      tool,
      event("idle", "session.status_idle", {
        stop_reason: { type: "requires_action", event_ids: ["tool"] },
      }),
    ];
    expect(pendingPermissions(events)).toEqual([tool]);
    expect(
      pendingPermissions([
        ...events,
        event("confirm", "user.tool_confirmation", {
          tool_use_id: "tool",
          result: "deny",
        }),
      ]),
    ).toEqual([]);
    expect(
      pendingPermissions([...events, event("run", "session.status_running")]),
    ).toEqual([]);
  });
});
describe("服务端配置", () => {
  it("默认本地演示，不因存在凭据而隐式切换真实模式", () => {
    expect(loadConfig({ ARK_API_KEY: "secret" }).mode).toBe("demo");
    expect(loadConfig({}).host).toBe("127.0.0.1");
    expect(loadConfig({}).arkBaseUrl).toBe(
      "https://ark.cn-beijing.volces.com/api/v3",
    );
  });
  it("真实模式缺凭据时拒绝启动", () =>
    expect(() => loadConfig({ MUSE_MODE: "ark" })).toThrow("requires"));
  it("外网监听必须有足够长的应用访问令牌", () =>
    expect(() => loadConfig({ HOST: "0.0.0.0" })).toThrow("MUSE_ACCESS_TOKEN"));
  it("上游地址强制 HTTPS", () =>
    expect(() => loadConfig({ ARK_BASE_URL: "http://insecure.test" })).toThrow(
      "HTTPS",
    ));
});
describe("方舟契约", () => {
  it("正确创建 Session、提交 user.message、分页拉事件，不暴露密钥", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const config = loadConfig({
      MUSE_MODE: "ark",
      ARK_API_KEY: "server-only-secret",
      ARK_AGENT_ID: "agt-test",
      ARK_ENVIRONMENT_ID: "env-test",
      ARK_PROJECT_NAME: "project-a",
    });
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return Response.json({ id: "sesn-test", data: [] });
    };
    const ark = new ArkClient(config, fetcher);
    await ark.create("任务", "general");
    await ark.send("sesn-test", {
      type: "user.message",
      content: [{ type: "text", text: "你好" }],
    });
    await ark.events("sesn-test", "page+/=2");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      agent: "agt-test",
      environment_id: "env-test",
      title: "任务",
    });
    expect(JSON.parse(calls[1].init.body as string).events[0].type).toBe(
      "user.message",
    );
    expect(new URL(calls[2].url).searchParams.get("page")).toBe("page+/=2");
    expect(new URL(calls[2].url).searchParams.get("order")).toBe("asc");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe(
      "Bearer server-only-secret",
    );
    expect(new Headers(calls[0].init.headers).get("X-Project-Name")).toBe(
      "project-a",
    );
    await ark.stream("sesn-test", new AbortController().signal);
    expect(new Headers(calls[3].init.headers).get("X-Project-Name")).toBe(
      "project-a",
    );
  });
  it("不转发上游敏感错误原文", async () => {
    const ark = new ArkClient(
      loadConfig({}),
      async () => new Response("private-token", { status: 403 }),
    );
    await expect(ark.get("id")).rejects.toThrow("HTTP 403");
    await expect(ark.get("id")).rejects.not.toThrow("private-token");
  });
  it("保留 Headers 实例的额外请求头，凭据和项目由服务端固定", async () => {
    const calls: RequestInit[] = [];
    const ark = new ArkClient(
      loadConfig({
        ARK_API_KEY: "secret",
        ARK_PROJECT_NAME: "selected-project",
      }),
      async (_url, init) => {
        calls.push(init!);
        return Response.json({});
      },
    );
    await ark.request("/files/file-1", {
      headers: new Headers({
        "X-Ark-PreSignedURL-ExpiresAfter": "86400",
        Authorization: "forged",
        "X-Project-Name": "forged",
      }),
    });
    const headers = new Headers(calls[0].headers);
    expect(headers.get("X-Ark-PreSignedURL-ExpiresAfter")).toBe("86400");
    expect(headers.get("Authorization")).toBe("Bearer secret");
    expect(headers.get("X-Project-Name")).toBe("selected-project");
  });
  it("超长或非结构化错误仍返回 HTTP 状态，不泄露响应内容", async () => {
    for (const body of [
      "private-token",
      JSON.stringify({ error: { message: "private-token".repeat(6000) } }),
      JSON.stringify({
        error: {
          code: "private-token",
          message: "private-token",
          param: "private-token",
        },
      }),
    ]) {
      const ark = new ArkClient(
        loadConfig({}),
        async () => new Response(body, { status: 400 }),
      );
      await expect(ark.get("id")).rejects.toThrow("HTTP 400");
      await expect(ark.get("id")).rejects.not.toThrow("private-token");
    }
  });
  it("解析上游错误信封，只保留安全诊断", async () => {
    for (const wrap of [
      (error: object) => ({ error }),
      (error: object) => error,
    ]) {
      const ark = new ArkClient(
        loadConfig({ ARK_API_KEY: "private-token" }),
        async () =>
          Response.json(
            wrap({
              code: "InvalidParameter",
              message:
                'config.networking.type: must be "unrestricted"; private-token',
              token: "another-secret",
            }),
            {
              status: 400,
              headers: { "X-Request-Id": "20260929-request-test" },
            },
          ),
      );
      await expect(ark.get("id")).rejects.toThrow("InvalidParameter");
      await expect(ark.get("id")).rejects.toThrow(
        "字段 config.networking.type",
      );
      await expect(ark.get("id")).rejects.toThrow("允许值 unrestricted");
      await expect(ark.get("id")).rejects.toThrow(
        "请求 ID 20260929-request-test",
      );
      await expect(ark.get("id")).rejects.not.toThrow("private-token");
      await expect(ark.get("id")).rejects.not.toThrow("another-secret");
    }
  });
});
