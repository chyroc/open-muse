import { z } from "zod";
import { ArkClient, ApiError } from "../shared/ark";
import { digest, uuid } from "../shared/crypto";
import { readSSE } from "../shared/sse";
import { boundedSignal } from "../shared/abort";
import { canAutoApprove } from "../shared/approval-policy";
import {
  eventText,
  pendingPermissions,
  type AgentEvent,
  type AppConfig,
  type Category,
  type Goal,
  type LibraryItem,
  type Page,
  type Session,
  type WorkspaceStatus,
} from "../shared/types";
import { DirectAuth } from "./direct/auth";
import { LocalDatabase, type CredentialStore } from "./direct/storage";
import { ARK_BASE_URL, directFetch } from "./direct/transport";
import { DirectWorkspace } from "./direct/workspace";
import { executeOperation } from "./direct/operations";

const titleInput = z.string().trim().min(1).max(160);
const messageInput = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("user.message"),
      text: z.string().trim().min(1).max(16000),
    })
    .strict(),
  z.object({ type: z.literal("user.interrupt") }).strict(),
  z
    .object({
      type: z.literal("user.tool_confirmation"),
      tool_use_id: z.string().min(1).max(200),
      result: z.enum(["allow", "deny"]),
      automatic: z.literal(true).optional(),
    })
    .strict(),
]);
type Approval = {
  state: "sending" | "failed" | "confirmed";
  event: AgentEvent;
};
type Runtime = {
  key: string;
  ark: ArkClient;
  workspace: DirectWorkspace;
  abort: AbortController;
};
const validId = (id: string) => {
  if (!/^[\w-]{1,200}$/.test(id))
    throw new ApiError(400, "Invalid resource ID.");
  return encodeURIComponent(id);
};

