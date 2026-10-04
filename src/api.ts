import { t, systemLanguage, type Language } from "../shared/i18n";
import { isWebhookPrompt } from "../shared/webhooks";
import { z } from "zod";
import { ArkClient, ApiError } from "../shared/ark";
import { digest, uuid } from "../shared/crypto";
import { accountWorkspaceKey } from "../shared/workspace-key";
import { readSSE } from "../shared/sse";
import { boundedSignal } from "../shared/abort";
import { canAutoApprove } from "../shared/approval-policy";
import {
  eventText,
  pendingCustomTools,
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
import {
  backgroundCredentials,
  credentials,
  LocalDatabase,
  type CredentialStore,
} from "./direct/storage";
import { resetDevice } from "./direct/reset";
import { MA, MA_BASE_URL, directFetch } from "./direct/transport";
import { DirectWorkspace } from "./direct/workspace";
import { exportBackgroundConfiguration } from "./direct/background-export";
import { DirectIdentity, defaultIdentity } from "./direct/identity";
import { DirectGoals } from "./direct/goals";
import { DirectChoices } from "./direct/choices";
import { DirectWelcome } from "./direct/welcome";
import { DirectCheckIn } from "./direct/checkin";
import type { Claim } from "./direct/initiations";
import { validTimeZone } from "../shared/proactive";
import { DirectUpcoming } from "./direct/upcoming";
import { DirectVault, type SecureCredentialInput } from "./direct/vault";
import type { UpcomingDelivery } from "../shared/upcoming";
import { DirectLibrary } from "./direct/library";
import { DirectAttachments } from "./direct/attachments";
import {
  attachmentBlocks,
  attachmentInput,
  attachmentToolNote,
  maxAttachments,
  type Attachment,
} from "../shared/attachments";
import { MediaStore, type KeptMedia } from "./direct/media";
import { eventsToKeep } from "../shared/event-cache";
import {
  parseSummary,
  summaryRequest,
  type ActivitySummary,
  type SummaryRecord,
} from "../shared/activity-summary";
import type { ActivityStep, ActivityTurn } from "../shared/activity";
import {
  browserLaunchMessage,
  isBrowserLaunch,
  type BrowserEvent,
} from "../shared/remote-view";
import { isWelcomePrompt } from "../shared/welcome";
import { larkSignedIn } from "../shared/lark-status";
import { larkStateNote } from "../shared/lark-state";
import { deviceTools } from "../shared/workspace-spec";

// The custom tools the person's own devices answer.
const deviceToolNames = deviceTools.map((tool) => tool.name);
import {
  modelChoiceInput,
  modelOverride,
  sessionUsesModel,
  type ModelChoice,
} from "../shared/models";
import { turnContext, type Surface } from "../shared/turn-context";
import { identityDefaults } from "../shared/identity";
import {
  agentSnapshot,
  canonicalJson,
  continuationAgent,
  IncompatibleConversation,
  missingDeviceTools,
  needsPromptRefresh,
  refreshedAgentSystem,
  unreadableInstructions,
  type AgentSnapshot,
} from "../shared/session-refresh";
import { goalCategoryInput, type GoalCategory } from "../shared/goals";
import type {
  CompanionIdentity,
  IdentityDocumentName,
} from "../shared/identity";
import { DirectInspiration } from "./direct/inspiration";
import {
  catalogIdea,
  emptyIdeaCatalogState,
  ideaCatalogKey,
  type IdeaCatalogState,
} from "../shared/idea-catalog";
import { AccountSync, syncAdapters } from "./direct/account-sync";
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
  accountSkills,
  agentChangesSchema,
  environmentChangesSchema,
} from "../shared/account-workspace";
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
// A client's answers to the custom tools it ran: text and PNG/JPEG images only.
const customToolResults = z
  .array(
    z
      .object({
        custom_tool_use_id: z.string().min(1).max(200),
        is_error: z.boolean(),
        content: z
          .array(
            z.discriminatedUnion("type", [
              z
                .object({
                  type: z.literal("text"),
                  text: z.string().max(64000),
                })
                .strict(),
              z
                .object({
                  type: z.literal("image"),
                  source: z
                    .object({
                      type: z.literal("base64"),
                      media_type: z.enum(["image/png", "image/jpeg"]),
                      data: z
                        .string()
                        .max(8_000_000)
                        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
                    })
                    .strict(),
                })
                .strict(),
            ]),
          )
          .min(1)
          .max(6),
      })
      .strict(),
  )
  .min(1)
  .max(8);
// Sources on this device the companion asks to read, and how each request is
// answered (see Client.devicePermission).
export type DevicePermissionSource =
  "health" | "calendar" | "reminders" | "contacts";
export type DevicePermission = "allow" | "ask" | "deny";
export type CustomToolResult = z.infer<typeof customToolResults>[number];
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
  checkin?: DirectCheckIn;
  upcoming?: DirectUpcoming;
  vault?: DirectVault;
  redact: (text: string) => string;
  abort: AbortController;
};
const validId = (id: string) => {
  if (!/^[\w-]{1,200}$/.test(id))
    throw new ApiError(400, t("Invalid resource ID."));
  return encodeURIComponent(id);
};

// The session fields that tell which identity's workspace a session runs on.
type OwnedSessionRow = {
  id: string;
  agent?: string | { id?: string; metadata?: Record<string, string> } | null;
  agent_id?: string;
};

