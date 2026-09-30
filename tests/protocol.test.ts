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
describe("SSE protocol", () => {
  it("decodes Chinese split across bytes, multi-line data, CRLF, and heartbeats", async () => {
    // Chinese payload is intentionally kept to verify multi-byte UTF-8 decoding across chunks.
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
  it("drops incomplete frames on disconnect so history backfill can recover them", async () => {
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
  it("limits abnormal frame length", async () => {
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
describe("Event state", () => {
  it("deduplicates by event id and merges history with live events by time", () => {
    const first = event("a", "user.message");
    const last = event("bb", "agent.message");
    expect(mergeEvents([last], [first, last])).toEqual([first, last]);
  });
  it("a model message does not mean the task is complete", () => {
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
  ])("correctly interprets stop_reason %s", (reason, state) => {
    expect(
      taskState([
        event("a", "session.status_idle", { stop_reason: { type: reason } }),
      ]),
    ).toBe(state);
  });
  it("does not show completed after stopping and clears the stopped state on rerun", () => {
    const stopped = [
      event("a", "user.interrupt"),
      event("bb", "session.status_idle", { stop_reason: { type: "end_turn" } }),
    ];
    expect(taskState(stopped)).toBe("stopped");
    expect(
      taskState([...stopped, event("ccc", "session.status_running")]),
    ).toBe("running");
  });
  it("approval matches only the current stop_reason, excluding confirmed and stale requests", () => {
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
describe("Server configuration", () => {
  it("defaults to local demo and never implicitly switches to real mode just because credentials exist", () => {
    expect(loadConfig({ ARK_API_KEY: "secret" }).mode).toBe("demo");
    expect(loadConfig({}).host).toBe("127.0.0.1");
    expect(loadConfig({}).arkBaseUrl).toBe(
      "https://ark.cn-beijing.volces.com/api/v3",
    );
  });
  it("refuses to start in real mode without credentials", () =>
    expect(() => loadConfig({ MUSE_MODE: "ark" })).toThrow("requires"));
  it("listening on a public interface requires a sufficiently long app access token", () =>
    expect(() => loadConfig({ HOST: "0.0.0.0" })).toThrow("MUSE_ACCESS_TOKEN"));
  it("forces HTTPS for the upstream URL", () =>
    expect(() => loadConfig({ ARK_BASE_URL: "http://insecure.test" })).toThrow(
      "HTTPS",
    ));
});
describe("Ark contract", () => {
  it("correctly creates a session, submits a user.message, pages events, and never exposes the key", async () => {
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
    await ark.create("Task", "general");
    await ark.send("sesn-test", {
      type: "user.message",
      content: [{ type: "text", text: "Hello" }],
    });
    await ark.events("sesn-test", "page+/=2");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      agent: "agt-test",
      environment_id: "env-test",
      title: "Task",
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
  it("does not forward raw sensitive upstream errors", async () => {
    const ark = new ArkClient(
      loadConfig({}),
      async () => new Response("private-token", { status: 403 }),
    );
    await expect(ark.get("id")).rejects.toThrow("HTTP 403");
    await expect(ark.get("id")).rejects.not.toThrow("private-token");
  });
  it("keeps extra headers from Headers instances while credentials and project stay fixed server-side", async () => {
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
  it("oversized or non-structured errors still return the HTTP status and never leak the response body", async () => {
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
  it("parses the upstream error envelope and keeps only safe diagnostics", async () => {
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
        "Field config.networking.type",
      );
      await expect(ark.get("id")).rejects.toThrow(
        "Allowed values unrestricted",
      );
      await expect(ark.get("id")).rejects.toThrow(
        "Request ID 20260929-request-test",
      );
      await expect(ark.get("id")).rejects.not.toThrow("private-token");
      await expect(ark.get("id")).rejects.not.toThrow("another-secret");
    }
  });
});
