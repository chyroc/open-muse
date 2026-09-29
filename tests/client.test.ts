import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, validateEndpoint } from "../src/api";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("手机端 API 客户端", () => {
  function nativeFixture() {
    const temporary = new Map<string, string>();
    const secure = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => temporary.get(key),
      setItem: (key: string, value: string) => temporary.set(key, value),
      removeItem: (key: string) => temporary.delete(key),
    });
    const postMessage = vi.fn(
      async (input: {
        operation: string;
        endpoint: string;
        token?: string;
      }) => {
        if (input.operation === "read") return secure.get(input.endpoint) ?? "";
        if (input.token) secure.set(input.endpoint, input.token);
        else secure.delete(input.endpoint);
        return true;
      },
    );
    vi.stubGlobal("window", {
      webkit: { messageHandlers: { museMobileSession: { postMessage } } },
    });
    return { temporary, secure, postMessage };
  }
  it("iOS 会话从安全存储恢复，并按服务地址隔离", async () => {
    const { temporary, secure, postMessage } = nativeFixture();
    const a = new Client({ baseUrl: "https://a.example", token: "" });
    const b = new Client({ baseUrl: "https://b.example", token: "" });
    await a.setSSOToken("app-session-only");
    expect(secure.get("https://a.example")).toBe("app-session-only");
    temporary.clear();
    await b.restoreSSOToken();
    expect(b.ssoToken()).toBe("");
    await a.restoreSSOToken();
    expect(a.ssoToken()).toBe("app-session-only");
    await a.setSSOToken("");
    temporary.clear();
    await a.restoreSSOToken();
    expect(a.ssoToken()).toBe("");
    expect(postMessage).toHaveBeenCalledWith({
      operation: "write",
      endpoint: "https://a.example",
      token: "app-session-only",
    });
  });
  it("安全存储失败不伪装成登录已保存，也不清除原会话", async () => {
    const { temporary, postMessage } = nativeFixture();
    temporary.set("muse.sso:https://a.example", "previous-session");
    postMessage.mockRejectedValue(new Error("locked"));
    const client = new Client({ baseUrl: "https://a.example", token: "" });
    await expect(client.restoreSSOToken()).rejects.toThrow("安全存储");
    await expect(client.setSSOToken("new-session")).rejects.toThrow("安全存储");
    expect(client.ssoToken()).toBe("previous-session");
  });
  it("安全存储无响应时可以重试，不无限停在启动页", async () => {
    vi.useFakeTimers();
    const { postMessage } = nativeFixture();
    postMessage.mockImplementation(() => new Promise<never>(() => {}));
    const pending = expect(
      new Client({ baseUrl: "https://a.example", token: "" }).restoreSSOToken(),
    ).rejects.toThrow("安全存储");
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
  });
  it("Mac 同源登录仍使用原生桌面会话桥接", async () => {
    nativeFixture();
    const postMessage = vi.fn();
    vi.stubGlobal("window", {
      webkit: { messageHandlers: { museSession: { postMessage } } },
    });
    vi.stubGlobal("location", { origin: "http://127.0.0.1:4311" });
    await new Client({ baseUrl: "", token: "" }).setSSOToken("desktop-session");
    expect(postMessage).toHaveBeenCalledWith("desktop-session");
  });
  it("工作空间就绪后不重复发起准备请求", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ state: "ready", message: "ready" }));
    vi.stubGlobal("fetch", fetcher);
    await new Client({
      baseUrl: "https://muse.example",
      token: "",
    }).prepareWorkspace();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://muse.example/api/workspace");
  });
  it("自动准备只传递动作，不要求客户端传入 Agent 或环境标识", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ state: "idle", message: "idle" }))
      .mockResolvedValueOnce(
        Response.json({ state: "ready", message: "ready" }),
      );
    vi.stubGlobal("fetch", fetcher);
    await new Client({
      baseUrl: "https://muse.example",
      token: "",
    }).prepareWorkspace();
    expect(fetcher.mock.calls[1][1].body).toBe("{}");
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://muse.example/api/workspace/prepare",
    );
  });
  it("SSO 令牌按服务地址隔离，不放入 URL", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal("location", { origin: "https://local.example" });
    const a = new Client({ baseUrl: "https://a.example", token: "" });
    const b = new Client({ baseUrl: "https://b.example", token: "" });
    await a.setSSOToken("session-secret");
    expect(b.ssoToken()).toBe("");
    const fetcher = vi
      .fn()
      .mockImplementation(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    await a.sessions();
    await b.sessions();
    expect(fetcher.mock.calls[0][1].headers["X-Muse-Session"]).toBe(
      "session-secret",
    );
    expect(fetcher.mock.calls[1][1].headers["X-Muse-Session"]).toBeUndefined();
    expect(fetcher.mock.calls[0][0]).not.toContain("session-secret");
    await a.setSSOToken("");
    expect(a.ssoToken()).toBe("");
  });
  it("只允许 HTTPS 远程地址和本机开发地址", () => {
    expect(validateEndpoint("")).toBe("");
    expect(validateEndpoint("https://muse.example/")).toBe(
      "https://muse.example",
    );
    expect(validateEndpoint("http://127.0.0.1:4311")).toBe(
      "http://127.0.0.1:4311",
    );
    for (const url of [
      "http://remote.example",
      "https://muse.example/api",
      "https://user:pass@muse.example",
      "https://muse.example?token=secret",
    ])
      expect(() => validateEndpoint(url)).toThrow();
  });
  it("分页收集历史，令牌只在 Header 中", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "1", type: "user.message" }],
          next_page: "opaque+/=",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "2", type: "agent.message" }] }),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = await new Client({
      baseUrl: "https://muse.example",
      token: "private",
    }).events("session");
    expect(result).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toContain("page=opaque%2B%2F%3D");
    expect(fetcher.mock.calls[0][0]).not.toContain("private");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer private",
    );
  });
  it("发现重复分页游标时结束，而不是无限请求", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () =>
          Response.json({ data: [], next_page: "same" }),
        ),
    );
    await expect(
      new Client({ baseUrl: "", token: "" }).events("session"),
    ).rejects.toThrow("分页异常");
  });
  it("有外部取消信号时，仍保留超时保护", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    const client = new Client({ baseUrl: "", token: "" });
    const request = expect(
      client.session("session", new AbortController().signal),
    ).rejects.toThrow("请求超时");
    await vi.advanceTimersByTimeAsync(35000);
    await request;
  });
});
