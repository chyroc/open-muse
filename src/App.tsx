import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Bookmark,
  History,
  Menu,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Compass,
  ExternalLink,
  House,
  Layers3,
  Blocks,
  LoaderCircle,
  MessageCircle,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Unplug,
  X,
} from "lucide-react";
import {
  Client,
  savedConnection,
  saveConnection,
  validateEndpoint,
  type Connection,
} from "./api";
import { useTask } from "./useTask";
import { categories, templates } from "./content";
import {
  Activity,
  Artwork,
  CategoryIcon,
  Composer,
  dateLabel,
  Markdown,
  MuseMark,
  PermissionCard,
} from "./components";
import type {
  AgentEvent,
  AppConfig,
  Category,
  Session,
  Goal,
} from "../shared/types";
import { eventText, pendingPermissions, taskState } from "../shared/types";
import { canAutoApprove } from "../shared/approval-policy";
import { AuthPanel } from "./AuthPanel";
import { WorkspacePanel } from "./WorkspacePanel";
import { Studio } from "./Studio";
import { nativeMobile, exportText } from "./platform";
import {
  ChatWelcome,
  FeedPage,
  GoalsPage,
  IdeasPage,
  LibraryPage,
  MoreMenu,
  primaryNavigation,
  goalPrompt,
} from "./MusePages";

type Tab =
  | "home"
  | "tasks"
  | "discover"
  | "settings"
  | "studio"
  | "feed"
  | "goals"
  | "library";
const navItems = [
  ...primaryNavigation,
  { id: "tasks", path: "/tasks", label: "All conversations", icon: History },
  { id: "studio", path: "/studio", label: "MA Studio", icon: Blocks },
  { id: "settings", path: "/settings", label: "Settings", icon: Settings2 },
] as const;
function navigate(path: string) {
  location.hash = path;
}
const statusNames = {
  idle: "Idle",
  running: "Running",
  complete: "Turn complete",
  attention: "Needs approval",
  error: "Error",
  stopped: "Stopped",
};

export default function App() {
  const [connection, setConnection] = useState(savedConnection);
  const [revision, setRevision] = useState(0);
  const client = useMemo(() => new Client(connection), [connection]);
  const [restored, setRestored] = useState<Client>();
  const [restoreError, setRestoreError] = useState("");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setRestoreError("");
    void client
      .restoreSSOToken()
      .then(() => {
        if (active) setRestored(client);
      })
      .catch((error: Error) => {
        if (active) setRestoreError(error.message);
      });
    return () => {
      active = false;
    };
  }, [client, restoreAttempt]);
  useEffect(() => {
    if (
      nativeMobile() &&
      !connection.baseUrl &&
      (!location.hash || location.hash === "#/")
    )
      navigate("/settings");
  }, [connection.baseUrl]);
  // Do not make anonymous/demo requests before native identity restoration.
  if (restored !== client)
    return (
      <main className="settings-card" aria-live="polite">
        <p>{restoreError || "Restoring connection…"}</p>
        {restoreError && (
          <button
            className="button primary"
            onClick={() => setRestoreAttempt((value) => value + 1)}
          >
            Retry
          </button>
        )}
      </main>
    );
  return (
    <Workspace
      key={revision}
      client={client}
      onConnection={(next) => {
        saveConnection(next);
        setConnection(next);
        setRevision((value) => value + 1);
        navigate("/settings");
      }}
    />
  );
}

