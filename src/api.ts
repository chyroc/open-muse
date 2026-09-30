import { t } from "../shared/i18n";
import { z } from "zod";
import { ArkClient, ApiError } from "../shared/ark";
import { digest, uuid } from "../shared/crypto";
import { accountWorkspaceKey } from "../shared/workspace-key";
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
import { DirectAuth, type AccountProvider } from "./direct/auth";
import { LocalDatabase, type CredentialStore } from "./direct/storage";
import { ARK_BASE_URL, directFetch } from "./direct/transport";
import { DirectWorkspace } from "./direct/workspace";
import { exportBackgroundConfiguration } from "./direct/background-export";
import { DirectIdentity, defaultIdentity } from "./direct/identity";
import { DirectGoals } from "./direct/goals";
import { DirectChoices } from "./direct/choices";
import { DirectWelcome } from "./direct/welcome";
import { DirectLibrary } from "./direct/library";
import { DirectAttachments } from "./direct/attachments";
import {
  attachmentBlocks,
  attachmentInput,
  maxAttachments,
  type Attachment,
} from "../shared/attachments";
import { identityDefaults } from "../shared/identity";
import {
  agentSnapshot,
  canonicalJson,
  continuationAgent,
  IncompatibleConversation,
  needsPromptRefresh,
  refreshedAgentSystem,
  unreadableInstructions,
  type AgentSnapshot,
} from "../shared/session-refresh";
import { goalCategoryInput, type GoalCategory } from "../shared/goals";
import type { IdentityDocumentName } from "../shared/identity";
import { DirectInspiration } from "./direct/inspiration";
import {
  defaultFeedInstructions,
  inspirationPrompt,
  recentInspirationContext,
  type InspirationKind,
  type InspirationSnapshot,
} from "../shared/inspiration";
import {
  conversationArchive,
  withConversationHistory,
} from "../shared/conversation-history";
import { executeOperation } from "./direct/operations";
import { operations } from "../shared/ma";
import {
  Conversations,
  emptyConversations,
  type ConversationKind,
} from "./direct/conversations";

const titleInput = z.string().trim().min(1).max(160);
const messageInput = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("user.message"),
      text: z.string().trim().max(16000),
      attachments: z.array(attachmentInput).max(maxAttachments).optional(),
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
  companion: DirectIdentity;
  goals: DirectGoals;
  choices?: DirectChoices;
  welcome?: DirectWelcome;
  redact: (text: string) => string;
  abort: AbortController;
};
const validId = (id: string) => {
  if (!/^[\w-]{1,200}$/.test(id))
    throw new ApiError(400, t("Invalid resource ID."));
  return encodeURIComponent(id);
};

