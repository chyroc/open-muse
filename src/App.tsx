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
  { id: "tasks", path: "/tasks", label: "所有对话", icon: History },
  { id: "studio", path: "/studio", label: "MA 工作台", icon: Blocks },
  { id: "settings", path: "/settings", label: "设置", icon: Settings2 },
] as const;
function navigate(path: string) {
  location.hash = path;
}
const statusNames = {
  idle: "等待开始",
  running: "进行中",
  complete: "本轮已完成",
  attention: "需要确认",
  error: "执行异常",
  stopped: "已停止",
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
        <p>{restoreError || "正在恢复连接…"}</p>
        {restoreError && (
          <button
            className="button primary"
            onClick={() => setRestoreAttempt((value) => value + 1)}
          >
            重试
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
            " 提交未确认时，请先刷新历史记录，避免重复操作。",
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
      `# ${task.session?.title ?? "Muse 任务"}\n\n` +
      task.events
        .filter((event) =>
          ["user.message", "agent.message"].includes(event.type),
        )
        .map(
          (event) =>
            `## ${event.type === "user.message" ? "我" : "Muse"}\n\n${eventText(event)}`,
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
          新对话
        </button>
        <nav aria-label="主导航">
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
          <span className="eyebrow">最近的对话</span>
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
              那些闪过的想法，
              <br />
              都可以从一次对话开始。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="small-note">
            <span className="little-star">✳</span>
            <p>
              少一些琐事，
              <br />
              多一些自己的时间。
            </p>
          </div>
          <a className="account" href="#/settings">
            <span className="avatar">我</span>
            <div>
              <strong>我的空间</strong>
              <small>个人 AI 工作室</small>
            </div>
            <Settings2 size={17} />
          </a>
        </div>
      </aside>
      <main className={`main ${activeId ? "task-main" : ""}`}>
        <header className="topbar">
          <button
            className="icon-button menu-trigger"
            aria-label="打开侧边栏"
            onClick={() => setMoreOpen(true)}
          >
            <Menu size={25} />
          </button>
          <a className="mobile-brand" href="#/">
            <span>muse</span>
          </a>
          <div className="breadcrumb">
            <span>我的空间</span>
            <ChevronRight size={13} />
            <span>
              {activeId
                ? "一起完成"
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
                ? "方舟 Managed Agents"
                : "演示模式 · 未连接模型"
              : "等待连接"}
          </a>
        </header>
        {(loadError || actionError) && (
          <div className="error-banner" role="alert">
            <Unplug size={18} />
            <span>{actionError || loadError}</span>
            <button
              aria-label="重试连接"
              onClick={() => {
                setActionError("");
                void reload();
                void task.refresh();
              }}
            >
              <RefreshCw size={17} />
            </button>
            <a href="#/settings">连接设置</a>
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
              <h1>所有对话</h1>
              <p>
                {runningCount
                  ? `${runningCount} 项任务正在进行，随时回来看看。`
                  : "继续对话，回看进展，拾起还没完成的想法。"}
              </p>
            </div>
            <div className="task-toolbar">
              <div className="segmented">
                {(
                  [
                    { id: "all", label: "全部" },
                    { id: "running", label: "进行中" },
                    { id: "idle", label: "未运行" },
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
                  placeholder="搜索任务"
                  aria-label="搜索任务"
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
                    ? "没有匹配的任务"
                    : "第一件事，从这里开始"}
                </h2>
                <p>
                  {query || filter !== "all"
                    ? "试试其他关键词或筛选条件。"
                    : "把一个想法交给 Muse，它会保存在这里。"}
                </p>
                <button
                  className="button primary"
                  onClick={() => navigate("/")}
                >
                  <Plus size={17} />
                  新建任务
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
                aria-label="返回任务列表"
                href="#/tasks"
              >
                <ArrowLeft size={20} />
              </a>
              <div>
                <h1>{task.session?.title ?? "加载任务…"}</h1>
                <span className={`task-state ${state}`}>
                  <span />
                  {statusNames[state]}
                </span>
                <span className="stream-status">
                  {task.connected ? "实时连接" : "历史同步 / 正在重连"}
                </span>
              </div>
              <button
                className="icon-button"
                aria-label="导出对话"
                title="导出对话"
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
                  这是一场演示对话，内容非模型生成，不执行外部操作。
                </div>
              )}
              {task.error && (
                <div className="inline-error" role="alert">
                  {task.error}
                  <button onClick={() => void task.refresh()}>重试</button>
                </div>
              )}
              {task.loading && <Loading />}
              {!task.loading && !task.events.length && !task.error && (
                <div className="empty-state">
                  <MuseMark large />
                  <h2>说说你的想法</h2>
                  <p>从一句话开始，我们一起把它变成下一步。</p>
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
                        <span>与你一起</span>
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
                            setToast("已收藏到资料库");
                          })
                        }
                      >
                        <Bookmark size={16} />
                        收藏
                      </button>
                    )}
                  </article>
                ))}
              <Activity events={task.events} running={state === "running"} />
              {permissions.some((event) =>
                task.autoApprovalFailures.includes(event.id),
              ) && (
                <div className="inline-error" role="alert">
                  网页工具自动批准未完成。请先刷新历史记录，再手动处理，避免重复提交。
                  <button onClick={() => void task.refresh()}>
                    刷新历史记录
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
                  Muse 正在处理，可以稍后回来继续查看。
                </div>
              )}
              {state === "error" && (
                <div className="inline-error">
                  本轮执行出现异常，请展开执行记录查看原因，再决定是否继续。
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
                      ? "正在自动批准网页搜索与读取…"
                      : "Muse 正在等待你的确认"}
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
                      查看 {permissions.length} 项待确认
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
              <p className="fine-print">AI 也可能出错，重要信息请核实。</p>
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
      <nav className="mobile-nav" aria-label="手机导航">
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
              进行中
            </>
          ) : session.status === "terminated" ? (
            "已终止"
          ) : (
            "可继续对话"
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
      正在加载…
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
          "iOS App 需要填写 Open Muse 服务地址；真机使用 HTTPS，模拟器可使用 http://127.0.0.1:4311。",
        );
      const next = new Client(connection);
      const conf = await next.config();
      await next.sessions();
      setSuccess(true);
      setMessage(`已连接${conf.mode === "ark" ? "方舟模式" : "演示模式"}。`);
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
        <h1>设置</h1>
        <p>选择方舟项目，剩下的准备交给 Muse。</p>
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
            <h2>服务连接</h2>
            <p>手机 App 通过你的服务端连接方舟。</p>
          </div>
          <span className="small-badge">
            {config?.mode === "ark"
              ? "方舟模式"
              : config?.mode === "demo"
                ? "演示模式"
                : "未连接"}
          </span>
        </div>
        <label className="field">
          服务地址
          <input
            type="url"
            autoCapitalize="none"
            spellCheck={false}
            value={endpoint}
            placeholder="留空使用当前网站，手机端填写 HTTPS 地址"
            onChange={(event) => setEndpoint(event.target.value)}
          />
          <small>填写 Open Muse 服务根地址，不是方舟 API 地址。</small>
        </label>
        <label className="field">
          应用访问令牌
          <input
            type="password"
            autoComplete="off"
            value={token}
            placeholder="对应服务端 MUSE_ACCESS_TOKEN"
            onChange={(event) => setToken(event.target.value)}
          />
          <small>
            令牌仅保留在当前客户端会话，不要在这里填写方舟 API Key。
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
          验证并连接
        </button>
      </section>
      <details className="settings-card advanced-connection">
        <summary>高级接入 · 服务端 API Key</summary>
        <div className="settings-card-heading">
          <div className="settings-symbol">
            <ShieldCheck size={21} />
          </div>
          <div>
            <h2>方舟 Managed Agents</h2>
            <p>API Key 始终保留在服务端。</p>
          </div>
        </div>
        <p className="settings-description">
          在服务端的 <code>.env</code>{" "}
          中配置以下变量，然后重启服务。演示与真实会话分别保存，不会自动切换或混用。
        </p>
        <pre className="config-example">
          {
            "MUSE_MODE=ark\nARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3\nARK_API_KEY=你的服务端密钥"
          }
        </pre>
        <div className="info-note">
          <CircleHelp size={17} />
          <span>
            助手和运行环境会自动创建。接入地址与凭据必须属于同一环境，不要混用生产与测试凭据。
          </span>
        </div>
      </details>
      <section className="privacy-grid">
        <div>
          <ShieldCheck size={22} />
          <h3>每一步，都可查看</h3>
          <p>
            网页搜索（web_search）与读取（web_fetch）自动批准，查询词和访问请求会发送至外部服务。
            其他工具请求仍需确认，执行与批准记录保留在任务内。
          </p>
        </div>
        <div>
          <Unplug size={22} />
          <h3>未连接，不假装完成</h3>
          <p>
            演示模式不调用模型、不发送邮件、不执行支付。真实模式只使用已配置的工具能力。
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
          了解火山方舟
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}
