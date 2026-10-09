import type { AgentEvent, Category, Page, Session } from "../shared/types";
import { boundedSignal } from "./abort";
import { arkProvider, type MAProvider } from "./ma-provider";
import {
  arkProblem,
  arkProblemText,
  refusedModel,
  type ArkProblem,
} from "./ark-problem";
export interface ArkConfig {
  // Base URL of the MA API, normally `provider.baseUrl`.
  arkBaseUrl: string;
  arkKey: string;
  project: string;
  agentId?: string;
  environmentId?: string;
  // The Managed Agents backend; Volcano Ark when omitted.
  provider?: MAProvider;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // The backend's own error code, when it gave one.
    public code?: string,
    // Why the model service refused, and the model it named, when known.
    public problem?: ArkProblem,
    public model?: string,
  ) {
    super(message);
  }
}

// A client for the configured Managed Agents backend, named after the default.
export class ArkClient {
  private provider: MAProvider;
  constructor(
    private config: ArkConfig,
    private fetcher: typeof fetch = fetch,
    private lifecycle?: AbortSignal,
  ) {
    this.provider = config.provider ?? arkProvider;
  }
  private headers(path: string, init?: HeadersInit) {
    const headers = new Headers(init);
    for (const [name, value] of Object.entries(
      this.provider.headers(
        { apiKey: this.config.arkKey, project: this.config.project },
        path,
      ),
    ))
      headers.set(name, value);
    return headers;
  }
  // Requests end after 30 seconds unless the caller allows longer.
  async request<T>(
    path: string,
    { timeout = 30_000, ...init }: RequestInit & { timeout?: number } = {},
  ): Promise<T> {
    const headers = this.headers(path, init.headers);
    if (!(init.body instanceof FormData) && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    const bound = boundedSignal([init.signal, this.lifecycle], timeout);
    try {
      const response = await this.fetcher(`${this.config.arkBaseUrl}${path}`, {
        ...init,
        signal: bound.signal,
        redirect: "error",
        headers,
      }).catch((error: unknown) => {
        // A request with no answer names which one it was, without IDs, so
        // a report shows where it stopped.
        if (
          error instanceof Error &&
          ["TimeoutError", "NetworkError"].includes(error.name)
        )
          error.message = `${error.message} (${requestLabel(init.method, path)})`;
        throw error;
      });
      if (!response.ok) {
        const diagnostic = await errorDiagnostic(
          response,
          this.config.arkKey,
          this.provider.requestIdHeader,
        );
        // What to do about it first; the status, code, and request ID
        // follow for anyone reporting the problem.
        const problem = arkProblem(
          response.status,
          diagnostic.code,
          diagnostic.message,
        );
        const named =
          problem === "model_unavailable"
            ? refusedModel(diagnostic.message)
            : undefined;
        const model = named === this.config.arkKey ? undefined : named;
        throw new ApiError(
          [400, 401, 403, 404, 409, 413, 429].includes(response.status)
            ? response.status
            : 502,
          `${arkProblemText(problem, { service: this.provider.name, model })} (HTTP ${response.status}${diagnostic.text ? `; ${diagnostic.text}` : ""})`,
          diagnostic.code,
          problem,
          model,
        );
      }
      if (response.status === 204) return { ok: true } as T;
      return (await response.json()) as T;
    } finally {
      bound.dispose();
    }
  }
  async create(
    title: string,
    category: Category,
    selection?: {
      agent: string;
      environment_id: string;
      memory_store_id?: string;
      system?: string;
      agent_version?: number;
      // Secure storage this conversation may use; attached only at creation.
      vault_ids?: string[];
      // The person's chosen model and thinking level for this conversation.
      model?: { id: string; reasoning_effort: string };
    },
  ): Promise<Session> {
    // Choosing a model per conversation is an Ark capability.
    if (selection?.model && !this.provider.modelChoice)
      selection = { ...selection, model: undefined };
    if (
      !(selection?.agent ?? this.config.agentId) ||
      !(selection?.environment_id ?? this.config.environmentId)
    )
      throw new ApiError(
        409,
        "Your personal workspace is not ready yet; continue preparing it in Settings.",
      );
    const session = await this.request<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify({
        agent:
          selection?.system !== undefined || selection?.model
            ? {
                type: "agent_with_overrides",
                id: selection.agent,
                ...(selection.system !== undefined
                  ? { system: selection.system }
                  : {}),
                ...(selection.model ? { model: selection.model } : {}),
                ...(selection.agent_version !== undefined
                  ? { version: selection.agent_version }
                  : {}),
              }
            : (selection?.agent ?? this.config.agentId),
        environment_id: selection?.environment_id ?? this.config.environmentId,
        title,
        ...(selection?.vault_ids?.length
          ? { vault_ids: selection.vault_ids }
          : {}),
        ...(selection?.memory_store_id
          ? {
              resources: [
                {
                  type: "memory_store",
                  memory_store_id: selection.memory_store_id,
                },
              ],
            }
          : {}),
      }),
    });
    if (!session.id)
      throw new ApiError(
        502,
        `${this.provider.name} did not return a session ID.`,
      );
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
    const path = `/sessions/${encodeURIComponent(id)}/events/stream`;
    return this.fetcher(`${this.config.arkBaseUrl}${path}`, {
      signal,
      redirect: "error",
      headers: this.headers(path, { Accept: "text/event-stream" }),
    });
  }
}