// This client is the application runtime on every platform. Its only network
// dependencies are public Volcano APIs; saved replies and mappings are local.
export class Client {
  readonly identity: DirectAuth;
  private db: LocalDatabase;
  private fetcher: typeof fetch;
  private runtime?: Runtime;
  private sends = new Set<string>();
  private scope?: string;
  // Account builds re-verify the session and key revision with the service
  // before Ark requests, so a revoked session or a key removed elsewhere stops
  // this device instead of continuing with the key held in memory.
  private accountCheck: { read: number; write: number; interval: number };
  private now: () => number;
  private verifiedAt = 0;
  private verifying?: Promise<void>;
  constructor(
    options: {
      vault?: CredentialStore;
      database?: LocalDatabase;
      fetcher?: typeof fetch;
      // Isolated simulator acceptance profile; does not change credentials.
      scope?: string;
      // The Muse account service. When the build configures it, the signed-in
      // account is the user identity and owns the Ark key and workspace.
      account?: AccountProvider;
      // Longest time, in ms, a verification covers Ark reads and writes, and
      // how often an open runtime is re-checked.
      accountCheck?: { read: number; write: number; interval: number };
      now?: () => number;
    } = {},
  ) {
    this.db = options.database ?? new LocalDatabase();
    this.fetcher = options.fetcher ?? directFetch;
    this.accountCheck = options.accountCheck ?? {
      read: 60_000,
      write: 10_000,
      interval: 30_000,
    };
    this.now = options.now ?? Date.now;
    this.identity = new DirectAuth(
      options.vault,
      this.fetcher,
      options.account,
    );
    if (options.scope !== undefined)
      this.scope = z
        .string()
        .regex(/^welcome-[a-z0-9-]{1,60}$/)
        .parse(options.scope);
  }
  async restore() {
    if (this.identity.accountMode()) await this.identity.account!.restore();
    this.reset();
    await this.identity.restore();
    if (this.identity.accountMode()) this.verifiedAt = this.now();
  }
  // Call after signing in to or out of a Muse account. The previous account's
  // runtime, key, and pending work are dropped before anything else runs.
  async accountChanged() {
    this.reset();
    await this.identity.sync();
    this.verifiedAt = this.now();
  }
  // Picks up a key replaced or removed on another device or window, and a
  // session the account service no longer accepts. Returns true when the
  // account or key changed; otherwise running work is kept.
  async syncAccount() {
    if (!this.identity.accountMode()) return false;
    const owner = this.identity.accountOwner();
    let stored: { revision: number } | undefined;
    if (owner)
      try {
        stored = await this.identity.account!.accountCredential();
      } catch (error) {
        // A rejected session is removed by the account service; treat the
        // device as signed out. Other failures keep the state but propagate.
        if (this.identity.accountOwner() === owner) throw error;
      }
    if (
      this.identity.accountOwner() === owner &&
      owner === this.identity.syncedOwner() &&
      (stored?.revision ?? 0) === this.identity.storedRevision()
    ) {
      this.verifiedAt = this.now();
      return false;
    }
    await this.accountChanged();
    return true;
  }
  private changedError() {
    return new ApiError(
      409,
      this.identity.accountOwner()
        ? t(
            "Your Ark API key changed on another device. Nothing was sent; review and try again.",
          )
        : t(
            "Your Muse account session ended. Sign in again; nothing was sent.",
          ),
    );
  }
  // Local state is checked first and without waiting: an account signed out
  // or a key replaced since this runtime started stops it immediately, even
  // inside the verification window.
  private stale(owner: string, revision: number | undefined) {
    return (
      this.identity.accountOwner() !== owner ||
      this.identity.value?.owner !== owner ||
      this.identity.storedRevision() !== revision
    );
  }
  // Fails closed: without a recent successful verification, no Ark request
  // leaves this device.
  private verifyAccount(write: boolean) {
    if (!this.identity.accountMode()) return Promise.resolve();
    const limit = write ? this.accountCheck.write : this.accountCheck.read;
    if (this.verifiedAt && this.now() - this.verifiedAt < limit)
      return Promise.resolve();
    return (this.verifying ??= this.syncAccount()
      .then((changed) => {
        if (changed) throw this.changedError();
      })
      .finally(() => {
        this.verifying = undefined;
      }));
  }
  private reset() {
    this.runtime?.abort.abort();
    this.runtime?.workspace.cancel();
    this.runtime = undefined;
    this.verifiedAt = 0;
  }
  signedIn() {
    const c = this.identity.value;
    return Boolean(
      c &&
      (!this.identity.accountMode() ||
        c.owner === this.identity.accountOwner()),
    );
  }
  accountCredentialRevision() {
    return this.identity.value?.revision;
  }
  async auth<T = unknown>(path: string, body?: object): Promise<T> {
    let result: unknown;
    try {
      result = await this.identity.execute(path, body);
    } catch (error) {
      if (error instanceof z.ZodError)
        throw new ApiError(
          400,
          t("Check the API key and project name format."),
        );
      throw error;
    }
    if (["logout", "api-key", "import-legacy"].includes(path)) this.reset();
    return result as T;
  }
  private context() {
    const c = this.identity.value;
    const owner = this.identity.accountOwner();
    if (this.identity.accountMode() && (!owner || c?.owner !== owner)) {
      this.reset();
      throw new ApiError(
        401,
        owner
          ? t("Add an Ark API key in Settings first.")
          : t("Sign in to your Muse account first."),
      );
    }
    if (!c?.apiKey)
      throw new ApiError(401, t("Add an Ark API key in Settings first."));
    // Account workspaces include the verified owner, so accounts sharing one
    // Ark key never adopt each other's agent, memory, or local records.
    const base = owner
      ? accountWorkspaceKey(c.apiKey, c.project ?? "", owner)
      : undefined;
    // Simulator acceptance profiles apply to local builds only: an account's
    // workspace key must match the one the service labels its resources with.
    const key =
      base ??
      digest(
        JSON.stringify([
          ARK_BASE_URL,
          c.apiKey,
          c.project ?? "",
          ...(this.scope ? [this.scope] : []),
        ]),
      );
    if (this.runtime?.key !== key) {
      const apiKey = c.apiKey;
      this.reset();
      const abort = new AbortController();
      const revision = c.revision;
      const fetcher: typeof fetch = owner
        ? async (input, init) => {
            if (this.stale(owner, revision)) {
              this.reset();
              throw this.changedError();
            }
            await this.verifyAccount(
              (init?.method ?? "GET").toUpperCase() !== "GET",
            );
            // Verification may have switched accounts or keys meanwhile.
            abort.signal.throwIfAborted();
            if (this.stale(owner, revision)) throw this.changedError();
            return this.fetcher(input, init);
          }
        : this.fetcher;
      if (owner) {
        // Long-lived streams and idle windows are re-checked as well; a
        // failed check resets the runtime, which aborts its requests.
        // Each tick checks with the service regardless of the request window,
        // so a change known only there stops open streams and idle runtimes
        // within one interval. An unreachable service also stops them.
        const timer = setInterval(() => {
          if (this.stale(owner, revision)) return this.reset();
          if (this.verifying) return;
          this.verifying = this.syncAccount()
            .then(() => {
              if (this.stale(owner, revision)) this.reset();
            })
            .catch(() => {
              if (this.runtime?.abort === abort) this.reset();
            })
            .finally(() => {
              this.verifying = undefined;
            });
        }, this.accountCheck.interval);
        abort.signal.addEventListener("abort", () => clearInterval(timer));
      }
      const ark = new ArkClient(
        {
          arkBaseUrl: ARK_BASE_URL,
          arkKey: c.apiKey,
          project: c.project ?? "",
        },
        fetcher,
        abort.signal,
      );
      const account = this.identity.account;
      // Account workspaces are created and recorded by the service; the
      // client only receives their IDs.
      const provision = owner
        ? async (replaceUnconfirmed: boolean) => {
            const { workspace } = await account!.provisionAccountWorkspace(
              c.revision!,
              replaceUnconfirmed,
            );
            if (
              !workspace?.agentId ||
              !workspace.environmentId ||
              !workspace.memoryStoreId
            )
              throw new ApiError(
                502,
                t("The workspace setup did not finish. Continue setup."),
              );
            return {
              agentId: workspace.agentId,
              environmentId: workspace.environmentId,
              memoryStoreId: workspace.memoryStoreId,
              model: workspace.model,
            };
          }
        : undefined;
      const resolve = provision
        ? async (create: boolean) =>
            create
              ? (await provision(false)).memoryStoreId
              : (await account!.accountWorkspace()).workspace?.memoryStoreId
        : undefined;
      const companion = new DirectIdentity(
        key,
        ark,
        this.db,
        undefined,
        resolve,
      );
      this.runtime = {
        key,
        ark,
        abort,
        workspace: new DirectWorkspace(
          key,
          ark,
          this.db,
          provision,
          provision
            ? async () => (await account!.accountWorkspace()).workspace
            : undefined,
          provision
            ? async (kind, changes) => {
                await this.applyWorkspace(kind, changes);
              }
            : undefined,
        ),
        companion,
        goals: new DirectGoals(key, this.db, companion),
        redact: (text) => text.replaceAll(apiKey, "[redacted]"),
      };
    }
    return this.runtime;
  }
  async config(): Promise<AppConfig> {
    return {
      mode: this.signedIn() ? "ark" : "disconnected",
      authRequired: false,
      agentConfigured: (await this.workspaceStatus()).state === "ready",
    };
  }
  async workspaceStatus(): Promise<WorkspaceStatus> {
    if (!this.signedIn())
      return {
        state: "disconnected",
        message:
          "Sign in and connect an Ark project to prepare your workspace.",
      };
    return this.context().workspace.status();
  }
  // replaceUnconfirmed only from an explicit "continue setup" action.
  startWorkspace(options: { replaceUnconfirmed?: boolean } = {}) {
    return this.context().workspace.start(options.replaceUnconfirmed === true);
  }
  async backgroundConfiguration(confirm: boolean) {
    const r = this.context();
    const result = await exportBackgroundConfiguration(
      confirm,
      this.identity,
      r.workspace,
      r.companion,
      r.ark,
    );
    r.abort.signal.throwIfAborted();
    return result;
  }
  async companionIdentity() {
    return this.signedIn()
      ? this.context().companion.read()
      : defaultIdentity();
  }
  saveIdentityDocument(
    name: IdentityDocumentName,
    content: string,
    revision: string,
  ) {
    return this.context().companion.save(name, content, revision);
  }
  private inspirationService(r: Runtime) {
    let selection:
      | { agent: string; environment_id: string; memory_store_id: string }
      | undefined;
    return new DirectInspiration(r.key, this.db, {
      instructions: () => r.companion.feedInstructions(),
      prepare: async (kind, state) => {
        if ((await r.workspace.status()).state !== "ready") {
          await r.workspace.start();
          await r.workspace.wait();
        }
        await r.workspace.syncPolicy();
        const memory_store_id = await r.companion.ensure();
        selection = { ...(await r.workspace.selection()), memory_store_id };
        const index = await this.conversations(r).index();
        const events = index.mainId ? await this.events(index.mainId) : [];
        const goals = (await this.goalService(r).snapshot()).data;
        const instructions = await r.companion.feedInstructions();
        r.abort.signal.throwIfAborted();
        return r.redact(
          inspirationPrompt(kind, {
            instructions: instructions.content,
            recent: recentInspirationContext(events),
            goals: JSON.stringify(
              goals
                .filter((g) => g.status === "active")
                .slice(0, 8)
                .map((g) => ({
                  title: g.title,
                  description: g.description.slice(0, 400),
                })),
            ).slice(0, 2000),
            liked: state.items
              .filter((i) => i.liked)
              .slice(0, 6)
              .map((i) => i.title),
            previous: state.items
              .filter((i) => i.kind === kind)
              .slice(0, 12)
              .map((i) => i.title),
          }),
        );
      },
      list: () =>
        this.collect<Session>(r.ark, "/sessions?limit=100&order=desc"),
      create: async (title) => {
        if (!selection)
          throw new ApiError(400, t("Generation preparation did not finish."));
        const session = await r.ark.create(title, "research", selection);
        await this.remember(r, [session]);
        return session;
      },
      events: (id) =>
        this.collect<AgentEvent>(
          r.ark,
          `/sessions/${validId(id)}/events?order=asc&limit=200`,
        ),
      send: (id, event) =>
        r.ark.request(`/sessions/${validId(id)}/events`, {
          method: "POST",
          body: JSON.stringify({ events: [event] }),
        }),
    });
  }
  async inspiration(): Promise<InspirationSnapshot> {
    if (!this.signedIn())
      return {
        items: [],
        runs: {},
        instructionsDismissed: false,
        instructions: {
          content: defaultFeedInstructions,
          revision: digest(defaultFeedInstructions),
        },
      };
    return this.inspirationService(this.context()).snapshot();
  }
  async refreshInspiration(kind: InspirationKind) {
    const service = this.inspirationService(this.context());
    await service.refresh(z.enum(["feed", "ideas"]).parse(kind));
    return service.snapshot();
  }
  async generateInspiration(kind: InspirationKind) {
    const service = this.inspirationService(this.context());
    await service.generate(z.enum(["feed", "ideas"]).parse(kind));
    return service.snapshot();
  }
  saveFeedInstructions(content: string, revision: string) {
    return this.context().companion.saveFeedInstructions(content, revision);
  }
  dismissFeedInstructions() {
    return this.inspirationService(this.context()).dismissInstructions();
  }
  likeInspiration(id: string, liked: boolean) {
    return this.inspirationService(this.context()).like(
      z.string().max(200).parse(id),
      z.boolean().parse(liked),
    );
  }
  async linkInspirationDiscussion(id: string, session: string) {
    const r = this.context();
    await r.ark.get(validId(session));
    return this.inspirationService(r).link(id, session);
  }
  async identityMounted(id: string) {
    const r = this.context();
    const storeId = await r.companion.storeId();
    if (!storeId) return false;
    const rows = await this.collect<{ type: string; memory_store_id?: string }>(
      r.ark,
      `/sessions/${validId(id)}/resources?limit=100`,
    );
    return rows.some(
      (row) => row.type === "memory_store" && row.memory_store_id === storeId,
    );
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
        throw new ApiError(502, t("Ark returned an invalid list response."));
      data.push(...result.data);
      page = result.next_page ?? "";
      if (page && (seen.has(page) || seen.size >= 100))
        throw new ApiError(
          502,
          t(
            "History pagination repeated or exceeded the safety limit. No writes were retried.",
          ),
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
        for (const row of rows) {
          const generation = row.title?.match(
            /^open-muse-(feed|ideas)-[a-f0-9-]{36}$/,
          );
          if (row.id)
            result[row.id] = {
              ...row,
              title: generation
                ? `${generation[1] === "feed" ? "Feed" : "Ideas"} generation`
                : row.title || "Untitled task",
              category: row.category ?? result[row.id]?.category ?? "general",
            };
        }
        return result;
      },
    );
    return rows.map((row) => saved[row.id]);
  }
  async sessions(): Promise<Page<Session>> {
    if (!this.signedIn()) return { data: [] };
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
    const memory_store_id = await r.companion.ensure();
    const row = await r.ark.create(input.title, input.category, {
      ...selection,
      memory_store_id,
    });
    await this.remember(r, [row]);
    return row;
  }
  private conversations(r: Runtime) {
    let selection:
      | {
          agent: string;
          environment_id: string;
          memory_store_id: string;
          system?: string;
          agent_version?: number;
        }
      | undefined;
    return new Conversations(r.key, this.db, {
      list: () =>
        this.collect<Session>(r.ark, "/sessions?limit=100&order=desc"),
      get: (id) => r.ark.get(validId(id)),
      needsContinuation: async (session) => {
        if (["running", "rescheduling"].includes(session.status)) return false;
        if (session.status === "terminated") return true;
        const storeId = await r.companion.storeId();
        if (!storeId) return true;
        const resources = await this.collect<{
          type: string;
          memory_store_id?: string;
        }>(r.ark, `/sessions/${validId(session.id)}/resources?limit=100`);
        if (
          !resources.some(
            (resource) =>
              resource.type === "memory_store" &&
              resource.memory_store_id === storeId,
          )
        )
          return true;
        const selected = await r.workspace.selection();
        try {
          return needsPromptRefresh(session, r.key, selected.agent);
        } catch (error) {
          if (error instanceof IncompatibleConversation)
            throw new IncompatibleConversation(t(error.message));
          if (
            error instanceof Error &&
            error.message === unreadableInstructions
          )
            throw new ApiError(502, t(unreadableInstructions));
          throw error;
        }
      },
      prepare: async (previous) => {
        if ((await r.workspace.status()).state !== "ready") {
          await r.workspace.start();
          await r.workspace.wait();
        }
        await r.workspace.syncPolicy();
        const memory_store_id = await r.companion.ensure();
        selection = { ...(await r.workspace.selection()), memory_store_id };
        if (previous) {
          if (["running", "rescheduling"].includes(previous.status))
            throw new ApiError(
              409,
              t(
                "Wait for the current response to finish before continuing this conversation.",
              ),
            );
          const index = await this.conversations(r).index();
          const ids = [
            ...(index.entries[previous.id]?.previousIds ?? []),
            previous.id,
          ];
          if (new Set(ids).size !== ids.length)
            throw new ApiError(
              409,
              t(
                "Conversation history links are inconsistent. No history was replaced.",
              ),
            );
          const chapters = [];
          for (const id of ids)
            chapters.push({
              id,
              events: await this.collect<AgentEvent>(
                r.ark,
                `/sessions/${validId(id)}/events?order=asc&limit=200`,
              ),
            });
          const last = chapters.at(-1)!;
          if (pendingPermissions(last.events).length)
            throw new ApiError(
              409,
              t(
                "Resolve the pending tool approval before continuing this conversation.",
              ),
            );
          const snapshot = digest(canonicalJson(last.events));
          let sourceAgent: AgentSnapshot;
          try {
            sourceAgent = continuationAgent(previous, r.key, selection.agent);
          } catch (error) {
            if (error instanceof IncompatibleConversation)
              throw new IncompatibleConversation(t(error.message));
            throw error;
          }
          const sourceResources = await this.collect<{
            type: string;
            memory_store_id?: string;
          }>(r.ark, `/sessions/${validId(previous.id)}/resources?limit=100`);
          // A text-context rollover cannot safely migrate arbitrary mounts or
          // bound account credentials. Refuse it rather than dropping them.
          const vaults = (previous as Session & { vault_ids?: unknown })
            .vault_ids;
          if (
            sourceResources.some(
              (resource) =>
                resource.type !== "memory_store" ||
                resource.memory_store_id !== memory_store_id,
            ) ||
            (vaults != null && (!Array.isArray(vaults) || vaults.length > 0))
          )
            throw new IncompatibleConversation(
              t(
                "This main chat's configuration cannot be safely updated. Its history is intact. Open a side chat to continue.",
              ),
            );
          const archive = await r.companion.archive(
            conversationArchive(chapters, r.redact),
          );
          const [fresh, history, agent, freshResources] = await Promise.all([
            r.ark.get(previous.id),
            this.collect<AgentEvent>(
              r.ark,
              `/sessions/${validId(previous.id)}/events?order=asc&limit=200`,
            ),
            r.ark.request<AgentSnapshot>(
              `/agents/${validId(selection.agent)}${sourceAgent ? `?version=${sourceAgent.version}` : ""}`,
            ),
            this.collect<unknown>(
              r.ark,
              `/sessions/${validId(previous.id)}/resources?limit=100`,
            ),
          ]);
          if (
            ["running", "rescheduling"].includes(fresh.status) ||
            digest(canonicalJson(history)) !== snapshot ||
            canonicalJson(agentSnapshot(fresh)) !==
              canonicalJson(sourceAgent) ||
            canonicalJson(freshResources) !== canonicalJson(sourceResources) ||
            canonicalJson(
              (fresh as Session & { vault_ids?: unknown }).vault_ids,
            ) !== canonicalJson(vaults)
          )
            throw new ApiError(
              409,
              t(
                "The previous conversation changed while preparing. Its history is intact; resume to include the latest messages.",
              ),
            );
          if (typeof agent.system !== "string")
            throw new ApiError(
              502,
              t(
                "The agent instructions could not be read. No replacement conversation was created.",
              ),
            );
          try {
            const system = sourceAgent
              ? refreshedAgentSystem(sourceAgent, agent)
              : agent.system;
            if (sourceAgent) selection.agent_version = sourceAgent.version;
            selection.system = withConversationHistory(
              system,
              archive.store,
              archive.manifest,
            );
          } catch (error) {
            if (error instanceof IncompatibleConversation)
              throw new IncompatibleConversation(t(error.message));
            if (
              error instanceof Error &&
              error.message === unreadableInstructions
            )
              throw new ApiError(502, t(unreadableInstructions));
            throw error;
          }
        }
        r.abort.signal.throwIfAborted();
      },
      create: async (title, category) => {
        if (!selection)
          throw new ApiError(
            400,
            t(
              "Conversation preparation did not finish. No session was created.",
            ),
          );
        return r.ark.create(title, category, selection);
      },
      rename: (id, title) =>
        r.ark.request(`/sessions/${validId(id)}`, {
          method: "POST",
          body: JSON.stringify({ title }),
        }),
    });
  }
  async conversationIndex() {
    return this.signedIn()
      ? this.conversations(this.context()).index()
      : emptyConversations();
  }
  private welcomeService(r: Runtime) {
    return (r.welcome ??= new DirectWelcome(r.key, this.db, {
      eligible: async () => {
        const index = await this.conversations(r).index();
        if (index.mainId || index.pending || Object.keys(index.entries).length)
          return false;
        const identity = await r.companion.read();
        if (
          identity.warning ||
          Object.entries(identityDefaults).some(
            ([name, content]) =>
              identity.documents[
                name as IdentityDocumentName
              ].content.trim() !== content.trim(),
          )
        )
          return false;
        const [agents, sessions] = await Promise.all([
          this.collect<{ id: string; metadata?: Record<string, string> }>(
            r.ark,
            "/agents?limit=100",
          ),
          this.collect<
            Session & {
              agent?:
                string | { id?: string; metadata?: Record<string, string> };
              agent_id?: string;
            }
          >(r.ark, "/sessions?limit=100&order=desc"),
        ]);
        const owned = new Set(
          agents
            .filter((agent) => agent.metadata?.open_muse_workspace === r.key)
            .map((agent) => agent.id),
        );
        return !sessions.some(
          (session) =>
            owned.has(
              typeof session.agent === "string"
                ? session.agent
                : (session.agent?.id ?? session.agent_id ?? ""),
            ) ||
            (typeof session.agent === "object" &&
              session.agent?.metadata?.open_muse_workspace === r.key),
        );
      },
      open: () => this.openConversationFor(r, "main", "Main chat", "general"),
      history: (id) =>
        this.collect<AgentEvent>(
          r.ark,
          `/sessions/${validId(id)}/events?order=asc&limit=200`,
        ),
      send: (id, text, eventId) =>
        this.submit(id, { type: "user.message", text }, undefined, {
          runtime: r,
          eventId,
        }),
    }));
  }
  startWelcome(language: string, retry = false) {
    return this.welcomeService(this.context()).start(language, retry);
  }
  welcomeState() {
    return this.welcomeService(this.context()).state();
  }
  async openConversation(
    kind: ConversationKind,
    title = "Main chat",
    category: Category = "general",
  ) {
    const input = z
      .object({
        kind: z.enum(["main", "side"]),
        title: titleInput.max(100),
        category: z.enum(["general", "research", "writing", "life", "code"]),
      })
      .parse({ kind, title, category });
    const r = this.context();
    return this.openConversationFor(r, input.kind, input.title, input.category);
  }
  private async openConversationFor(
    r: Runtime,
    kind: ConversationKind,
    title: string,
    category: Category,
  ) {
    r.abort.signal.throwIfAborted();
    const index = await this.conversations(r).index();
    if (index.sending) {
      const history = await this.collect<AgentEvent>(
        r.ark,
        `/sessions/${validId(index.sending.session)}/events?order=asc&limit=200`,
      );
      await this.conversations(r).confirmSend(
        index.sending.session,
        history.map((event) => event.id),
      );
    }
    const session = await this.conversations(r).create(kind, title, category);
    await this.remember(r, [session]);
    return session;
  }
  async archiveConversation(id: string, archived: boolean) {
    const r = this.context();
    const session = (await this.remember(r, [await r.ark.get(validId(id))]))[0];
    return this.conversations(r).archive(session, z.boolean().parse(archived));
  }
  private approvalKey(r: Runtime, id: string, tool: string) {
    return `${r.key}:approval:${digest(`${id}\0${tool}`)}`;
  }
  private choiceService(r: Runtime) {
    return (r.choices ??= new DirectChoices(r.key, this.db, {
      history: (id) =>
        this.collect<AgentEvent>(
          r.ark,
          `/sessions/${validId(id)}/events?order=asc&limit=200`,
        ),
      session: (id) => r.ark.get(validId(id)),
      send: (id, text, eventId) =>
        this.submit(id, { type: "user.message", text }, undefined, {
          runtime: r,
          eventId,
        }),
    }));
  }
  answerChoice(id: string, question: string, option: string, revision: string) {
    validId(id);
    validId(question);
    return this.choiceService(this.context()).answer(
      id,
      question,
      option,
      revision,
    );
  }
  private async annotate(
    r: Runtime,
    id: string,
    event: AgentEvent,
  ): Promise<AgentEvent> {
    const {
      approval_source: _ignored,
      source_session_id: _source,
      source_event_id: _sourceEvent,
      choice_reply: _choice,
      app_initiation: _initiation,
      welcome_reply: _welcome,
      ...original
    } = event;
    const annotated = await this.welcomeService(r).annotate(id, original);
    if (event.type === "agent.message") {
      const reply = await this.choiceService(r).reply(id, event.id);
      return reply ? { ...annotated, choice_reply: reply } : annotated;
    }
    if (event.type !== "user.tool_confirmation" || !event.tool_use_id)
      return annotated;
    const record = await this.db.get<Approval>(
      this.approvalKey(r, id, event.tool_use_id),
    );
    return record?.event.id === event.id && event.result === "allow"
      ? { ...original, approval_source: "automatic" }
      : original;
  }
  async events(id: string, signal?: AbortSignal) {
    const r = this.context();
    const index = await this.conversations(r).index();
    const previous: AgentEvent[] = [];
    for (const source of index.entries[id]?.previousIds ?? []) {
      const rows = await this.collect<AgentEvent>(
        r.ark,
        `/sessions/${validId(source)}/events?order=asc&limit=200`,
        signal,
      );
      await this.choiceService(r).reconcile(source, rows);
      await this.welcomeService(r).reconcile(source, rows);
      previous.push(
        ...(await Promise.all(
          rows.map(async (event) => ({
            ...(await this.annotate(r, source, event)),
            id: `history-${source}-${event.id}`,
            source_session_id: source,
            source_event_id: event.id,
          })),
        )),
      );
    }
    const rows = await this.collect<AgentEvent>(
      r.ark,
      `/sessions/${validId(id)}/events?order=asc&limit=200`,
      signal,
    );
    await this.choiceService(r).reconcile(id, rows);
    await this.welcomeService(r).reconcile(id, rows);
    await this.conversations(r).confirmSend(
      id,
      rows.map((event) => event.id),
    );
    return [
      ...previous,
      ...(await Promise.all(rows.map((event) => this.annotate(r, id, event)))),
    ];
  }
  send(
    id: string,
    body: object,
    signal?: AbortSignal,
  ): Promise<Page<AgentEvent>> {
    return this.submit(id, body, signal);
  }
  private async submit(
    id: string,
    body: object,
    signal?: AbortSignal,
    request?: { runtime: Runtime; eventId: string },
  ): Promise<Page<AgentEvent>> {
    const input = messageInput.parse(body);
    if (
      input.type === "user.message" &&
      !input.text &&
      !input.attachments?.length
    )
      throw new ApiError(400, t("Write a message or attach a file."));
    const r = request?.runtime ?? this.context();
    r.abort.signal.throwIfAborted();
    validId(id);
    if (input.type === "user.message") {
      const welcome = await this.welcomeService(r).state();
      if (
        welcome?.phase === "preparing" ||
        (welcome &&
          "eventId" in welcome &&
          ["sending", "unconfirmed"].includes(welcome.phase) &&
          welcome.session === id &&
          welcome.eventId !== request?.eventId)
      )
        throw new ApiError(
          409,
          t(
            "The first conversation is being prepared or its welcome is unconfirmed. Check its history before sending.",
          ),
        );
    }
    const lock = `${r.key}:${id}`;
    if (this.sends.has(lock))
      throw new ApiError(
        409,
        t("The previous operation is still being submitted."),
      );
    this.sends.add(lock);
    let autoKey: string | undefined;
    let autoRecord: Approval | undefined;
    let mainWrite: string | undefined;
    try {
      let event: Partial<AgentEvent> = {
        id: request?.eventId ?? `evt-${uuid()}`,
        type: input.type,
      };
      if (input.type === "user.message")
        event.content = [
          ...attachmentBlocks(input.attachments ?? []),
          ...(input.text ? [{ type: "text", text: input.text }] : []),
        ];
      if (
        input.type === "user.message" &&
        (await this.conversations(r).claimSend(id, event.id!))
      )
        mainWrite = event.id;
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
              t("Automatic confirmation can only allow safe reads."),
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
          throw new ApiError(409, t("Already auto-approved; refresh history."));
        const tool = pendingPermissions(history).find(
          (e) => e.id === input.tool_use_id,
        );
        if (!tool)
          throw new ApiError(
            409,
            t("The tool is no longer pending; refresh history."),
          );
        if (input.automatic && !canAutoApprove(tool))
          throw new ApiError(403, t("This tool requires manual approval."));
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
                t(
                  "An auto-approval is unconfirmed. Refresh history and handle it manually.",
                ),
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
      if (mainWrite) await this.conversations(r).confirmSend(id, [mainWrite]);
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
      if (
        mainWrite &&
        error instanceof ApiError &&
        [400, 401, 403, 404, 413, 429].includes(error.status)
      )
        await this.conversations(r).confirmSend(id, [mainWrite]);
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
          t("The Ark event stream is disconnected; history will be refreshed."),
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
  private goalService(r: Runtime) {
    return r.goals;
  }
  async goals() {
    if (!this.signedIn()) return { data: [] as Goal[], revision: "" };
    return this.goalService(this.context()).snapshot();
  }
  prepareGoals() {
    return this.goalService(this.context()).prepare();
  }
  async createGoal(
    title: string,
    description: string,
    category: GoalCategory = "custom",
  ) {
    const r = this.context();
    const input = z
      .object({
        title: titleInput,
        description: z.string().trim().max(8000),
        category: goalCategoryInput,
      })
      .parse({ title, description, category });
    const now = new Date().toISOString();
    const goal: Goal = {
      ...input,
      id: uuid(),
      status: "active",
      steps: [],
      created_at: now,
      updated_at: now,
    };
    return this.goalService(r).create(goal);
  }
  async updateGoal(
    id: string,
    body: Partial<
      Pick<
        Goal,
        "title" | "description" | "status" | "steps" | "session_id" | "category"
      >
    >,
    revision?: string,
  ) {
    const r = this.context();
    const input = z
      .object({
        title: titleInput.optional(),
        description: z.string().trim().max(8000).optional(),
        status: z.enum(["active", "paused", "completed"]).optional(),
        category: goalCategoryInput.optional(),
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
      throw new ApiError(400, t("Duplicate step IDs."));
    if (input.session_id) await r.ark.get(validId(input.session_id));
    return this.goalService(r).update(id, input, revision);
  }
  async library(): Promise<Page<LibraryItem>> {
    if (!this.signedIn()) return { data: [] };
    return {
      data: (
        (await this.db.get<LibraryItem[]>(`${this.context().key}:library`)) ??
        []
      ).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    };
  }
  private librarySessions?: {
    key: string;
    at: number;
    value: Promise<ReadonlyMap<string, string>>;
  };
  // Only the current identity's Open Muse sessions, or sessions this identity
  // explicitly tracks locally, may contribute files to the Library.
  private async librarySessionTitles(r: Runtime) {
    const [rows, index, saved] = await Promise.all([
      this.collect<Session & { agent?: { metadata?: Record<string, string> } }>(
        r.ark,
        "/sessions?limit=100&order=desc",
      ),
      this.conversations(r).index(),
      this.db.get<LibraryItem[]>(`${r.key}:library`),
    ]);
    r.abort.signal.throwIfAborted();
    const known = new Map<string, string>();
    for (const [id, entry] of Object.entries(index.entries)) {
      known.set(id, entry.title);
      for (const previous of entry.previousIds ?? [])
        known.set(previous, entry.title);
    }
    if (index.mainId && !known.has(index.mainId))
      known.set(index.mainId, t("Main chat"));
    for (const item of saved ?? [])
      if (!known.has(item.session_id)) known.set(item.session_id, item.title);
    for (const row of rows)
      if (
        !known.has(row.id) &&
        row.agent?.metadata?.open_muse_workspace === r.key
      )
        known.set(row.id, row.title || t("Untitled conversation"));
    return known;
  }
  private fileLibrary(r: Runtime) {
    return new DirectLibrary(r.ark, (fresh) => {
      const cached = this.librarySessions;
      if (
        !fresh &&
        cached?.key === r.key &&
        Date.now() - cached.at < 5 * 60_000
      )
        return cached.value;
      const value = this.librarySessionTitles(r);
      const entry = { key: r.key, at: Date.now(), value };
      this.librarySessions = entry;
      value.catch(() => {
        if (this.librarySessions === entry) this.librarySessions = undefined;
      });
      return value;
    });
  }
  async libraryFiles() {
    if (!this.signedIn()) return { data: [] };
    const r = this.context();
    const data = await this.fileLibrary(r).list();
    r.abort.signal.throwIfAborted();
    return { data };
  }
  async libraryFileDownload(id: string) {
    const r = this.context();
    const result = await this.fileLibrary(r).download(id);
    r.abort.signal.throwIfAborted();
    return result;
  }
  async uploadAttachment(file: Blob, name: string, staged: number) {
    const r = this.context();
    const item = await new DirectAttachments(r.ark).upload(
      file,
      name,
      staged,
      r.abort.signal,
    );
    // MA image blocks carry no name; remember it on this device for history.
    if ("file_id" in item)
      await this.db.update<Record<string, string>>(
        `${r.key}:attachment-names`,
        (names) => ({ ...names, [item.file_id]: item.name }),
      );
    return item;
  }
  async attachmentNames(): Promise<Record<string, string>> {
    if (!this.signedIn()) return {};
    return (
      (await this.db.get<Record<string, string>>(
        `${this.context().key}:attachment-names`,
      )) ?? {}
    );
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
        t("No savable assistant reply was found in Ark history."),
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
    const scoped = this.identity.accountOwner()
      ? await this.accountOperation(r, operation, input)
      : undefined;
    if (scoped?.handled) return scoped.result as T;
    let result = await executeOperation(r.ark, operation, input);
    if (scoped?.filter) result = scoped.filter(result);
    if (["CreateSession", "GetSession", "ListSessions"].includes(operation)) {
      const payload = result as Session & { data?: Session[] };
      await this.remember(r, payload.data ?? [payload]);
    }
    return result as T;
  }
  // Changes to the account's own agent and environment go through the
  // service, which applies them once and seals the result with the account.
  private async applyWorkspace(
    kind: "agent" | "environment",
    changes: Record<string, unknown>,
  ) {
    const account = this.identity.account!;
    const current = await account.accountWorkspace();
    return account.updateAccountWorkspace(
      kind,
      changes,
      current.revision,
      this.identity.value!.revision!,
    );
  }
  // In an account, Studio reaches only the account's own agent, environment,
  // memory store, and sessions, even though the shared Ark key reaches more.
  private async accountOperation(r: Runtime, operation: string, input: object) {
    const op = operations.find((value) => value.id === operation);
    if (!op) return;
    const [, collection, , child] = op.path.split("/");
    const param = op.fields.find((field) => field.in === "path")?.name;
    const target = (input as { params?: Record<string, string> }).params?.[
      param ?? ""
    ];
    const record = (await this.identity.account!.accountWorkspace()).workspace;
    const own: Record<string, string | undefined> = {
      agents: record?.agentId,
      environments: record?.environmentId,
      memory_stores: record?.memoryStoreId,
    };
    const refuse = () =>
      new ApiError(
        403,
        t(
          "With a Muse account, Studio reaches only this account's own agent, environment, memory, and sessions.",
        ),
      );
    if (collection in own) {
      if (!param)
        return op.method === "GET"
          ? {
              filter: (value: unknown) => {
                const page = value as { data?: { id: string }[] };
                return {
                  ...page,
                  data: (page.data ?? []).filter(
                    (row) => row.id === own[collection],
                  ),
                };
              },
            }
          : undefined;
      if (!target || target !== own[collection]) throw refuse();
      if (!child && ["UpdateAgent", "UpdateEnvironment"].includes(op.id)) {
        if ((input as { confirm?: boolean }).confirm !== true)
          throw new ApiError(
            400,
            t(
              "Confirm the target and impact before modifying cloud resources.",
            ),
          );
        const result = await this.applyWorkspace(
          op.id === "UpdateAgent" ? "agent" : "environment",
          (input as { body?: Record<string, unknown> }).body ?? {},
        );
        r.abort.signal.throwIfAborted();
        return { handled: true, result };
      }
      return;
    }
    if (collection === "sessions") {
      const mine = (session: Session) => {
        const agent = (session as { agent?: string | { id?: string } }).agent;
        return (
          (typeof agent === "string" ? agent : agent?.id) === record?.agentId
        );
      };
      if (!param)
        return op.method === "GET"
          ? {
              filter: (value: unknown) => {
                const page = value as { data?: Session[] };
                return { ...page, data: (page.data ?? []).filter(mine) };
              },
            }
          : undefined;
      if (
        !target ||
        !record?.agentId ||
        !mine(await r.ark.request<Session>(`/sessions/${validId(target)}`))
      )
        throw refuse();
    }
  }
}
