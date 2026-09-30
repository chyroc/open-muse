import type {
  AgentEvent,
  AppConfig,
  Category,
  Page,
  Session,
  WorkspaceStatus,
  Goal,
  LibraryItem,
} from "../shared/types";
import { readSSE } from "../shared/sse";

export interface Connection {
  baseUrl: string;
  token: string;
}
export function savedConnection(): Connection {
  return {
    baseUrl: localStorage.getItem("muse.endpoint") ?? "",
    token: sessionStorage.getItem("muse.access") ?? "",
  };
}
export function saveConnection(connection: Connection) {
  localStorage.setItem("muse.endpoint", connection.baseUrl);
  sessionStorage.setItem("muse.access", connection.token);
}
export function validateEndpoint(input: string) {
  if (!input.trim()) return "";
  const url = new URL(input.trim());
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Enter the service root URL, without any path, credentials, or query parameters.",
    );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  ) {
    throw new Error(
      "Remote services must use HTTPS; only local development addresses allow HTTP.",
    );
  }
  return url.origin;
}

function mobileSessionBridge() {
  if (typeof window === "undefined") return undefined;
  return (
    window as unknown as {
      webkit?: {
        messageHandlers?: {
          museMobileSession?: {
            postMessage: (value: {
              operation: "read" | "write";
              endpoint: string;
              token?: string;
            }) => Promise<unknown>;
          };
        };
      };
    }
  ).webkit?.messageHandlers?.museMobileSession;
}