// Return only structured diagnostics and known validation categories, never raw error text that may contain credentials or user input.
// "GET /sessions/:id/events", from a request path with its IDs and query
// left out.
export function requestLabel(method = "GET", path: string) {
  const route = path
    .split("?")[0]
    .split("/")
    .map((part) => (/\d/.test(part) ? ":id" : part))
    .join("/");
  return `${method.toUpperCase()} ${route}`;
}

async function errorDiagnostic(
  response: Response,
  secret: string,
  requestIdHeader: string,
) {
  const parts: string[] = [];
  let errorCode: string | undefined;
  // The backend's message, kept only to tell why it refused; never shown.
  let upstream = "";
  const result = () => ({
    text: parts.join("; "),
    code: errorCode,
    message: upstream,
  });
  const requestId = response.headers.get(requestIdHeader);
  if (
    requestId &&
    /^[a-zA-Z0-9_-]{8,100}$/.test(requestId) &&
    requestId !== secret
  )
    parts.push(`Request ID ${requestId}`);
  const reader = response.body?.getReader();
  if (!reader) return result();
  try {
    let raw = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65_536) return result();
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    const envelope = JSON.parse(raw);
    const error = envelope?.error ?? envelope;
    const code = error?.code;
    if (
      typeof code === "string" &&
      /^[A-Za-z][A-Za-z0-9_.-]{0,90}$/.test(code) &&
      code !== secret
    )
      errorCode = code;
    if (
      typeof code === "string" &&
      /^(Invalid|Missing|Unsupported|AccessDenied|Forbidden|Authentication|Permission|Resource|Quota|RateLimit|Internal|Service|BadRequest|NotFound)[a-zA-Z0-9_.-]{0,90}$/.test(
        code,
      ) &&
      code !== secret
    )
      parts.unshift(code);
    const message = typeof error?.message === "string" ? error.message : "";
    upstream = message.slice(0, 2000);
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
    if (field) parts.push(`Field ${field}`);
    const expected = message.match(/must be (?:one of )?(.+)/i)?.[1];
    if (expected) {
      const values = [
        "unrestricted",
        "restricted",
        "limited",
        "cloud",
        "self_hosted",
      ].filter((value) => new RegExp(`\\b${value}\\b`).test(expected));
      if (values.length) parts.push(`Allowed values ${values.join(" / ")}`);
    }
    for (const [pattern, label] of [
      [/not supported|unsupported/i, "Unsupported configuration"],
      [/missing|required/i, "Missing required parameter"],
      [/length|too long|too short/i, "Length constraint violated"],
      [/already exists|duplicate/i, "Resource name already exists"],
      [/must match|pattern|regexp/i, "Format constraint violated"],
      [/must be|one of|invalid/i, "Parameter value failed validation"],
    ] as const) {
      if (pattern.test(message)) {
        parts.push(label);
        break;
      }
    }
  } catch {
    /* For non-JSON or interrupted responses, keep the HTTP status and request ID. */
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return result();
}