// This client is the application runtime on every platform. Its only network
// dependencies are public Volcano APIs; saved replies and mappings are local.
export class Client {
  readonly identity: DirectAuth;
  private db: LocalDatabase;
  private fetcher: typeof fetch;
  private runtime?: Runtime;
  private vault: CredentialStore;
  private sends = new Set<string>();
  private scope?: string;
  // Account builds re-verify the session and key revision with the service
  // before Ark requests, so a revoked session or a key removed elsewhere stops
  // this device instead of continuing with the key held in memory.
  private accountCheck: { read: number; write: number; interval: number };
  private now: () => number;
  private media = new MediaStore();
  private surface: Surface;
  private timeZone: () => string;
  private verifiedAt = 0;
  private verifying?: Promise<void>;
  private accountSyncs?: { sync: AccountSync; runtime: Runtime };
  private accountDataListeners = new Set<() => void>();
  constructor(
    options: {
      vault?: CredentialStore;
      database?: LocalDatabase;
      fetcher?: typeof fetch;
      // Isolated simulator acceptance profile; does not change credentials.
      scope?: string;
      // The Open Muse account service. When the build configures it, the signed-in
      // account is the user identity and owns the Ark key and workspace.
      account?: AccountProvider;
      // Longest time, in ms, a verification covers Ark reads and writes, and
      // how often an open runtime is re-checked.
      accountCheck?: { read: number; write: number; interval: number };
      now?: () => number;
      // Which Open Muse app this is, told to the agent with each message.
      surface?: Surface;
      timeZone?: () => string;
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
    this.surface = options.surface ?? "web";
    this.timeZone =
      options.timeZone ??
      (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    this.vault = options.vault ?? credentials;
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
    this.accountSync()?.soon();
  }
  // Call after signing in to or out of an Open Muse account. The previous account's
  // runtime, key, and pending work are dropped before anything else runs.
  async accountChanged() {
    this.reset();
    await this.identity.sync();
    this.verifiedAt = this.now();
    this.accountSync()?.soon();
  }
  // Picks up a key replaced or removed on another device or window, and a
  // session the account service no longer accepts. Returns true when the
  // account or key changed; otherwise running work is kept.
  async syncAccount() {
    if (!this.identity.accountMode()) return false;
    // A session renewing right now is not a signed-out one.
    await this.identity.account?.settled?.();
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
      this.accountSync()?.soon(120_000);
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
            "Your Open Muse account session ended. Sign in again; nothing was sent.",
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
  // Removes this device's saved logins and all local data, returning it to
  // first launch; cloud resources are untouched. The runtime stops first so
  // nothing writes while records are deleted, and the caller reloads the app.
  async resetDevice() {
    this.runtime?.abort.abort();
    this.runtime = undefined;
    await resetDevice([this.vault, backgroundCredentials]);
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
    if (["logout", "api-key"].includes(path)) this.reset();
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
          : t("Sign in to your Open Muse account first."),
      );
    }
    if (!c?.apiKey)
      throw new ApiError(401, t("Add an Ark API key in Settings first."));
    // Account workspaces include the verified owner, so accounts sharing one
    // Ark key never adopt each other's agent, memory, or local records.
    const base = owner
      ? accountWorkspaceKey(c.apiKey, c.project ?? "", owner, MA)
      : undefined;
    // Simulator acceptance profiles apply to local builds only: an account's
    // workspace key must match the one the service labels its resources with.
    const key =
      base ??
      digest(
        JSON.stringify([
          MA_BASE_URL,
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
          arkBaseUrl: MA_BASE_URL,
          provider: MA,
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
        ? async (options: {
            replaceUnconfirmed: boolean;
            resetSettings: boolean;
          }) => {
            const request = () =>
              account!.provisionAccountWorkspace(
                c.revision!,
                options.replaceUnconfirmed,
                options.resetSettings,
              );
            // A pending settings change blocks setup before anything is
            // created; it is checked read-only first, then setup is asked again.
            const { workspace } = await request().catch(async (error) => {
              if ((error as { code?: string }).code !== "settings_pending")
                throw error;
              await this.checkWorkspaceSettings();
              return request();
            });
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
              ? (
                  await provision({
                    replaceUnconfirmed: false,
                    resetSettings: false,
                  })
                ).memoryStoreId
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
    const status = await this.context().workspace.status();
    if (!this.identity.accountOwner()) return status;
    // The account's settings state is shown whenever it needs attention, so a
    // kept-but-possibly-different setting is never reported as in sync.
    const settings = (await this.identity.account!.accountWorkspace()).settings;
    return settings
      ? {
          ...status,
          review:
            settings === "review"
              ? "settings"
              : settings === "drift"
                ? "drift"
                : "unconfirmed",
        }
      : status;
  }
  // Both options only from an explicit user action in Settings.
  startWorkspace(
    options: { replaceUnconfirmed?: boolean; resetSettings?: boolean } = {},
  ) {
    return this.context().workspace.start(options);
  }
  // Resolves an unconfirmed agent or environment change by reading Ark on the
  // service; nothing is sent to Ark. adopt saves the current values and is
  // only for an explicit user decision after review.
  async checkWorkspaceSettings(
    mode?: "adopt" | "discard",
    // Adopting names the values the user reviewed in compareWorkspaceSettings.
    expected?: string,
  ) {
    const account = this.identity.account!;
    const current = await account.accountWorkspace();
    if (!current.settings) return current;
    return account.reconcileAccountWorkspace(
      current.revision,
      this.identity.value!.revision!,
      mode,
      expected,
    );
  }
  // Ark's current values for the settings under review next to the saved
  // ones. Read on the service; nothing is changed.
  async compareWorkspaceSettings() {
    const account = this.identity.account!;
    const current = await account.accountWorkspace();
    return account.compareAccountWorkspace(
      current.revision,
      this.identity.value!.revision!,
    );
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
    if (!this.signedIn()) return defaultIdentity();
    const r = this.context();
    const identity = await r.companion.read();
    await this.db
      .set(`${r.key}:companion-look`, {
        name: identity.name,
        ...(identity.avatar ? { avatar: identity.avatar } : {}),
      })
      .catch(() => {});
    return identity;
  }
  // The companion's name and look as last read on this device, so the header
  // shows them at once; undefined before the first read.
  async cachedCompanion(): Promise<
    Pick<CompanionIdentity, "name" | "avatar"> | undefined
  > {
    if (!this.signedIn()) return undefined;
    return this.db.get(`${this.context().key}:companion-look`);
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
        // Catalog ideas the person asked for more of, as shown to them.
        const catalog = await this.db.get<IdeaCatalogState>(
          ideaCatalogKey(r.key),
        );
        const likedCatalog = (catalog?.liked ?? []).flatMap((id) => {
          const idea = catalogIdea(id);
          return idea ? [t(idea.title)] : [];
        });
        r.abort.signal.throwIfAborted();
        return r.redact(
          inspirationPrompt(kind, {
            language: systemLanguage(),
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
            liked: [
              ...state.items.filter((i) => i.liked).map((i) => i.title),
              ...likedCatalog,
            ].slice(0, 6),
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
  // This device's posts and ideas at once, before the cloud is read.
  async cachedInspiration(): Promise<InspirationSnapshot> {
    if (!this.signedIn()) return this.inspiration();
    return this.inspirationService(this.context()).cached();
  }
  async refreshInspiration(kind: InspirationKind) {
    const service = this.inspirationService(this.context());
    await service.refresh(z.enum(["feed", "ideas"]).parse(kind));
    this.accountSync()?.changed();
    return service.snapshot();
  }
  async generateInspiration(kind: InspirationKind) {
    const service = this.inspirationService(this.context());
    await service.generate(z.enum(["feed", "ideas"]).parse(kind));
    this.accountSync()?.changed();
    return service.snapshot();
  }
  saveFeedInstructions(content: string, revision: string) {
    return this.context().companion.saveFeedInstructions(content, revision);
  }
  async dismissFeedInstructions() {
    await this.inspirationService(this.context()).dismissInstructions();
    this.accountSync()?.changed();
  }
  async likeInspiration(id: string, liked: boolean) {
    await this.inspirationService(this.context()).like(
      z.string().max(200).parse(id),
      z.boolean().parse(liked),
    );
    this.accountSync()?.changed();
  }
  // What this device remembers about the Ideas catalog. Signed out, it is
  // kept apart from every workspace and never carried into one.
  private ideaCatalogStorage() {
    return ideaCatalogKey(this.signedIn() ? this.context().key : "device");
  }
  async ideaCatalogState(): Promise<IdeaCatalogState> {
    const saved = await this.db.get<IdeaCatalogState>(
      this.ideaCatalogStorage(),
    );
    return { ...emptyIdeaCatalogState(), ...saved };
  }
  async reactToCatalogIdea(id: string, reaction: "liked" | "hidden") {
    const key = z.string().max(200).parse(id);
    const field = z.enum(["liked", "hidden"]).parse(reaction);
    return this.db.update<IdeaCatalogState>(
      this.ideaCatalogStorage(),
      (old) => {
        const state = { ...emptyIdeaCatalogState(), ...old };
        if (!state[field].includes(key)) state[field] = [...state[field], key];
        return state;
      },
    );
  }
  async linkInspirationDiscussion(id: string, session: string) {
    const r = this.context();
    await r.ark.get(validId(session));
    await this.inspirationService(r).link(id, session);
    this.accountSync()?.changed();
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
              ...(generation
                ? { generation: generation[1] as "feed" | "ideas" }
                : {}),
              category: row.category ?? result[row.id]?.category ?? "general",
            };
        }
        return result;
      },
    );
    return rows.map((row) => saved[row.id]);
  }
  // Sessions under a shared Ark key may belong to other identities. One is
  // this identity's when it runs on an agent of this identity's workspace or
  // when this identity's conversation index tracks it.
  private async ownedSessions(r: Runtime) {
    const [agents, index] = await Promise.all([
      this.collect<{ id: string; metadata?: Record<string, string> }>(
        r.ark,
        "/agents?limit=100",
      ),
      this.conversations(r).index(),
    ]);
    const ownAgents = new Set(
      agents
        .filter((agent) => agent.metadata?.open_muse_workspace === r.key)
        .map((agent) => agent.id),
    );
    const tracked = new Set<string>();
    if (index.mainId) tracked.add(index.mainId);
    for (const [id, entry] of Object.entries(index.entries)) {
      tracked.add(id);
      for (const previous of entry.previousIds ?? []) tracked.add(previous);
    }
    return (row: OwnedSessionRow) => {
      if (tracked.has(row.id)) return true;
      const agent = row.agent;
      if (typeof agent === "object" && agent)
        return (
          agent.metadata?.open_muse_workspace === r.key ||
          ownAgents.has(agent.id ?? "")
        );
      return ownAgents.has(agent ?? row.agent_id ?? "");
    };
  }
  async sessions(): Promise<Page<Session>> {
    if (!this.signedIn()) return { data: [] };
    const r = this.context();
    const [rows, owned] = await Promise.all([
      this.collect<Session & OwnedSessionRow>(
        r.ark,
        "/sessions?limit=100&order=desc",
      ),
      this.ownedSessions(r),
    ]);
    r.abort.signal.throwIfAborted();
    return { data: await this.remember(r, rows.filter(owned)) };
  }
  async session(id: string, signal?: AbortSignal) {
    const r = this.context();
    const [row, owned] = await Promise.all([
      r.ark.request<Session & OwnedSessionRow>(`/sessions/${validId(id)}`, {
        signal,
      }),
      this.ownedSessions(r),
    ]);
    if (!owned(row))
      throw new ApiError(404, t("This conversation was not found."));
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
    const choice = await this.chosenModel(r);
    const row = await r.ark.create(input.title, input.category, {
      ...selection,
      ...(choice ? { model: modelOverride(choice) } : {}),
      memory_store_id,
      vault_ids: await this.vaultIds(r),
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
          vault_ids?: string[];
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
        // A newly chosen model or thinking level starts a new chapter.
        const choice = await this.chosenModel(r);
        if (choice && !sessionUsesModel(session, choice)) return true;
        const selected = await r.workspace.selection();
        try {
          return needsPromptRefresh(
            session,
            r.key,
            selected.agent,
            deviceToolNames,
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
      },
      prepare: async (previous) => {
        if ((await r.workspace.status()).state !== "ready") {
          await r.workspace.start();
          await r.workspace.wait();
        }
        await r.workspace.syncPolicy();
        const memory_store_id = await r.companion.ensure();
        selection = {
          ...(await r.workspace.selection()),
          memory_store_id,
          vault_ids: await this.vaultIds(r),
        };
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
            mount_path?: string;
          }>(r.ark, `/sessions/${validId(previous.id)}/resources?limit=100`);
          // A text-context rollover cannot safely migrate arbitrary mounts or
          // bound account credentials. Refuse it rather than dropping them.
          // Files this app mounted for a message's attachments are the
          // exception: they belonged to that message, stay named in the
          // archived history, and are not mounted into the next chapter.
          const vaults = (previous as Session & { vault_ids?: unknown })
            .vault_ids;
          if (
            sourceResources.some(
              (resource) =>
                !(
                  resource.type === "memory_store" &&
                  resource.memory_store_id === memory_store_id
                ) &&
                !(
                  resource.type === "file" &&
                  /^\/mnt\/session\/uploads\/[^/\0]+$/.test(
                    resource.mount_path ?? "",
                  )
                ),
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
            // The chapter keeps its agent version, unless that version lacks
            // device tools this app now answers; then the current one.
            r.ark.request<AgentSnapshot>(
              `/agents/${validId(selection.agent)}${sourceAgent && !missingDeviceTools(sourceAgent, deviceToolNames) ? `?version=${sourceAgent.version}` : ""}`,
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
              ? refreshedAgentSystem(
                  sourceAgent,
                  agent,
                  Boolean(await this.chosenModel(r)),
                  deviceToolNames,
                )
              : agent.system;
            if (sourceAgent) selection.agent_version = agent.version;
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
        const choice = await this.chosenModel(r);
        return r.ark.create(title, category, {
          ...selection,
          ...(choice ? { model: modelOverride(choice) } : {}),
        });
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
  private checkInService(r: Runtime) {
    return (r.checkin ??= new DirectCheckIn(r.key, this.db, {
      main: async () => {
        const { mainId } = await this.conversations(r).index();
        return mainId ? r.ark.get(validId(mainId)) : undefined;
      },
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
      claim: this.proactiveClaim(r),
    }));
  }
  // With an Open Muse account, app-generated messages are claimed with the
  // service before they are sent, so no two devices (or a device and the
  // service) send the same one. Local mode has no claim.
  private proactiveClaim(r: Runtime): Claim | undefined {
    const account = this.identity.account;
    if (!this.identity.accountMode() || !account?.claimProactive)
      return undefined;
    return async (kind, key, session) => {
      const result = await account.claimProactive!({
        kind,
        key,
        session_id: validId(session),
      });
      r.abort.signal.throwIfAborted();
      return result.claimed;
    };
  }
  startCheckIn(language: string) {
    return this.checkInService(this.context()).start(language);
  }
  checkInState() {
    return this.checkInService(this.context()).state();
  }
  // Secure storage for the agent. Conversations created while the vault
  // exists can use it; reading it never creates one.
  private vaultService(r: Runtime) {
    return (r.vault ??= new DirectVault(r.ark, this.db, r.key));
  }
  private async vaultIds(r: Runtime) {
    const id = await this.vaultService(r).existing();
    return id ? [id] : [];
  }
  secureCredentials() {
    return this.vaultService(this.context()).list();
  }
  addSecureCredential(input: SecureCredentialInput) {
    return this.vaultService(this.context()).add(input);
  }
  removeSecureCredential(id: string) {
    validId(id);
    return this.vaultService(this.context()).remove(id);
  }
  private upcomingService(r: Runtime) {
    return (r.upcoming ??= new DirectUpcoming(r.key, this.db, r.companion, {
      main: async () => {
        const { mainId } = await this.conversations(r).index();
        return mainId ? r.ark.get(validId(mainId)) : undefined;
      },
      mainId: async () => (await this.conversations(r).index()).mainId,
      server: () => this.serverUpcoming(r),
      register: (session) => this.saveServerUpcoming(r, true, session),
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
      claim: this.proactiveClaim(r),
    }));
  }
  upcoming() {
    return this.upcomingService(this.context()).list();
  }
  private upcomingServer?: {
    key: string;
    at: number;
    value: UpcomingDelivery;
  };
  // Service delivery is cached briefly; the minute tick must not query the
  // service every time.
  private async serverUpcoming(r: Runtime, fresh = false) {
    const account = this.identity.account;
    if (!this.identity.accountMode() || !account?.upcomingDelivery)
      return undefined;
    const cached = this.upcomingServer;
    if (!fresh && cached?.key === r.key && this.now() - cached.at < 300_000)
      return cached.value;
    let value: UpcomingDelivery;
    try {
      value = await account.upcomingDelivery();
    } catch (error) {
      // An unreachable service keeps its last known answer, so this device
      // does not start delivering what the service may still be sending.
      if (!fresh && cached?.key === r.key) return cached.value;
      throw error;
    }
    r.abort.signal.throwIfAborted();
    this.upcomingServer = { key: r.key, at: this.now(), value };
    return value;
  }
  private async saveServerUpcoming(
    r: Runtime,
    enabled: boolean,
    session?: string,
    followUps: { checkins?: boolean; goal_followups?: boolean } = {},
  ) {
    const account = this.identity.account;
    if (!this.identity.accountMode() || !account?.saveUpcomingDelivery)
      throw new ApiError(
        400,
        t("Reminder delivery while closed needs an Open Muse account."),
      );
    const current = await this.serverUpcoming(r, true);
    const target =
      session ??
      (await this.conversations(r).index()).mainId ??
      current?.session_id ??
      undefined;
    if (!target)
      throw new ApiError(409, t("Start the main chat before turning this on."));
    validId(target);
    // The person's time zone, for check-ins and goal follow-ups.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const value = await account.saveUpcomingDelivery({
      session_id: target,
      language: systemLanguage(),
      enabled,
      revision: current?.revision ?? 0,
      ...followUps,
      ...(validTimeZone(zone) ? { time_zone: zone } : {}),
    });
    r.abort.signal.throwIfAborted();
    this.upcomingServer = { key: r.key, at: this.now(), value };
    return value;
  }
  // Whether this build and account can have the service deliver reminders.
  upcomingDeliverySupported() {
    return (
      this.signedIn() &&
      this.identity.accountMode() &&
      Boolean(this.identity.account?.saveUpcomingDelivery)
    );
  }
  upcomingDelivery() {
    return this.serverUpcoming(this.context(), true);
  }
  setUpcomingDelivery(enabled: boolean) {
    return this.saveServerUpcoming(this.context(), z.boolean().parse(enabled));
  }
  // Check-ins and goal follow-ups by the service while the apps are closed;
  // they need delivery while closed to be on.
  setClosedFollowUps(change: { checkins?: boolean; goal_followups?: boolean }) {
    return this.saveServerUpcoming(
      this.context(),
      true,
      undefined,
      z
        .object({
          checkins: z.boolean().optional(),
          goal_followups: z.boolean().optional(),
        })
        .strict()
        .parse(change),
    );
  }
  changeUpcoming(
    id: string,
    action: "pause" | "resume" | "delete",
    revision: string,
  ) {
    validId(id);
    return this.upcomingService(this.context()).change(
      id,
      z.enum(["pause", "resume", "delete"]).parse(action),
      z.string().parse(revision),
    );
  }
  deliverUpcoming(language: string) {
    return this.upcomingService(this.context()).start(language);
  }
  setCheckIn(enabled: boolean) {
    return this.checkInService(this.context()).setEnabled(
      z.boolean().parse(enabled),
    );
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
    // A device without a main chat takes the account's before starting one.
    if (kind === "main" && !index.mainId && !index.pending)
      await this.accountSync()
        ?.sync()
        .catch(() => {});
    const session = await this.conversations(r).create(kind, title, category);
    if (kind === "main" && session.id !== index.mainId)
      this.accountSync()?.changed(0);
    await this.remember(r, [session]);
    return session;
  }
  async archiveConversation(id: string, archived: boolean) {
    const r = this.context();
    const session = (await this.remember(r, [await r.ark.get(validId(id))]))[0];
    const index = await this.conversations(r).archive(
      session,
      z.boolean().parse(archived),
    );
    this.accountSync()?.changed();
    return index;
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
    if (
      original.type === "user.message" &&
      isBrowserLaunch(eventText(original))
    )
      return { ...original, app_initiation: "browser" };
    if (
      original.type === "user.message" &&
      isWebhookPrompt(eventText(original))
    )
      return { ...original, app_initiation: "webhook" };
    if (
      original.type === "user.message" &&
      isWelcomePrompt(eventText(original))
    )
      return { ...original, app_initiation: "welcome" };
    const annotated = await this.upcomingService(r).annotate(
      id,
      await this.checkInService(r).annotate(
        id,
        await this.welcomeService(r).annotate(id, original),
      ),
    );
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
  // A conversation's latest events as last read on this device, so it opens
  // at once; the cloud read follows. Kept for the most recent conversations
  // only, under the identity's own key.
  async cachedEvents(id: string): Promise<AgentEvent[]> {
    if (!this.signedIn()) return [];
    validId(id);
    return (
      (await this.db.get<AgentEvent[]>(`${this.context().key}:events:${id}`)) ??
      []
    );
  }
  async keepEvents(id: string, events: AgentEvent[]) {
    if (!this.signedIn()) return;
    validId(id);
    const r = this.context();
    await this.db.set(`${r.key}:events:${id}`, eventsToKeep(events));
    let evicted: string[] = [];
    await this.db.update<string[]>(`${r.key}:events-index`, (current = []) => {
      const next = [id, ...current.filter((item) => item !== id)];
      evicted = next.slice(12);
      return next.slice(0, 12);
    });
    for (const old of evicted)
      await this.db.set(`${r.key}:events:${old}`, null);
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
      // Each message carries the person's local time and app as context.
      // Files are mounted before the message is sent, so a failure leaves
      // nothing half-sent; the paths then reach the agent's tools.
      let note: Partial<AgentEvent> | undefined;
      let lark: { key: string; text: string } | undefined;
      if (input.type === "user.message") {
        const notes = [
          turnContext(new Date(this.now()), this.timeZone(), this.surface),
        ];
        if (input.attachments?.length) {
          const files = input.attachments.filter((item) => "file_id" in item);
          const mounts = files.length
            ? await this.mountAttachments(r, id, files, signal)
            : [];
          notes.push(
            attachmentToolNote(
              mounts,
              input.attachments
                .filter((item) => "text" in item)
                .map((item) => item.name),
            ),
          );
        }
        lark = await this.larkNote(r, id);
        if (lark) notes.push(lark.text);
        note = {
          type: "system.message",
          content: [{ type: "text", text: notes.join("\n\n") }],
        };
      }
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
        {
          method: "POST",
          body: JSON.stringify({ events: note ? [event, note] : [event] }),
          signal,
        },
      );
      const rows = Array.isArray(result.data) ? result.data : [];
      if (lark) await this.db.set(lark.key, true);
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
  // Gives a conversation's cloud environment, once, a token for the
  // account's saved Lark sign-in, so lark-cli there starts signed in and
  // keeps the sign-in saved. Account builds only; when the token cannot be
  // issued the message goes without it.
  private async larkNote(r: Runtime, id: string) {
    const account = this.identity.account;
    if (!account?.issueLarkToken || !account.larkStateUrl) return undefined;
    const key = `${r.key}:lark-note:${id}`;
    if (await this.db.get<boolean>(key)) return undefined;
    try {
      const { token } = await account.issueLarkToken();
      return { key, text: larkStateNote(account.larkStateUrl(), token) };
    } catch {
      return undefined;
    }
  }
  // Answers custom tool calls this client ran. Only calls the session is still
  // blocked on are answered, history is read first so an existing result is
  // never sent again, and a failed or unconfirmed write is not retried.
  async answerCustomTools(
    id: string,
    results: CustomToolResult[],
    signal?: AbortSignal,
  ): Promise<Page<AgentEvent>> {
    const input = customToolResults.parse(results);
    const r = this.context();
    r.abort.signal.throwIfAborted();
    validId(id);
    const lock = `${r.key}:${id}`;
    if (this.sends.has(lock))
      throw new ApiError(
        409,
        t("The previous operation is still being submitted."),
      );
    this.sends.add(lock);
    try {
      const history = await this.collect<AgentEvent>(
        r.ark,
        `/sessions/${validId(id)}/events?order=asc&limit=200`,
        signal,
      );
      const pending = new Set(pendingCustomTools(history).map((e) => e.id));
      if (
        new Set(input.map((item) => item.custom_tool_use_id)).size !==
          input.length ||
        input.some((item) => !pending.has(item.custom_tool_use_id))
      )
        throw new ApiError(
          409,
          t("The tool is no longer pending; refresh history."),
        );
      const events = input.map((item) => ({
        id: `evt-${uuid()}`,
        type: "user.custom_tool_result",
        ...item,
      }));
      const result = await r.ark.request<Page<AgentEvent>>(
        `/sessions/${validId(id)}/events`,
        { method: "POST", body: JSON.stringify({ events }), signal },
      );
      const rows = Array.isArray(result.data) ? result.data : [];
      return {
        ...result,
        data: await Promise.all(rows.map((e) => this.annotate(r, id, e))),
      };
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
  // Mount records hold only file IDs, stored names and sandbox paths. A mount
  // whose result was lost is confirmed from the session's resources before
  // any new write, so repeated sends never mount the same file twice.
  private async mountAttachments(
    r: Runtime,
    sessionId: string,
    files: readonly { file_id: string; name: string; stored?: string }[],
    signal?: AbortSignal,
  ) {
    type Mounts = Record<
      string,
      Record<string, { path?: string; pending?: string }>
    >;
    const key = `${r.key}:attachment-mounts`;
    const record = (
      file: string,
      value?: { path?: string; pending?: string },
    ) =>
      this.db.update<Mounts>(key, (current) => {
        const next = { ...current };
        const session = { ...next[sessionId] };
        if (value) session[file] = value;
        else delete session[file];
        next[sessionId] = session;
        return next;
      });
    const service = new DirectAttachments(r.ark);
    const result: { name: string; path: string }[] = [];
    let listed: Map<string, string> | undefined;
    for (const file of files) {
      const known = (await this.db.get<Mounts>(key))?.[sessionId]?.[
        file.file_id
      ];
      if (known?.path) {
        result.push({ name: file.name, path: known.path });
        continue;
      }
      if (known?.pending) {
        listed ??= await service.mountedPaths(sessionId, signal);
        const path = listed.get(known.pending);
        if (path) {
          await record(file.file_id, { path });
          result.push({ name: file.name, path });
          continue;
        }
      }
      const failure = t(
        "Couldn't make {name} available to tools. Nothing was sent.",
        { name: file.name },
      );
      if (!file.stored) throw new ApiError(409, failure);
      await record(file.file_id, { pending: file.stored });
      try {
        const path = await service.mount(sessionId, file.file_id, signal);
        await record(file.file_id, { path });
        result.push({ name: file.name, path });
      } catch (error) {
        // A definite rejection created nothing; anything else is checked
        // against the session's resources on the next attempt.
        if (error instanceof ApiError && error.status < 500)
          await record(file.file_id);
        throw new ApiError(
          error instanceof ApiError ? error.status : 502,
          failure,
        );
      }
    }
    return result;
  }
  // Copies of photos and videos sent from this device, so they can be opened
  // again; Ark offers no download of uploads. Failures only cost the preview.
  keepSentImage(fileId: string, blob: Blob, video?: string) {
    if (!this.signedIn()) return Promise.resolve();
    return this.media
      .keepImage(this.context().key, fileId, blob, video)
      .catch(() => {});
  }
  keepSentVideo(video: string, blob: Blob) {
    if (!this.signedIn()) return Promise.resolve();
    return this.media
      .keepVideo(this.context().key, video, blob)
      .catch(() => {});
  }
  async sentMedia(fileId: string): Promise<KeptMedia | undefined> {
    if (!this.signedIn()) return undefined;
    return this.media.media(this.context().key, fileId).catch(() => undefined);
  }
  async attachmentNames(): Promise<Record<string, string>> {
    if (!this.signedIn()) return {};
    return (
      (await this.db.get<Record<string, string>>(
        `${this.context().key}:attachment-names`,
      )) ?? {}
    );
  }
  // The model and thinking level this identity chose for new conversations;
  // undefined keeps the workspace agent's own model.
  private async chosenModel(r: Runtime) {
    const stored = await this.db.get<unknown>(`${r.key}:model`);
    const parsed = modelChoiceInput.safeParse(stored);
    return parsed.success ? parsed.data : undefined;
  }
  async modelChoice() {
    if (!this.signedIn()) return undefined;
    return this.chosenModel(this.context());
  }
  async setModelChoice(choice: ModelChoice | null) {
    const r = this.context();
    await this.db.set(
      `${r.key}:model`,
      choice === null ? null : modelChoiceInput.parse(choice),
    );
    this.accountSync()?.changed();
  }
  // The account's model choice, Feed reactions and posts, saved replies,
  // archived side chats, and main chat, kept in step with its other devices. Account builds
  // only: local mode never uploads anything. The instance is bound to this
  // account and workspace and stops when either changes.
  private accountSync(): AccountSync | undefined {
    const owner = this.identity.accountOwner();
    const account = this.identity.account;
    if (!owner || !account?.pullAccountSync || !account.pushAccountSync)
      return undefined;
    if (!this.signedIn()) return undefined;
    let r: Runtime;
    try {
      r = this.context();
    } catch {
      return undefined;
    }
    const current = this.accountSyncs;
    if (current?.runtime === r && current.sync.owner === owner)
      return current.sync;
    current?.sync.stop();
    const sync = new AccountSync(
      this.db,
      owner,
      r.key,
      {
        pull: (workspace, after) => account.pullAccountSync!(workspace, after),
        push: (workspace, mutations) =>
          account.pushAccountSync!(workspace, mutations),
      },
      syncAdapters(this.db, r.key),
      () =>
        !r.abort.signal.aborted &&
        this.runtime === r &&
        this.identity.accountOwner() === owner,
    );
    sync.onApplied = () => {
      for (const listener of this.accountDataListeners) listener();
    };
    this.accountSyncs = { sync, runtime: r };
    return sync;
  }
  // Called when another device's change reached this one, such as the
  // account's main chat moving on.
  onAccountData(listener: () => void) {
    this.accountDataListeners.add(listener);
    return () => void this.accountDataListeners.delete(listener);
  }
  // An explicit sync pass; undefined where nothing syncs.
  syncAccountData() {
    return this.accountSync()?.sync();
  }
  // The live cloud browser: needs an Open Muse account, whose service relays
  // the view, and a conversation whose sandbox runs the browser.
  browserViewSupported() {
    return (
      this.signedIn() &&
      this.identity.accountMode() &&
      Boolean(this.identity.account?.openBrowserView)
    );
  }
  // Opens a view and asks the conversation's agent to start the helper.
  async startBrowserView(session: string) {
    const account = this.browserAccount();
    const view = await account.openBrowserView!();
    try {
      await this.send(session, {
        type: "user.message",
        text: browserLaunchMessage(
          account.browserRelayUrl!(view.id),
          view.token,
        ),
      });
    } catch (error) {
      await account.closeBrowserView!(view.id).catch(() => {});
      throw error;
    }
    this.liveView = { id: view.id, expires: view.expires_at };
    return view.id;
  }
  // The view still running after its sheet was put away, if any.
  activeBrowserView() {
    const view = this.liveView;
    return view && view.expires > Date.now() + 10_000 ? view.id : undefined;
  }
  private liveView?: { id: string; expires: number };
  private browserAccount() {
    const account = this.identity.account;
    if (!this.browserViewSupported() || !account)
      throw new ApiError(409, t("Sign in to an Open Muse account first."));
    return account;
  }
  browserFrame(id: string, after: number) {
    return this.browserAccount().browserFrame!(id, after);
  }
  browserInput(id: string, events: BrowserEvent[]) {
    return this.browserAccount().browserInput!(id, events);
  }
  closeBrowserView(id: string) {
    if (this.liveView?.id === id) this.liveView = undefined;
    return this.browserAccount().closeBrowserView!(id);
  }
  // Labels written for finished requests in the activity list, and failed
  // attempts, by the request's message ID.
  async activitySummaries(): Promise<Record<string, SummaryRecord>> {
    if (!this.signedIn()) return {};
    return (
      (await this.db.get<Record<string, SummaryRecord>>(
        `${this.context().key}:activity-summaries`,
      )) ?? {}
    );
  }
  // Labels one finished request with a small model and keeps the result on
  // this device; a failure is kept too, so it is not retried at once. Each
  // call is one Ark request.
  async summarizeActivity(
    turn: ActivityTurn,
    steps: readonly ActivityStep[],
    language: Language,
  ): Promise<ActivitySummary | undefined> {
    const r = this.context();
    let summary: ActivitySummary | undefined;
    try {
      const reply = await r.ark.request<{
        choices?: { message?: { content?: unknown } }[];
      }>("/chat/completions", {
        method: "POST",
        body: JSON.stringify(summaryRequest(turn, steps, language)),
        timeout: 90_000,
      });
      summary = parseSummary(
        reply.choices?.[0]?.message?.content,
        steps.length,
        language,
      );
    } finally {
      const record: SummaryRecord = summary ?? { failed: Date.now() };
      await this.db.update<Record<string, SummaryRecord>>(
        `${r.key}:activity-summaries`,
        (current = {}) => {
          // Keep the most recent few hundred.
          const { [turn.id]: _, ...rest } = current;
          return Object.fromEntries(
            Object.entries({ ...rest, [turn.id]: record }).slice(-400),
          );
        },
      );
    }
    return summary;
  }
  // Whether the assistant is signed in to Lark: for an account, whether the
  // service keeps a saved sign-in that every conversation restores;
  // otherwise as the main chat's lark-cli output last showed. `cached` reads
  // only what this device kept, for an immediate answer.
  async larkConnected(cached = false) {
    if (!this.signedIn()) return false;
    // An account keeps the sign-in on the service, which has the final say:
    // a removed sign-in stays removed even while the chat still shows it.
    const account = this.identity.account;
    if (!cached && this.identity.accountMode() && account?.larkState)
      return (await account.larkState().catch(() => ({ saved: false }))).saved;
    const r = this.context();
    const main = (await this.conversations(r).index()).mainId;
    if (!main) return false;
    const events = cached
      ? await this.cachedEvents(main)
      : await this.collect<AgentEvent>(
          r.ark,
          `/sessions/${validId(main)}/events?order=asc&limit=200`,
        );
    const shown = larkSignedIn(events);
    if (shown !== undefined) return shown;
    return false;
  }
  // Whether a Lark sign-in carries over to new conversations.
  larkKept() {
    return (
      this.identity.accountMode() &&
      Boolean(this.identity.account?.issueLarkToken)
    );
  }
  // Removes the account's saved Lark sign-in, so later conversations start
  // signed out. The current one signs out when the person asks it to.
  async forgetLark() {
    const account = this.identity.account;
    if (this.identity.accountMode() && account?.removeLarkState)
      await account.removeLarkState();
  }
  // Whether this identity connected Apple Health on this device; while it is,
  // the companion's Health reads are answered without asking each time.
  async healthConnected() {
    if (!this.signedIn()) return false;
    return (
      (await this.db.get<boolean>(`${this.context().key}:health-connected`)) ===
      true
    );
  }
  async setHealthConnected(connected: boolean) {
    await this.db.set(
      `${this.context().key}:health-connected`,
      z.boolean().parse(connected),
    );
  }
  // How this identity's requests to read a source on this device are
  // answered: Apple Health may be allowed (the same as connecting it);
  // Calendar, Reminders and Contacts are only ever asked or declined. A
  // declined source answers each request with a refusal without asking.
  async devicePermission(source: DevicePermissionSource) {
    if (!this.signedIn()) return "ask" as DevicePermission;
    if (source === "health" && (await this.healthConnected())) return "allow";
    const stored = await this.db.get<DevicePermission>(
      `${this.context().key}:device-permission:${source}`,
    );
    return stored === "deny" ? "deny" : ("ask" as DevicePermission);
  }
  async setDevicePermission(
    source: DevicePermissionSource,
    permission: DevicePermission,
  ) {
    if (permission === "allow" && source !== "health")
      throw new Error(
        t("Only Apple Health reads can be allowed without asking."),
      );
    if (source === "health")
      await this.setHealthConnected(permission === "allow");
    await this.db.set(
      `${this.context().key}:device-permission:${source}`,
      permission === "deny" ? "deny" : "ask",
    );
  }
  // Reactions are this device's own marks on messages, kept beside the
  // identity's other local records and never sent to Ark.
  async reactions(): Promise<Record<string, string>> {
    if (!this.signedIn()) return {};
    return (
      (await this.db.get<Record<string, string>>(
        `${this.context().key}:reactions`,
      )) ?? {}
    );
  }
  async setReaction(event_id: string, emoji: string | null) {
    return this.db.update<Record<string, string>>(
      `${this.context().key}:reactions`,
      (reactions) => {
        const next = { ...reactions };
        if (emoji) next[event_id] = emoji;
        else delete next[event_id];
        return next;
      },
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
    this.accountSync()?.changed();
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
    try {
      return await account.updateAccountWorkspace(
        kind,
        changes,
        current.revision,
        this.identity.value!.revision!,
      );
    } catch (error) {
      // An unconfirmed result is checked once by reading Ark; the change is
      // never sent again.
      if ((error as { code?: string }).code !== "unconfirmed") throw error;
      const checked = await this.checkWorkspaceSettings();
      if (checked.change === "applied" || checked.change === "matches_now")
        return checked;
      throw new ApiError(
        409,
        checked.change === "not_applied_yet"
          ? t(
              "The change had not taken effect when Open Muse checked. It may still arrive later; Open Muse notices that at the next change. Nothing was sent again.",
            )
          : t(
              "The change was sent but its result is unconfirmed. Open Muse checks it before anything else is changed; it was not repeated.",
            ),
      );
    }
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
          "With an Open Muse account, Studio reaches only this account's own agent, environment, memory, and sessions.",
        ),
      );
    if (collection in own) {
      if (!param) {
        // Account resources are created only by the service.
        if (op.method !== "GET") throw refuse();
        return {
          filter: (value: unknown) => {
            const page = value as { data?: { id: string }[] };
            return {
              ...page,
              data: (page.data ?? []).filter(
                (row) => row.id === own[collection],
              ),
            };
          },
        };
      }
      if (!target || target !== own[collection]) throw refuse();
      if (!child && ["UpdateAgent", "UpdateEnvironment"].includes(op.id)) {
        if ((input as { confirm?: boolean }).confirm !== true)
          throw new ApiError(
            400,
            t(
              "Confirm the target and impact before modifying cloud resources.",
            ),
          );
        const changes =
          (input as { body?: Record<string, unknown> }).body ?? {};
        if (
          !(
            op.id === "UpdateAgent"
              ? agentChangesSchema
              : environmentChangesSchema
          ).safeParse(changes).success
        )
          throw refuse();
        const result = await this.applyWorkspace(
          op.id === "UpdateAgent" ? "agent" : "environment",
          changes,
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
      const body = (input as { body?: Record<string, unknown> }).body ?? {};
      // Anything a session is given must belong to this account: its own
      // agent and environment, its own memory store, and no shared vaults.
      const ownedResources = (resources: unknown) =>
        resources === undefined ||
        (Array.isArray(resources) &&
          resources.every(
            (item) =>
              (item as { type?: unknown })?.type === "memory_store" &&
              (item as { memory_store_id?: unknown }).memory_store_id ===
                record?.memoryStoreId &&
              Boolean(record?.memoryStoreId),
          ));
      if (!param) {
        if (op.method === "GET")
          return {
            filter: (value: unknown) => {
              const page = value as { data?: Session[] };
              return { ...page, data: (page.data ?? []).filter(mine) };
            },
          };
        const agent = body.agent as
          string | ({ id?: string } & Record<string, unknown>) | undefined;
        const overrides =
          agent && typeof agent === "object" ? agent : ({} as object);
        if (
          op.id !== "CreateSession" ||
          !record?.agentId ||
          (typeof agent === "string" ? agent : agent?.id) !== record.agentId ||
          // Session-level agent overrides may not pull in other agents or
          // uploaded skills.
          "multiagent" in overrides ||
          !accountSkills((overrides as { skills?: unknown }).skills) ||
          Object.keys(body).some(
            (key) =>
              ![
                "agent",
                "environment_id",
                "tags",
                "resources",
                "title",
                "vault_ids",
              ].includes(key),
          ) ||
          (body.environment_id !== undefined &&
            body.environment_id !== record.environmentId) ||
          (body.vault_ids !== undefined &&
            (!Array.isArray(body.vault_ids) || body.vault_ids.length > 0)) ||
          !ownedResources(body.resources)
        )
          throw refuse();
        return;
      }
      if (
        !target ||
        !record?.agentId ||
        !mine(await r.ark.request<Session>(`/sessions/${validId(target)}`))
      )
        throw refuse();
      if (
        op.method !== "GET" &&
        (("vault_ids" in body &&
          (!Array.isArray(body.vault_ids) || body.vault_ids.length > 0)) ||
          (op.id === "CreateSessionResource" && !ownedResources([body])) ||
          ("resources" in body && !ownedResources(body.resources)))
      )
        throw refuse();
      // Messages may reference only files this account uploaded on this
      // device; any other file ID could belong to another key holder.
      const files: string[] = [];
      const collect = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === "object")
          for (const [name, item] of Object.entries(value))
            if (name === "file_id") files.push(String(item));
            else collect(item);
      };
      collect(body);
      if (files.length) {
        const uploaded =
          (await this.db.get<Record<string, string>>(
            `${r.key}:attachment-names`,
          )) ?? {};
        if (files.some((file) => !Object.hasOwn(uploaded, file)))
          throw refuse();
      }
      return;
    }
    // Vaults, credentials, skills, files, and anything else under the shared
    // key cannot be attributed to an account, so an account never reaches them.
    throw refuse();
  }
}