async function nativeSessionRequest(input: {
  operation: "read" | "write";
  endpoint: string;
  token?: string;
}) {
  const bridge = mobileSessionBridge();
  if (!bridge || !input.endpoint) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      bridge.postMessage(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 5000);
      }),
    ]);
  } catch {
    throw new Error(
      "Couldn't access iOS secure storage. Unlock your device and try again; your sign-in state has not been restored or saved.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export class Client {
  constructor(public connection: Connection) {}
  private headers(json = false) {
    const sso = this.ssoToken();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(this.connection.token
        ? { Authorization: `Bearer ${this.connection.token}` }
        : {}),
      ...(sso ? { "X-Muse-Session": sso } : {}),
    };
  }
  private sessionKey() {
    return `muse.sso:${this.connection.baseUrl || location.origin}`;
  }
  ssoToken() {
    return typeof sessionStorage === "undefined"
      ? ""
      : (sessionStorage.getItem(this.sessionKey()) ?? "");
  }
  async restoreSSOToken() {
    const token = await nativeSessionRequest({
      operation: "read",
      endpoint: this.connection.baseUrl,
    });
    if (typeof token === "string") {
      if (token) sessionStorage.setItem(this.sessionKey(), token);
      else sessionStorage.removeItem(this.sessionKey());
    }
  }
  async setSSOToken(token: string) {
    await nativeSessionRequest({
      operation: "write",
      endpoint: this.connection.baseUrl,
      token,
    });
    if (token) sessionStorage.setItem(this.sessionKey(), token);
    else sessionStorage.removeItem(this.sessionKey());
    if (!this.connection.baseUrl && typeof window !== "undefined") {
      const native = window as unknown as {
        webkit?: {
          messageHandlers?: {
            museSession?: { postMessage: (value: string) => void };
          };
        };
      };
      native.webkit?.messageHandlers?.museSession?.postMessage(token);
    }
  }
  auth<T>(path: string, body?: object) {
    return this.request<T>(
      `/auth/${path}`,
      body ? { method: "POST", body: JSON.stringify(body) } : {},
    );
  }
  ma<T = Record<string, unknown>>(operation: string, input: object = {}) {
    return this.request<T>(`/ma/execute/${encodeURIComponent(operation)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const timeout = boundedSignal(init.signal, 35_000);
    let response: Response | undefined;
    try {
      response = await fetch(`${this.connection.baseUrl}/api${path}`, {
        ...init,
        headers: this.headers(Boolean(init.body)),
        signal: timeout.signal,
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new Error(
          "The service returned no valid data. Check the service URL.",
        );
      }
      if (!response.ok)
        throw new Error(
          (data as { error?: string }).error ??
            `Request failed (${response.status}).`,
        );
      return data as T;
    } catch (error) {
      if (init.signal?.aborted) throw error;
      if (timeout.signal.aborted)
        throw new Error(
          "Request timed out. Refresh the history first to confirm whether it went through.",
        );
      if (response) throw error;
      throw new Error(
        "Couldn't reach the service. Check your network and the service URL in Settings.",
      );
    } finally {
      timeout.dispose();
    }
  }
  config() {
    return this.request<AppConfig>("/config");
  }
  goals() {
    return this.request<Page<Goal>>("/goals");
  }
  createGoal(title: string, description: string) {
    return this.request<Goal>("/goals", {
      method: "POST",
      body: JSON.stringify({ title, description }),
    });
  }
  updateGoal(
    id: string,
    input: Partial<
      Pick<Goal, "title" | "description" | "status" | "steps" | "session_id">
    >,
  ) {
    return this.request<Goal>(`/goals/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  library() {
    return this.request<Page<LibraryItem>>("/library");
  }
  saveReply(session_id: string, event_id: string) {
    return this.request<LibraryItem>("/library", {
      method: "POST",
      body: JSON.stringify({ session_id, event_id }),
    });
  }
  async prepareWorkspace() {
    let status = await this.request<WorkspaceStatus>("/workspace");
    if (status.state === "ready" || status.state === "demo") return;
    status = await this.request<WorkspaceStatus>("/workspace/prepare", {
      method: "POST",
      body: "{}",
    });
    const deadline = Date.now() + 180_000;
    while (status.state === "preparing" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await this.request<WorkspaceStatus>("/workspace");
    }
    if (status.state !== "ready")
      throw new Error(
        status.state === "preparing"
          ? "The workspace is still preparing. Check the progress in Settings; no task has been created yet."
          : status.message,
      );
  }
  sessions() {
    return this.request<Page<Session>>("/sessions");
  }
  session(id: string, signal?: AbortSignal) {
    return this.request<Session>(`/sessions/${encodeURIComponent(id)}`, {
      signal,
    });
  }
  create(title: string, category: Category) {
    return this.request<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify({ title, category }),
    });
  }
  send(id: string, body: object, signal?: AbortSignal) {
    return this.request<Page<AgentEvent>>(
      `/sessions/${encodeURIComponent(id)}/events`,
      { method: "POST", body: JSON.stringify(body), signal },
    );
  }
  async events(id: string, signal?: AbortSignal) {
    const data: AgentEvent[] = [];
    const seen = new Set<string>();
    let page = "";
    do {
      const result = await this.request<Page<AgentEvent>>(
        `/sessions/${encodeURIComponent(id)}/events${page ? `?page=${encodeURIComponent(page)}` : ""}`,
        { signal },
      );
      data.push(...result.data);
      page = result.next_page ?? "";
      if (page && (seen.has(page) || seen.size >= 100))
        throw new Error(
          "Something went wrong paging through history. Please try again shortly.",
        );
      seen.add(page);
    } while (page);
    return data;
  }
  async stream(
    id: string,
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void,
    onConnected: () => void,
  ) {
    const timeout = boundedSignal(signal, 75_000);
    try {
      const response = await fetch(
        `${this.connection.baseUrl}/api/sessions/${encodeURIComponent(id)}/events/stream`,
        { signal: timeout.signal, headers: this.headers() },
      );
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get("content-type")?.includes("text/event-stream")
      )
        throw new Error("The event stream is temporarily disconnected");
      onConnected();
      for await (const data of readSSE(response.body)) {
        if (data === "[DONE]") return;
        const event = JSON.parse(data) as AgentEvent;
        if (event.id && event.type) onEvent(event);
      }
    } finally {
      timeout.dispose();
    }
  }
}

// iOS 15 WebView cannot rely on the newer AbortSignal.timeout / any.
function boundedSignal(
  parent: AbortSignal | null | undefined,
  milliseconds: number,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, milliseconds);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
