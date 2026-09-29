import type { AgentEvent, Category, Page, Session } from "../shared/types";
import type { ServerConfig } from "./config";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ArkClient {
  constructor(
    private config: ServerConfig,
    private fetcher: typeof fetch = fetch,
  ) {}
  private headers(init?: HeadersInit) {
    const headers = new Headers(init);
    headers.set("Authorization", `Bearer ${this.config.arkKey}`);
    if (this.config.project) headers.set("X-Project-Name", this.config.project);
    return headers;
  }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = this.headers(init.headers);
    if (!(init.body instanceof FormData) && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    const response = await this.fetcher(`${this.config.arkBaseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30_000),
      redirect: "error",
      headers,
    });
    if (!response.ok) {
      const diagnostic = await errorDiagnostic(response, this.config.arkKey);
      throw new ApiError(
        [400, 401, 403, 404, 409, 413, 429].includes(response.status)
          ? response.status
          : 502,
        `方舟请求失败（HTTP ${response.status}${diagnostic ? `；${diagnostic}` : ""}）。请检查服务端配置或稍后重试。`,
      );
    }
    if (response.status === 204) return { ok: true } as T;
    return response.json() as Promise<T>;
  }
  async create(
    title: string,
    category: Category,
    selection?: { agent: string; environment_id: string },
  ): Promise<Session> {
    if (
      !(selection?.agent ?? this.config.agentId) ||
      !(selection?.environment_id ?? this.config.environmentId)
    )
      throw new ApiError(409, "个人工作空间尚未就绪，请在设置中继续准备。");
    const session = await this.request<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify({
        agent: selection?.agent ?? this.config.agentId,
        environment_id: selection?.environment_id ?? this.config.environmentId,
        title,
      }),
    });
    if (!session.id) throw new ApiError(502, "方舟未返回会话 ID。");
    return { ...session, category };
  }
  get(id: string) {
    return this.request<Session>(`/sessions/${encodeURIComponent(id)}`);
  }
  send(id: string, event: Partial<AgentEvent>) {
    return this.request<Page<AgentEvent>>(
      `/sessions/${encodeURIComponent(id)}/events`,
      { method: "POST", body: JSON.stringify({ events: [event] }) },
    );
  }
  events(id: string, page?: string) {
    const query = new URLSearchParams({ order: "asc", limit: "200" });
    if (page) query.set("page", page);
    return this.request<Page<AgentEvent>>(
      `/sessions/${encodeURIComponent(id)}/events?${query}`,
    );
  }
  async stream(id: string, signal: AbortSignal) {
    return this.fetcher(
      `${this.config.arkBaseUrl}/sessions/${encodeURIComponent(id)}/events/stream`,
      {
        signal,
        redirect: "error",
        headers: this.headers({
          Accept: "text/event-stream",
        }),
      },
    );
  }
}

// 只回传结构化诊断与已知校验类别，不回传可能包含凭据或用户输入的错误原文。
async function errorDiagnostic(response: Response, secret: string) {
  const parts: string[] = [];
  const requestId = response.headers.get("x-request-id");
  if (
    requestId &&
    /^[a-zA-Z0-9_-]{8,100}$/.test(requestId) &&
    requestId !== secret
  )
    parts.push(`请求 ID ${requestId}`);
  const reader = response.body?.getReader();
  if (!reader) return parts.join("；");
  try {
    let raw = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65_536) return parts.join("；");
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    const envelope = JSON.parse(raw);
    const error = envelope?.error ?? envelope;
    const code = error?.code;
    if (
      typeof code === "string" &&
      /^(Invalid|Missing|Unsupported|AccessDenied|Forbidden|Authentication|Permission|Resource|Quota|RateLimit|Internal|Service|BadRequest|NotFound)[a-zA-Z0-9_.-]{0,90}$/.test(
        code,
      ) &&
      code !== secret
    )
      parts.unshift(code);
    const message = typeof error?.message === "string" ? error.message : "";
    const fields = [
      "config.networking.type",
      "config.networking.allowed_hosts",
      "config.type",
      "networking",
      "metadata",
      "description",
      "name",
      "model",
      "tools",
      "project_name",
    ];
    const field = fields.find(
      (field) => message.includes(field) || error?.param === field,
    );
    if (field) parts.push(`字段 ${field}`);
    const expected = message.match(/must be (?:one of )?(.+)/i)?.[1];
    if (expected) {
      const values = [
        "unrestricted",
        "restricted",
        "limited",
        "cloud",
        "self_hosted",
      ].filter((value) => new RegExp(`\\b${value}\\b`).test(expected));
      if (values.length) parts.push(`允许值 ${values.join(" / ")}`);
    }
    for (const [pattern, label] of [
      [/not supported|unsupported/i, "不支持该配置"],
      [/missing|required/i, "缺少必填参数"],
      [/length|too long|too short/i, "长度不符合要求"],
      [/already exists|duplicate/i, "资源名称重复"],
      [/must match|pattern|regexp/i, "格式不符合要求"],
      [/must be|one of|invalid/i, "参数值未通过校验"],
    ] as const) {
      if (pattern.test(message)) {
        parts.push(label);
        break;
      }
    }
  } catch {
    /* 非 JSON 或中断时保留 HTTP 状态和请求 ID。 */
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return parts.join("；");
}