// This client is the application runtime on every platform. Its only network
// dependencies are public Volcano APIs; goals, saved replies and mappings are local.
export class Client {
  readonly identity: DirectAuth;
  private db: LocalDatabase;
  private fetcher: typeof fetch;
  private runtime?: Runtime;
  private sends = new Set<string>();
  constructor(
    options: {
      vault?: CredentialStore;
      database?: LocalDatabase;
      fetcher?: typeof fetch;
    } = {},
  ) {
    this.db = options.database ?? new LocalDatabase();
    this.fetcher = options.fetcher ?? directFetch;
    this.identity = new DirectAuth(options.vault, this.fetcher);
  }
  restore() {
    return this.identity.restore();
  }
  signedIn() {
    return Boolean(this.identity.value);
  }
  async auth<T = unknown>(path: string, body?: object): Promise<T> {
    let result: unknown;
    try {
      result = await this.identity.execute(path, body);
    } catch (error) {
      if (error instanceof z.ZodError)
        throw new ApiError(
          400,
          "Check the API key, project name, and authorization code format.",
        );
      throw error;
    }
    if (path === "logout") {
      this.runtime?.abort.abort();
      this.runtime?.workspace.cancel();
      this.runtime = undefined;
    }
    return result as T;
  }
  private context() {
    const c = this.identity.value;
    if (!c?.apiKey)
      throw new ApiError(
        401,
        "Connect to Ark MA with SSO or an API key in Settings first.",
      );
    const key = digest(
      JSON.stringify([ARK_BASE_URL, c.apiKey, c.project ?? ""]),
    );
    if (this.runtime?.key !== key) {
      this.runtime?.abort.abort();
      this.runtime?.workspace.cancel();
      const abort = new AbortController();
      const ark = new ArkClient(
        {
          arkBaseUrl: ARK_BASE_URL,
          arkKey: c.apiKey,
          project: c.project ?? "",
        },
        this.fetcher,
        abort.signal,
      );
      this.runtime = {
        key,
        ark,
        abort,
        workspace: new DirectWorkspace(key, ark, this.db),
      };
    }
    return this.runtime;
  }
  async config(): Promise<AppConfig> {
    return {
      mode: this.identity.value?.apiKey ? "ark" : "disconnected",
      authRequired: false,
      agentConfigured: (await this.workspaceStatus()).state === "ready",
    };
  }
  async workspaceStatus(): Promise<WorkspaceStatus> {
    if (!this.identity.value?.apiKey)
      return {
        state: "disconnected",
        message:
          "Sign in and connect an Ark project to prepare your workspace.",
      };
    return this.context().workspace.status();
  }
  startWorkspace() {
    return this.context().workspace.start();
  }
  async prepareWorkspace() {
    const { workspace } = this.context();
    if ((await workspace.status()).state === "ready") return;
    await workspace.start();
    await workspace.wait();
  }
  private async collect<T>(
    ark: ArkClient,
    path: string,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const data: T[] = [];
    const seen = new Set<string>();
    let page = "";
    do {
      const result = await ark.request<Page<T>>(
        `${path}${page ? `&page=${encodeURIComponent(page)}` : ""}`,
        { signal },
      );
      if (!Array.isArray(result.data))
        throw new ApiError(502, "Ark returned an invalid list response.");
      data.push(...result.data);
      page = result.next_page ?? "";
      if (page && (seen.has(page) || seen.size >= 100))
        throw new ApiError(
          502,
          "History pagination repeated or exceeded the safety limit. No writes were retried.",
        );
      seen.add(page);
    } while (page);
    return data;
  }
  private async remember(runtime: Runtime, rows: Session[]) {
    const saved = await this.db.update<Record<string, Session>>(
      `${runtime.key}:sessions`,
      (existing) => {
        const result = existing ?? {};
        for (const row of rows)
          if (row.id)
            result[row.id] = {
              ...row,
              title: row.title || "Untitled task",
              category: row.category ?? result[row.id]?.category ?? "general",
            };
        return result;
      },
    );
    return rows.map((row) => saved[row.id]);
  }
  async sessions(): Promise<Page<Session>> {
    if (!this.identity.value?.apiKey) return { data: [] };
    const r = this.context();
    const rows = await this.collect<Session>(
      r.ark,
      "/sessions?limit=100&order=desc",
    );
    return { data: await this.remember(r, rows) };
  }
  async session(id: string, signal?: AbortSignal) {
    const r = this.context();
    const row = await r.ark.request<Session>(`/sessions/${validId(id)}`, {
      signal,
    });
    return (await this.remember(r, [row]))[0];
  }
  async create(title: string, category: Category) {
    const input = z
      .object({
        title: titleInput.max(100),
        category: z.enum(["general", "research", "writing", "life", "code"]),
      })
      .parse({ title, category });
    const r = this.context();
    const selection = await r.workspace.selection();
    await r.workspace.syncPolicy();
    const row = await r.ark.create(input.title, input.category, selection);
    await this.remember(r, [row]);
    return row;
  }
  private approvalKey(r: Runtime, id: string, tool: string) {
    return `${r.key}:approval:${digest(`${id}\0${tool}`)}`;
  }
  private async annotate(
    r: Runtime,
    id: string,
    event: AgentEvent,
  ): Promise<AgentEvent> {
    const { approval_source: _ignored, ...original } = event;
    if (event.type !== "user.tool_confirmation" || !event.tool_use_id)
      return original;
    const record = await this.db.get<Approval>(
      this.approvalKey(r, id, event.tool_use_id),
    );
    return record?.event.id === event.id && event.result === "allow"
      ? { ...original, approval_source: "automatic" }
      : original;
  }
  async events(id: string, signal?: AbortSignal) {
    const r = this.context();
    const rows = await this.collect<AgentEvent>(
      r.ark,
      `/sessions/${validId(id)}/events?order=asc&limit=200`,
      signal,
    );
    return Promise.all(rows.map((event) => this.annotate(r, id, event)));
  }
  async send(
    id: string,
    body: object,
    signal?: AbortSignal,
  ): Promise<Page<AgentEvent>> {
    const input = messageInput.parse(body);
    const r = this.context();
    validId(id);
    const lock = `${r.key}:${id}`;
    if (this.sends.has(lock))
      throw new ApiError(
        409,
        "The previous operation is still being submitted.",
      );
    this.sends.add(lock);
    let autoKey: string | undefined;
    let autoRecord: Approval | undefined;
    try {
      let event: Partial<AgentEvent> = {
        id: `evt-${uuid()}`,
        type: input.type,
      };
      if (input.type === "user.message")
        event.content = [{ type: "text", text: input.text }];
      if (input.type === "user.tool_confirmation") {
        const history = await this.collect<AgentEvent>(
          r.ark,
          `/sessions/${validId(id)}/events?order=asc&limit=200`,
          signal,
        );
        const key = this.approvalKey(r, id, input.tool_use_id);
        const previous = await this.db.get<Approval>(key);
        if (input.automatic) {
          if (input.result !== "allow")
            throw new ApiError(
              400,
              "Automatic confirmation can only allow safe reads.",
            );
          const confirmed = history.find(
            (e) =>
              e.type === "user.tool_confirmation" &&
              e.tool_use_id === input.tool_use_id,
          );
          if (confirmed)
            return { data: [await this.annotate(r, id, confirmed)] };
          if (previous?.state === "confirmed")
            return { data: [await this.annotate(r, id, previous.event)] };
        } else if (previous?.state === "confirmed")
          throw new ApiError(409, "Already auto-approved; refresh history.");
        const tool = pendingPermissions(history).find(
          (e) => e.id === input.tool_use_id,
        );
        if (!tool)
          throw new ApiError(
            409,
            "The tool is no longer pending; refresh history.",
          );
        if (input.automatic && !canAutoApprove(tool))
          throw new ApiError(403, "This tool requires manual approval.");
        event = {
          ...event,
          tool_use_id: tool.id,
          result: input.result,
          session_thread_id: tool.session_thread_id,
        };
        if (input.automatic) {
          autoRecord = {
            state: "sending",
            event: {
              ...event,
              id: event.id!,
              type: event.type!,
              created_at: new Date().toISOString(),
            },
          };
          await this.db.update<Approval>(key, (old) => {
            if (old)
              throw new ApiError(
                409,
                "An auto-approval is unconfirmed. Refresh history and handle it manually.",
              );
            return autoRecord!;
          });
          autoKey = key;
        }
      }
      const result = await r.ark.request<Page<AgentEvent>>(
        `/sessions/${validId(id)}/events`,
        { method: "POST", body: JSON.stringify({ events: [event] }), signal },
      );
      const rows = Array.isArray(result.data) ? result.data : [];
      if (autoKey && autoRecord) {
        autoRecord.state = "confirmed";
        autoRecord.event =
          rows.find(
            (e) =>
              e.type === "user.tool_confirmation" &&
              e.tool_use_id === event.tool_use_id &&
              e.result === "allow",
          ) ?? autoRecord.event;
        await this.db.set(autoKey, autoRecord);
        if (!rows.some((e) => e.id === autoRecord!.event.id))
          rows.push(autoRecord.event);
      }
      return {
        ...result,
        data: await Promise.all(rows.map((e) => this.annotate(r, id, e))),
      };
    } catch (error) {
      if (autoKey && autoRecord && autoRecord.state !== "confirmed")
        await this.db.set(autoKey, { ...autoRecord, state: "failed" });
      throw error;
    } finally {
      this.sends.delete(lock);
    }
  }
  async stream(
    id: string,
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void,
    onConnected: () => void,
  ) {
    const r = this.context();
    const bound = boundedSignal([signal, r.abort.signal], 75_000);
    try {
      const response = await r.ark.stream(validId(id), bound.signal);
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        await response.body?.cancel();
        throw new Error(
          "The Ark event stream is disconnected; history will be refreshed.",
        );
      }
      onConnected();
      for await (const data of readSSE(response.body)) {
        if (data === "[DONE]") return;
        const event = JSON.parse(data) as AgentEvent;
        if (event.id && event.type) onEvent(await this.annotate(r, id, event));
      }
    } finally {
      bound.dispose();
    }
  }
  async goals(): Promise<Page<Goal>> {
    if (!this.identity.value?.apiKey) return { data: [] };
    return {
      data: (
        (await this.db.get<Goal[]>(`${this.context().key}:goals`)) ?? []
      ).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    };
  }
  async createGoal(title: string, description: string) {
    const r = this.context();
    const input = z
      .object({ title: titleInput, description: z.string().trim().max(8000) })
      .parse({ title, description });
    const now = new Date().toISOString();
    const goal: Goal = {
      ...input,
      id: uuid(),
      status: "active",
      steps: [],
      created_at: now,
      updated_at: now,
    };
    await this.db.update<Goal[]>(`${r.key}:goals`, (rows) => [
      goal,
      ...(rows ?? []),
    ]);
    return goal;
  }
  async updateGoal(
    id: string,
    body: Partial<
      Pick<Goal, "title" | "description" | "status" | "steps" | "session_id">
    >,
  ) {
    const r = this.context();
    const input = z
      .object({
        title: titleInput.optional(),
        description: z.string().trim().max(8000).optional(),
        status: z.enum(["active", "paused", "completed"]).optional(),
        session_id: z.string().min(1).max(200).optional(),
        steps: z
          .array(
            z.object({
              id: z.string().min(1).max(80),
              title: titleInput,
              done: z.boolean(),
            }),
          )
          .max(40)
          .optional(),
      })
      .strict()
      .parse(body);
    if (
      input.steps &&
      new Set(input.steps.map((s) => s.id)).size !== input.steps.length
    )
      throw new ApiError(400, "Duplicate step IDs.");
    if (input.session_id) await r.ark.get(validId(input.session_id));
    const rows = await this.db.update<Goal[]>(`${r.key}:goals`, (rows) => {
      const goal = rows?.find((g) => g.id === id);
      if (!goal) throw new ApiError(404, "Goal not found.");
      Object.assign(goal, input, { updated_at: new Date().toISOString() });
      return rows!;
    });
    return rows.find((g) => g.id === id)!;
  }
  async library(): Promise<Page<LibraryItem>> {
    if (!this.identity.value?.apiKey) return { data: [] };
    return {
      data: (
        (await this.db.get<LibraryItem[]>(`${this.context().key}:library`)) ??
        []
      ).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    };
  }
  async saveReply(session_id: string, event_id: string) {
    const r = this.context();
    const session = await r.ark.get(validId(session_id));
    const history = await this.collect<AgentEvent>(
      r.ark,
      `/sessions/${validId(session_id)}/events?order=asc&limit=200`,
    );
    const event = history.find((e) => e.id === event_id);
    if (event?.type !== "agent.message" || !eventText(event).trim())
      throw new ApiError(
        404,
        "No savable assistant reply was found in Ark history.",
      );
    const rows = await this.db.update<LibraryItem[]>(
      `${r.key}:library`,
      (old) => {
        const rows = old ?? [];
        if (
          !rows.some(
            (item) =>
              item.session_id === session_id && item.event_id === event_id,
          )
        )
          rows.unshift({
            id: uuid(),
            title: session.title || "Untitled task",
            text: eventText(event),
            session_id,
            event_id,
            created_at: new Date().toISOString(),
          });
        return rows;
      },
    );
    return rows.find(
      (item) => item.session_id === session_id && item.event_id === event_id,
    )!;
  }
  async ma<T = Record<string, unknown>>(
    operation: string,
    input: object = {},
  ): Promise<T> {
    const r = this.context();
    const result = await executeOperation(
      r.ark,
      this.identity,
      operation,
      input,
    );
    if (["CreateSession", "GetSession", "ListSessions"].includes(operation)) {
      const payload = result as Session & { data?: Session[] };
      await this.remember(r, payload.data ?? [payload]);
    }
    return result as T;
  }
}