function Workspace({
  client,
  onConnection,
}: {
  client: Client;
  onConnection: (connection: Connection) => void;
}) {
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  const activeId = route.startsWith("/task/") ? route.slice(6) : undefined;
  const tab: Tab = activeId
    ? "home"
    : (navItems.find((item) => item.path === route)?.id ?? "home");
  const [moreOpen, setMoreOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState<Goal>();
  const [config, setConfig] = useState<AppConfig>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [draft, setDraft] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<Category>("general");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "idle">("all");
  const task = useTask(client, activeId);
  const pendingTools = pendingPermissions(task.events);
  const permissions = pendingTools.filter(
    (event) =>
      !canAutoApprove(event) || task.autoApprovalFailures.includes(event.id),
  );
  const automaticCount = pendingTools.length - permissions.length;
  const state =
    automaticCount > 0 && permissions.length === 0
      ? "running"
      : taskState(task.events, task.session?.status);
  const alive = useRef(true);
  const [toast, setToast] = useState("");
  const lastEventId = task.events.at(-1)?.id;
  const lastStatusId = [...task.events]
    .reverse()
    .find((event) => event.type.startsWith("session.status_"))?.id;
  const conversationBody = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onRoute = () => {
      setRoute(location.hash.slice(1) || "/");
      setActionError("");
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onRoute);
    return () => window.removeEventListener("hashchange", onRoute);
  }, []);
  const reload = useCallback(async () => {
    try {
      const conf = await client.config();
      if (!alive.current) return;
      setConfig(conf);
      const result = await client.sessions();
      if (!alive.current) return;
      setSessions(result.data);
      setLoadError("");
    } catch (error) {
      if (alive.current) setLoadError((error as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    alive.current = true;
    void reload();
    const interval = setInterval(() => {
      if (!document.hidden) void reload();
    }, 15000);
    return () => {
      alive.current = false;
      clearInterval(interval);
    };
  }, [reload]);
  useEffect(() => {
    if (lastStatusId) void reload();
  }, [lastStatusId, reload]);
  useEffect(() => {
    const body = conversationBody.current;
    if (
      body &&
      (body.scrollHeight - body.clientHeight - body.scrollTop < 350 ||
        permissions.length > 0)
    )
      body.scrollTop = body.scrollHeight;
  }, [lastEventId, permissions.length]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timeout);
  }, [toast]);

  async function action(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      await fn();
      await reload();
    } catch (error) {
      if (alive.current)
        setActionError(
          (error as Error).message +
            " If the submission is unconfirmed, refresh the history first to avoid doing it twice.",
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const createTask = () =>
    action(async () => {
      const text = draft.trim();
      if (!text) return;
      if (config?.mode === "ark") await client.prepareWorkspace();
      const session = await client.create(
        goalDraft ? goalDraft.title.slice(0, 100) : text.slice(0, 60),
        category,
      );
      if (!alive.current) return;
      setSessions((current) => [session, ...current]);
      setDrafts((current) => ({ ...current, [session.id]: text }));
      navigate(`/task/${session.id}`);
      if (goalDraft) {
        await client.updateGoal(goalDraft.id, { session_id: session.id });
        setGoalDraft(undefined);
      }
      setDraft("");
      await client.send(session.id, { type: "user.message", text });
      if (alive.current)
        setDrafts((current) => ({ ...current, [session.id]: "" }));
    });
  const sendMessage = () =>
    action(async () => {
      if (!activeId || !drafts[activeId]?.trim()) return;
      const text = drafts[activeId].trim();
      await client.send(activeId, { type: "user.message", text });
      if (alive.current)
        setDrafts((current) => ({ ...current, [activeId]: "" }));
      await task.refresh();
    });
  const stop = () =>
    action(async () => {
      if (activeId) {
        await client.send(activeId, { type: "user.interrupt" });
        await task.refresh();
      }
    });
  const confirm = (result: "allow" | "deny", event: AgentEvent) =>
    action(async () => {
      if (activeId) {
        await client.send(activeId, {
          type: "user.tool_confirmation",
          tool_use_id: event.id,
          result,
        });
        await task.refresh();
      }
    });
  function useTemplate(template: (typeof templates)[number]) {
    setGoalDraft(undefined);
    setDraft(template.prompt);
    setCategory(template.category);
    navigate("/");
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>(".composer textarea")
        ?.focus(),
    );
  }
  async function exportTask() {
    const text =
      `# ${task.session?.title ?? "Muse task"}\n\n` +
      task.events
        .filter((event) =>
          ["user.message", "agent.message"].includes(event.type),
        )
        .map(
          (event) =>
            `## ${event.type === "user.message" ? "Me" : "Muse"}\n\n${eventText(event)}`,
        )
        .join("\n\n");
    try {
      setToast(await exportText(`muse-${activeId}.md`, text));
    } catch (error) {
      setActionError((error as Error).message);
    }
  }
  const runningCount = sessions.filter((session) =>
    ["running", "rescheduling"].includes(session.status),
  ).length;
  const visibleSessions = sessions.filter(
    (session) =>
      (!query || session.title.toLowerCase().includes(query.toLowerCase())) &&
      (filter === "all" ||
        (filter === "running"
          ? ["running", "rescheduling"].includes(session.status)
          : !["running", "rescheduling"].includes(session.status))),
  );

  return (
    <div
      className={`app-shell muse-shell ${tab === "home" && !activeId ? "welcome-shell" : ""}`}
    >
      <aside className="sidebar">
        <a className="brand" href="#/">
          <MuseMark />
          <span>
            muse<span className="brand-dot">.</span>
          </span>
          <small>OPEN</small>
        </a>
        <button
          className="new-task button primary"
          onClick={() => {
            setDraft("");
            setGoalDraft(undefined);
            setCategory("general");
            navigate("/");
          }}
        >
          <Plus size={18} />
          New conversation
        </button>
        <nav aria-label="Main navigation">
          {navItems.map((item) => (
            <a
              key={item.id}
              className={tab === item.id ? "active" : ""}
              aria-current={tab === item.id ? "page" : undefined}
              href={`#${item.path}`}
            >
              <item.icon size={19} strokeWidth={1.7} />
              {item.label}
              {item.id === "tasks" && runningCount > 0 && (
                <span className="nav-count">{runningCount}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-recents">
          <span className="eyebrow">Recent conversations</span>
          {sessions.slice(0, 5).map((session) => (
            <a
              key={session.id}
              href={`#/task/${session.id}`}
              className={activeId === session.id ? "selected" : ""}
            >
              <MessageCircle size={14} />
              <span>{session.title}</span>
            </a>
          ))}
          {!sessions.length && (
            <p>
              Every passing thought can
              <br />
              start with a single conversation.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="small-note">
            <span className="little-star">✳</span>
            <p>
              Fewer little chores,
              <br />
              more time for yourself.
            </p>
          </div>
          <a className="account" href="#/settings">
            <span className="avatar">Me</span>
            <div>
              <strong>My Space</strong>
              <small>Personal AI studio</small>
            </div>
            <Settings2 size={17} />
          </a>
        </div>
      </aside>
      <main className={`main ${activeId ? "task-main" : ""}`}>
        <header className="topbar">
          <button
            className="icon-button menu-trigger"
            aria-label="Open sidebar"
            onClick={() => setMoreOpen(true)}
          >
            <Menu size={25} />
          </button>
          <a className="mobile-brand" href="#/">
            <span>muse</span>
          </a>
          <div className="breadcrumb">
            <span>My Space</span>
            <ChevronRight size={13} />
            <span>
              {activeId
                ? "Let's do this together"
                : navItems.find((item) => item.id === tab)?.label}
            </span>
          </div>
          <a
            href="#/settings"
            className={`mode-badge ${config?.mode === "ark" ? "live" : ""}`}
          >
            <span />
            {config
              ? config.mode === "ark"
                ? "Ark Managed Agents"
                : "Demo mode · no model connected"
              : "Waiting to connect"}
          </a>
        </header>
        {(loadError || actionError) && (
          <div className="error-banner" role="alert">
            <Unplug size={18} />
            <span>{actionError || loadError}</span>
            <button
              aria-label="Retry connection"
              onClick={() => {
                setActionError("");
                void reload();
                void task.refresh();
              }}
            >
              <RefreshCw size={17} />
            </button>
            <a href="#/settings">Connection settings</a>
          </div>
        )}

        {tab === "home" && !activeId && (
          <ChatWelcome
            sessions={sessions}
            onTemplate={useTemplate}
            goal={goalDraft}
            onClearGoal={() => setGoalDraft(undefined)}
            composer={
              <Composer
                value={draft}
                setValue={setDraft}
                onSend={createTask}
                busy={busy}
                category={category}
                setCategory={setCategory}
                disabled={!config || Boolean(loadError)}
              />
            }
          />
        )}
        {tab === "discover" && <IdeasPage onTemplate={useTemplate} />}
        {tab === "feed" && <FeedPage sessions={sessions} loading={loading} />}
        {tab === "goals" && (
          <GoalsPage
            client={client}
            onStart={(goal) => {
              setGoalDraft(goal);
              setCategory("general");
              setDraft(goalPrompt(goal));
              navigate("/");
            }}
          />
        )}
        {tab === "library" && <LibraryPage client={client} />}

        {tab === "tasks" && !activeId && (
          <div className="page-content page-in">
            <div className="page-title">
              <span className="eyebrow">YOUR IDEAS, IN MOTION</span>
              <h1>All conversations</h1>
              <p>
                {runningCount
                  ? `${runningCount} task${runningCount === 1 ? "" : "s"} in progress — check back anytime.`
                  : "Pick up a conversation, review progress, and revisit ideas still in motion."}
              </p>
            </div>
            <div className="task-toolbar">
              <div className="segmented">
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "running", label: "Running" },
                    { id: "idle", label: "Idle" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    className={filter === item.id ? "selected" : ""}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="search-box">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tasks"
                  aria-label="Search tasks"
                />
              </label>
            </div>
            {loading ? (
              <Loading />
            ) : visibleSessions.length ? (
              <div className="task-list full">
                {visibleSessions.map((session) => (
                  <SessionRow key={session.id} session={session} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Layers3 size={34} />
                <h2>
                  {query || filter !== "all"
                    ? "No matching tasks"
                    : "Start your first thing here"}
                </h2>
                <p>
                  {query || filter !== "all"
                    ? "Try a different keyword or filter."
                    : "Hand an idea to Muse and it'll be saved here."}
                </p>
                <button
                  className="button primary"
                  onClick={() => navigate("/")}
                >
                  <Plus size={17} />
                  New task
                </button>
              </div>
            )}
          </div>
        )}

        {activeId && (
          <div className="conversation page-in" key={activeId}>
            <header className="conversation-header">
              <a
                className="icon-button"
                aria-label="Back to conversations"
                href="#/tasks"
              >
                <ArrowLeft size={20} />
              </a>
              <div>
                <h1>{task.session?.title ?? "Loading task…"}</h1>
                <span className={`task-state ${state}`}>
                  <span />
                  {statusNames[state]}
                </span>
                <span className="stream-status">
                  {task.connected
                    ? "Live connection"
                    : "History sync / reconnecting"}
                </span>
              </div>
              <button
                className="icon-button"
                aria-label="Export conversation"
                title="Export conversation"
                disabled={
                  !task.events.some((event) => event.type === "agent.message")
                }
                onClick={exportTask}
              >
                <ArrowDownToLine size={19} />
              </button>
            </header>
            <div className="conversation-body" ref={conversationBody}>
              {config?.mode === "demo" && (
                <div className="demo-notice">
                  <Sparkles size={14} />
                  This is a demo conversation. Its content is not
                  model-generated and no external actions are performed.
                </div>
              )}
              {task.error && (
                <div className="inline-error" role="alert">
                  {task.error}
                  <button onClick={() => void task.refresh()}>Retry</button>
                </div>
              )}
              {task.loading && <Loading />}
              {!task.loading && !task.events.length && !task.error && (
                <div className="empty-state">
                  <MuseMark large />
                  <h2>Tell me what's on your mind</h2>
                  <p>
                    Start with one line, and we'll turn it into the next step
                    together.
                  </p>
                </div>
              )}
              {task.events
                .filter((event) =>
                  ["user.message", "agent.message"].includes(event.type),
                )
                .map((event) => (
                  <article
                    className={`message ${event.type === "user.message" ? "user-message" : "assistant-message"}`}
                    key={event.id}
                  >
                    {event.type === "agent.message" && (
                      <div className="assistant-label">
                        <MuseMark />
                        <strong>Muse</strong>
                        <span>with you</span>
                      </div>
                    )}
                    <Markdown text={eventText(event)} />
                    {event.type === "agent.message" && (
                      <button
                        className="save-reply text-button"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await client.saveReply(activeId, event.id);
                            setToast("Saved to Library");
                          })
                        }
                      >
                        <Bookmark size={16} />
                        Save
                      </button>
                    )}
                  </article>
                ))}
              <Activity events={task.events} running={state === "running"} />
              {permissions.some((event) =>
                task.autoApprovalFailures.includes(event.id),
              ) && (
                <div className="inline-error" role="alert">
                  Automatic approval of web tools didn't finish. Refresh the
                  history first, then handle it manually to avoid duplicate
                  submissions.
                  <button onClick={() => void task.refresh()}>
                    Refresh history
                  </button>
                </div>
              )}
              {permissions.map((event) => (
                <PermissionCard
                  key={event.id}
                  event={event}
                  busy={busy || automaticCount > 0}
                  onConfirm={confirm}
                />
              ))}
              {state === "running" && (
                <div className="working-note">
                  <span className="working-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  Muse is working — come back and check in a little later.
                </div>
              )}
              {state === "error" && (
                <div className="inline-error">
                  Something went wrong this turn. Expand the activity log to see
                  the cause, then decide whether to continue.
                </div>
              )}
            </div>
            <div className="conversation-composer">
              {pendingTools.length > 0 ? (
                <p className="approval-hint">
                  <span>
                    {automaticCount > 0 ? (
                      <LoaderCircle
                        size={14}
                        className="spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ShieldCheck size={14} aria-hidden="true" />
                    )}
                    {automaticCount > 0
                      ? "Automatically approving web searches and reads…"
                      : "Muse is waiting for your approval"}
                  </span>
                  {permissions.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        conversationBody.current
                          ?.querySelector(".permission-card")
                          ?.scrollIntoView({
                            block: "start",
                            behavior: "smooth",
                          })
                      }
                    >
                      View {permissions.length} pending approval
                      {permissions.length === 1 ? "" : "s"}
                    </button>
                  )}
                </p>
              ) : (
                <Composer
                  value={drafts[activeId] ?? ""}
                  setValue={(value) =>
                    setDrafts((current) => ({ ...current, [activeId]: value }))
                  }
                  onSend={sendMessage}
                  busy={busy}
                  running={state === "running"}
                  onStop={stop}
                  category={task.session?.category ?? "general"}
                  compact
                  disabled={
                    !task.session || task.session.status === "terminated"
                  }
                />
              )}
              <p className="fine-print">
                AI can make mistakes. Please verify important information.
              </p>
            </div>
          </div>
        )}

        {tab === "studio" && !activeId && (
          <Studio client={client} config={config} />
        )}
        {tab === "settings" && !activeId && (
          <Settings
            client={client}
            config={config}
            onConnection={onConnection}
          />
        )}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {primaryNavigation.map((item) => (
          <a
            key={item.id}
            href={`#${item.path}`}
            aria-label={item.label}
            aria-current={tab === item.id ? "page" : undefined}
            className={tab === item.id ? "active" : ""}
          >
            <item.icon size={28} strokeWidth={1.8} />
          </a>
        ))}
      </nav>
      {moreOpen && (
        <MoreMenu sessions={sessions} onClose={() => setMoreOpen(false)} />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session }: { session: Session }) {
  const running = ["running", "rescheduling"].includes(session.status);
  return (
    <a className="session-row" href={`#/task/${session.id}`}>
      <span className={`session-icon ${session.category}`}>
        <CategoryIcon category={session.category} />
      </span>
      <div className="session-copy">
        <h3>{session.title}</h3>
        <p>{session.preview ?? categories[session.category]}</p>
      </div>
      <div className="session-meta">
        <span className={running ? "running-text" : ""}>
          {running ? (
            <>
              <span className="status-dot" />
              Running
            </>
          ) : session.status === "terminated" ? (
            "Ended"
          ) : (
            "Ready to continue"
          )}
        </span>
        <time>{dateLabel(session.updated_at)}</time>
      </div>
      <ChevronRight size={16} />
    </a>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      Loading…
    </div>
  );
}

function Settings({
  client,
  config,
  onConnection,
}: {
  client: Client;
  config?: AppConfig;
  onConnection: (connection: Connection) => void;
}) {
  const [endpoint, setEndpoint] = useState(client.connection.baseUrl);
  const [token, setToken] = useState(client.connection.token);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  async function connect() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setSuccess(false);
    try {
      const connection = {
        baseUrl: validateEndpoint(endpoint),
        token: token.trim(),
      };
      if (nativeMobile() && !connection.baseUrl)
        throw new Error(
          "The iOS app needs an Open Muse service URL; use HTTPS on a real device, or http://127.0.0.1:4311 in the simulator.",
        );
      const next = new Client(connection);
      const conf = await next.config();
      await next.sessions();
      setSuccess(true);
      setMessage(
        `Connected in ${conf.mode === "ark" ? "Ark mode" : "demo mode"}.`,
      );
      onConnection(connection);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-content settings-page page-in">
      <div className="page-title">
        <span className="eyebrow">MAKE YOURSELF AT HOME</span>
        <h1>Settings</h1>
        <p>Pick an Ark project and leave the rest of the setup to Muse.</p>
      </div>
      <AuthPanel
        client={client}
        onChanged={() => onConnection(client.connection)}
      />
      {config?.mode === "ark" && !client.ssoToken() && (
        <WorkspacePanel client={client} />
      )}
      <section className="settings-card">
        <div className="settings-card-heading">
          <div className="settings-symbol">
            <Radio size={21} />
          </div>
          <div>
            <h2>Service connection</h2>
            <p>The mobile app connects to Ark through your server.</p>
          </div>
          <span className="small-badge">
            {config?.mode === "ark"
              ? "Ark mode"
              : config?.mode === "demo"
                ? "Demo mode"
                : "Not connected"}
          </span>
        </div>
        <label className="field">
          Service URL
          <input
            type="url"
            autoCapitalize="none"
            spellCheck={false}
            value={endpoint}
            placeholder="Leave blank to use this site; on mobile enter an HTTPS URL"
            onChange={(event) => setEndpoint(event.target.value)}
          />
          <small>
            Enter the Open Muse service root URL, not an Ark API URL.
          </small>
        </label>
        <label className="field">
          App access token
          <input
            type="password"
            autoComplete="off"
            value={token}
            placeholder="Matches the server's MUSE_ACCESS_TOKEN"
            onChange={(event) => setToken(event.target.value)}
          />
          <small>
            The token stays only in this client session. Don't enter an Ark API
            Key here.
          </small>
        </label>
        {message && (
          <p className={success ? "success-text" : "error-text"} role="status">
            {message}
          </p>
        )}
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          Verify and connect
        </button>
      </section>
      <details className="settings-card advanced-connection">
        <summary>Advanced setup · server-side API Key</summary>
        <div className="settings-card-heading">
          <div className="settings-symbol">
            <ShieldCheck size={21} />
          </div>
          <div>
            <h2>Ark Managed Agents</h2>
            <p>The API Key always stays on the server.</p>
          </div>
        </div>
        <p className="settings-description">
          Configure the variables below in the server's <code>.env</code> file,
          then restart the service. Demo and real sessions are stored separately
          and are never switched or mixed automatically.
        </p>
        <pre className="config-example">
          {
            "MUSE_MODE=ark\nARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3\nARK_API_KEY=your-server-side-secret"
          }
        </pre>
        <div className="info-note">
          <CircleHelp size={17} />
          <span>
            The assistant and runtime are created automatically. The endpoint
            and credentials must belong to the same environment; don't mix
            production and test credentials.
          </span>
        </div>
      </details>
      <section className="privacy-grid">
        <div>
          <ShieldCheck size={22} />
          <h3>Every step is visible</h3>
          <p>
            Tools in new tasks run directly by default and may send data to
            external services, perform writes or deletions, and incur charges.
            Explicit upstream denials still apply, and execution records stay
            inside the task.
          </p>
        </div>
        <div>
          <Unplug size={22} />
          <h3>No connection, no pretend completion</h3>
          <p>
            Demo mode doesn't call models, send emails, or make payments. Real
            mode uses only the tools you've configured.
          </p>
        </div>
      </section>
      <div className="about-line">
        <span>
          <MuseMark />
          Open Muse <small>v0.2.0</small>
        </span>
        <a
          href="https://www.volcengine.com/product/ark"
          target="_blank"
          rel="noreferrer"
        >
          Learn about Volcano Ark
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}
