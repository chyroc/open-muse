import { formatLocale, systemLanguage, t } from "../shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import { Client } from "./api";
import { CompanionSheet } from "./CompanionSheet";
import { defaultIdentity } from "./direct/identity";
import { useTask } from "./useTask";
import { discussionPrompt, type InspirationItem } from "../shared/inspiration";
import { InspirationPage } from "./InspirationPages";
import { GoalsPage } from "./GoalsPage";
import { AssistantMessage } from "./ChoiceMessage";
import { WelcomeStatus } from "./WelcomeStatus";
import type { WelcomeState } from "./direct/welcome";
import { isWelcomeReply } from "../shared/welcome";
import { currentChoiceEvent } from "../shared/chat-choices";
import { digest } from "../shared/crypto";
import { goalPrompt, goalStarter, type GoalCategory } from "../shared/goals";
import { Activity, Markdown, MuseMark, PermissionCard } from "./components";
import type {
  AgentEvent,
  AppConfig,
  Category,
  Goal,
  Session,
} from "../shared/types";
import { eventText, pendingPermissions, taskState } from "../shared/types";
import { canAutoApprove } from "../shared/approval-policy";
import { AuthPanel } from "./AuthPanel";
import { Studio } from "./Studio";
import { exportText } from "./platform";
import { Sheet, primaryNavigation } from "./MusePages";
import { LibraryPage } from "./LibraryPage";
import {
  ChatActions,
  ChatComposer,
  ChatHeader,
  CompanionAvatar,
  ConversationSidebar,
  MessageBubble,
  ScrollToLatest,
} from "./ChatUI";
import {
  emptyConversations,
  currentConversation,
  type ConversationIndex,
} from "./direct/conversations";

function navigate(path: string) {
  location.hash = path;
}

export default function App() {
  const [revision, setRevision] = useState(0);
  const client = useMemo(
    () =>
      new Client({
        scope: (
          globalThis as typeof globalThis & { __MUSE_TEST_PROFILE__?: string }
        ).__MUSE_TEST_PROFILE__,
      }),
    [],
  );
  const [restored, setRestored] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setRestoreError("");
    void client
      .restore()
      .then(() => {
        if (active) setRestored(true);
      })
      .catch((error: Error) => {
        if (active) setRestoreError(error.message);
      });
    return () => {
      active = false;
    };
  }, [client, restoreAttempt]);
  if (!restored)
    return (
      <main className="restore-screen" aria-live="polite">
        <CompanionAvatar />
        <p>{restoreError || t("Restoring connection…")}</p>
        {restoreError && (
          <button
            className="button primary"
            onClick={() => setRestoreAttempt((value) => value + 1)}
          >
            {t("Retry")}
          </button>
        )}
      </main>
    );
  return (
    <Workspace
      key={revision}
      client={client}
      onConnection={() => {
        setRevision((value) => value + 1);
        navigate(client.signedIn() ? "/" : "/settings");
      }}
    />
  );
}

function Workspace({
  client,
  onConnection,
}: {
  client: Client;
  onConnection: () => void;
}) {
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  const [index, setIndex] = useState<ConversationIndex>(emptyConversations);
  const isSideDraft = route === "/new";
  const taskRoute = route.startsWith("/task/") ? route.slice(6) : undefined;
  const tab =
    taskRoute || isSideDraft
      ? "home"
      : route === "/settings"
        ? "settings"
        : route === "/studio"
          ? "studio"
          : (primaryNavigation.find((item) => item.path === route)?.id ??
            "home");
  const activeId =
    tab === "home"
      ? taskRoute
        ? currentConversation(index, taskRoute)
        : isSideDraft
          ? undefined
          : index.mainId
      : undefined;
  const [sidebarOpen, setSidebarOpen] = useState(route === "/tasks");
  const [panel, setPanel] = useState<"actions" | "status">();
  const [selectedMessage, setSelectedMessage] = useState<AgentEvent>();
  const [goalDraft, setGoalDraft] = useState<Goal>();
  const [goalInitiation, setGoalInitiation] = useState(false);
  const [goalOptions, setGoalOptions] = useState(false);
  const [inspirationDraft, setInspirationDraft] = useState<InspirationItem>();
  const [feedEditor, setFeedEditor] = useState(false);
  const [config, setConfig] = useState<AppConfig>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [companion, setCompanion] = useState(defaultIdentity);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState<WelcomeState>();
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [welcomeError, setWelcomeError] = useState("");
  const checkedWelcome = useRef(false);
  const welcomeJob = useRef(false);
  const busyRef = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<Category>("general");
  const draftKey = activeId ?? (isSideDraft ? "new-side" : "new-main");
  const draft = drafts[draftKey] ?? "";
  const task = useTask(client, activeId);
  const events = task.session?.id === activeId ? task.events : [];
  const currentEvents = events.filter(
    (event) => !event.source_session_id || event.source_session_id === activeId,
  );
  const pendingTools = pendingPermissions(currentEvents);
  const permissions = pendingTools.filter(
    (event) =>
      !canAutoApprove(event) || task.autoApprovalFailures.includes(event.id),
  );
  const automaticCount = pendingTools.length - permissions.length;
  const state =
    automaticCount > 0 && !permissions.length
      ? "running"
      : taskState(
          currentEvents,
          task.session?.id === activeId ? task.session?.status : undefined,
        );
  const alive = useRef(true);
  const [toast, setToast] = useState("");
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const initialScroll = useRef<string | undefined>(undefined);
  const lastEventId = events.at(-1)?.id;
  const lastStatusId = [...events]
    .reverse()
    .find((event) => event.type.startsWith("session.status_"))?.id;
  const conversationBody = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onRoute = () => {
      const next = location.hash.slice(1) || "/";
      setRoute(next);
      if (next === "/tasks") setSidebarOpen(true);
      setActionError("");
      setSelectedMessage(undefined);
      setPanel(undefined);
      setGoalOptions(false);
    };
    window.addEventListener("hashchange", onRoute);
    return () => window.removeEventListener("hashchange", onRoute);
  }, []);
  const reload = useCallback(async () => {
    try {
      const conf = await client.config();
      if (!alive.current) return;
      setConfig(conf);
      if (conf.mode !== "ark") {
        setSessions([]);
        setIndex(emptyConversations());
        setLoadError("");
        return;
      }
      const [result, conversations] = await Promise.all([
        client.sessions(),
        client.conversationIndex(),
      ]);
      if (!alive.current) return;
      setSessions(result.data);
      setIndex(conversations);
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
  async function beginWelcome(retry = false) {
    if (welcomeJob.current) return;
    welcomeJob.current = true;
    setWelcomeBusy(true);
    setWelcomeError("");
    try {
      const value = await client.startWelcome(systemLanguage(), retry);
      if (alive.current) setWelcome(value);
    } catch (error) {
      if (alive.current) {
        setWelcomeError((error as Error).message);
        const value = await client.welcomeState().catch(() => undefined);
        if (alive.current) setWelcome(value);
      }
    } finally {
      welcomeJob.current = false;
      if (alive.current) {
        setWelcomeBusy(false);
        await reload();
      }
    }
  }
  useEffect(() => {
    if (
      loading ||
      config?.mode !== "ark" ||
      Boolean(loadError) ||
      tab !== "home" ||
      isSideDraft ||
      taskRoute ||
      checkedWelcome.current
    )
      return;
    checkedWelcome.current = true;
    void beginWelcome();
  }, [client, loading, config?.mode, loadError, tab, isSideDraft, taskRoute]);
  useEffect(() => {
    if (config?.mode !== "ark" || !lastStatusId) return;
    let active = true;
    void client
      .welcomeState()
      .then((value) => {
        if (active) {
          setWelcome(value);
          if (value?.phase === "confirmed" || value?.phase === "skipped")
            setWelcomeError("");
        }
      })
      .catch(() => {
        /* History exposes storage failures; do not restart setup. */
      });
    return () => {
      active = false;
    };
  }, [client, config?.mode, lastStatusId]);
  useEffect(() => {
    let active = true;
    void client
      .companionIdentity()
      .then((value) => {
        if (active) setCompanion(value);
      })
      .catch(() => {
        /* The identity sheet exposes read failures without blocking chat history. */
      });
    return () => {
      active = false;
    };
  }, [client, lastStatusId]);
  useEffect(() => {
    const body = conversationBody.current;
    if (!body || task.loading) return;
    if (initialScroll.current !== activeId || !awayFromBottom) {
      body.scrollTop = body.scrollHeight;
      initialScroll.current = activeId;
    }
  }, [activeId, lastEventId, task.loading, awayFromBottom]);
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
      if (alive.current) await reload();
    } catch (error) {
      if (alive.current)
        setActionError(
          (error as Error).message +
            t(
              "If submission is unconfirmed, refresh history before trying again.",
            ),
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function newSideChat() {
    setGoalDraft(undefined);
    setGoalInitiation(false);
    setInspirationDraft(undefined);
    setCategory("general");
    navigate("/new");
  }
  function setDraft(value: string) {
    setDrafts((current) => ({ ...current, [draftKey]: value }));
  }
  const sendMessage = () =>
    action(async () => {
      const text = draft.trim();
      if (!text) return;
      if (goalInitiation || goalDraft) await client.prepareGoals();
      let sessionId = activeId;
      if (!sessionId || sessionId === index.mainId) {
        const session = await client.openConversation(
          isSideDraft ? "side" : "main",
          isSideDraft
            ? (goalDraft?.title ?? text).slice(0, 60)
            : t("Main chat"),
          category,
        );
        if (!alive.current) return;
        sessionId = session.id;
        const conversations = await client.conversationIndex();
        if (!alive.current) return;
        setIndex(conversations);
        setDrafts((current) => ({
          ...current,
          [draftKey]: "",
          [session.id]: text,
        }));
        if (isSideDraft) navigate(`/task/${session.id}`);
        else if (taskRoute && taskRoute !== session.id) navigate("/");
        if (goalDraft) {
          await client.updateGoal(goalDraft.id, { session_id: session.id });
          setGoalDraft(undefined);
        }
        if (inspirationDraft) {
          await client.linkInspirationDiscussion(
            inspirationDraft.id,
            session.id,
          );
          setInspirationDraft(undefined);
        }
      }
      if (!alive.current) return;
      await client.send(sessionId, { type: "user.message", text });
      if (alive.current) {
        setGoalInitiation(false);
        setDrafts((current) => ({ ...current, [sessionId!]: "" }));
        setAwayFromBottom(false);
        await task.refresh();
      }
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
  function discussInspiration(item: InspirationItem) {
    setGoalInitiation(false);
    if (item.discussion_id) {
      navigate(`/task/${item.discussion_id}`);
      return;
    }
    setGoalDraft(undefined);
    setInspirationDraft(item);
    setCategory("general");
    setDrafts((current) => ({
      ...current,
      "new-side": discussionPrompt(item),
    }));
    navigate("/new");
  }
  async function exportConversation() {
    const text =
      `# ${index.entries[activeId ?? ""]?.title ?? task.session?.title ?? t("Main chat")}\n\n` +
      events
        .filter(
          (event) =>
            !event.app_initiation &&
            ["user.message", "agent.message"].includes(event.type),
        )
        .map(
          (event) =>
            `## ${event.type === "user.message" ? t("Me") : companion.name}\n\n${eventText(event)}`,
        )
        .join("\n\n");
    try {
      setToast(await exportText(`muse-${activeId}.md`, text));
    } catch (error) {
      setActionError((error as Error).message);
    }
  }
  const sideTitle = isSideDraft
    ? t("New side chat")
    : taskRoute && activeId !== index.mainId
      ? (index.entries[taskRoute]?.title ?? task.session?.title)
      : undefined;
  const status =
    config?.mode !== "ark"
      ? t("Not connected")
      : state === "running"
        ? t("Replying")
        : permissions.length
          ? t("Waiting for approval")
          : task.error || loadError
            ? t("Connection interrupted")
            : t("Connected");
  const messageEvents = events.filter(
    (event) =>
      ["user.message", "agent.message"].includes(event.type) &&
      !event.app_initiation &&
      eventText(event),
  );
  const isChat = tab === "home";
  return (
    <div className="app-shell muse-shell companion-shell">
      <main
        className={`companion-main ${isChat ? "chat-page" : "content-page"}`}
      >
        {tab !== "settings" && tab !== "studio" ? (
          <ChatHeader
            name={companion.name}
            onSidebar={() => setSidebarOpen(true)}
            onStatus={() => setPanel("status")}
            onMore={() =>
              tab === "feed"
                ? setFeedEditor(true)
                : tab === "goals"
                  ? setGoalOptions(true)
                  : setPanel("actions")
            }
            moreLabel={tab === "goals" ? t("Goals options") : undefined}
            feed={tab === "feed"}
            showSidebar={isChat}
            showMore={tab !== "discover"}
            status={status}
            sideTitle={sideTitle}
          />
        ) : (
          <header className="utility-header">
            <a
              className="glass-button"
              href="#/"
              aria-label={t("Back to chat")}
            >
              <ArrowLeft size={22} />
            </a>
            <strong>{tab === "settings" ? t("Settings") : "MA Studio"}</strong>
            <span />
          </header>
        )}
        <div className="connection-notices">
          {config?.mode === "disconnected" && tab !== "settings" && (
            <a className="connect-notice" href="#/settings">
              <Unplug size={16} />
              <span>{t("Connect with SSO or API Key to start chatting")}</span>
            </a>
          )}
          {(loadError || actionError) && (
            <div className="error-banner" role="alert">
              <span>{actionError || loadError}</span>
              <button
                aria-label={t("Refresh history")}
                onClick={() => {
                  setActionError("");
                  void reload();
                  void task.refresh();
                }}
              >
                <RefreshCw size={18} />
              </button>
            </div>
          )}
        </div>
        {isChat && (
          <>
            <div
              className="chat-timeline"
              ref={conversationBody}
              onScroll={(event) => {
                const body = event.currentTarget;
                setAwayFromBottom(
                  body.scrollHeight - body.scrollTop - body.clientHeight > 100,
                );
              }}
            >
              {!isSideDraft && !taskRoute && (
                <WelcomeStatus
                  state={welcome}
                  busy={welcomeBusy}
                  error={welcomeError}
                  onCheck={() => void beginWelcome(true)}
                />
              )}
              {task.error && (
                <div className="inline-error" role="alert">
                  {task.error}
                  <button onClick={() => void task.refresh()}>
                    {t("Retry")}
                  </button>
                </div>
              )}
              {loading || task.loading ? (
                <div className="chat-loading" role="status">
                  <LoaderCircle size={22} className="spin" />
                  <span>{t("Loading conversation…")}</span>
                </div>
              ) : (
                !messageEvents.length &&
                !task.error &&
                !welcomeBusy &&
                !welcomeError &&
                (!welcome ||
                  ["confirmed", "skipped"].includes(welcome.phase)) && (
                  <div className="main-chat-empty">
                    <h1>
                      {isSideDraft
                        ? t("Start a side chat")
                        : t("Your main chat")}
                    </h1>
                    <p>
                      {isSideDraft
                        ? t("A little space for a new topic.")
                        : t("One conversation you can always come back to.")}
                    </p>
                  </div>
                )
              )}
              {messageEvents.map((event, position) => {
                const date = event.created_at ?? event.processed_at;
                const previousDate =
                  messageEvents[position - 1]?.created_at ??
                  messageEvents[position - 1]?.processed_at;
                const timestamp = date ? Date.parse(date) : NaN;
                const showTime =
                  Number.isFinite(timestamp) &&
                  (!previousDate ||
                    timestamp - Date.parse(previousDate) > 5 * 60 * 1000);
                return (
                  <div
                    key={event.id}
                    className={`chat-message-group ${event.type === "user.message" ? "from-user" : "from-assistant"}`}
                  >
                    {showTime && (
                      <time className="chat-time" dateTime={date}>
                        {new Date(timestamp).toLocaleString(formatLocale(), {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    )}
                    {event.type === "agent.message" ? (
                      <AssistantMessage
                        welcome={
                          event.welcome_reply ||
                          isWelcomeReply(events, event.id)
                        }
                        label={t("Reply options {number}", {
                          number: position + 1,
                        })}
                        onOptions={() => setSelectedMessage(event)}
                        text={eventText(event)}
                        reply={event.choice_reply}
                        active={
                          !event.source_session_id &&
                          currentChoiceEvent(events)?.id === event.id
                        }
                        busy={busy || task.loading}
                        streaming={state === "running"}
                        onChoose={(option) =>
                          void action(async () => {
                            if (!activeId) return;
                            try {
                              await client.answerChoice(
                                activeId,
                                event.id,
                                option,
                                digest(eventText(event)),
                              );
                              setAwayFromBottom(false);
                            } finally {
                              await task.refresh();
                            }
                          })
                        }
                      />
                    ) : (
                      <MessageBubble
                        label={t("Message options {number}", {
                          number: position + 1,
                        })}
                        onOptions={() => setSelectedMessage(event)}
                      >
                        <Markdown text={eventText(event)} />
                      </MessageBubble>
                    )}
                  </div>
                );
              })}
              <Activity events={events} running={state === "running"} />
              {permissions.some((event) =>
                task.autoApprovalFailures.includes(event.id),
              ) && (
                <div className="inline-error" role="alert">
                  {t(
                    "Automatic approval did not finish. Refresh history before handling it manually.",
                  )}
                  <button onClick={() => void task.refresh()}>
                    {t("Refresh history")}
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
                <div
                  className="chat-typing"
                  role="status"
                  aria-label={t("{name} is replying", { name: companion.name })}
                >
                  <i />
                  <i />
                  <i />
                </div>
              )}
              {state === "error" && (
                <div className="inline-error">
                  {t(
                    "This response could not finish. Check the execution log before continuing.",
                  )}
                </div>
              )}
            </div>
            <div className="chat-input-dock">
              {awayFromBottom && (
                <ScrollToLatest
                  onClick={() => {
                    conversationBody.current?.scrollTo({
                      top: conversationBody.current.scrollHeight,
                      behavior: "smooth",
                    });
                    setAwayFromBottom(false);
                  }}
                />
              )}
              {goalDraft && (
                <div className="goal-context">
                  <span>{goalDraft.title}</span>
                  <button
                    className="icon-button"
                    aria-label={t("Unlink goal")}
                    onClick={() => setGoalDraft(undefined)}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {pendingTools.length > 0 && (
                <button
                  className="approval-notice"
                  onClick={() =>
                    conversationBody.current
                      ?.querySelector(".permission-card")
                      ?.scrollIntoView({ block: "center", behavior: "smooth" })
                  }
                >
                  {automaticCount ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <ShieldCheck size={15} />
                  )}
                  {automaticCount
                    ? t("Approving web reads…")
                    : t(
                        permissions.length === 1
                          ? "{count} action needs approval"
                          : "{count} actions need approval",
                        { count: permissions.length },
                      )}
                </button>
              )}
              <ChatComposer
                name={companion.name}
                value={draft}
                setValue={setDraft}
                onSend={sendMessage}
                onStop={stop}
                running={state === "running"}
                busy={busy || welcomeBusy}
                disabled={
                  loading ||
                  welcomeBusy ||
                  (!isSideDraft &&
                    !taskRoute &&
                    Boolean(
                      welcome &&
                      ["preparing", "sending", "unconfirmed"].includes(
                        welcome.phase,
                      ),
                    )) ||
                  config?.mode !== "ark" ||
                  Boolean(
                    activeId &&
                    (!task.session ||
                      (task.session.status === "terminated" &&
                        activeId !== index.mainId)),
                  ) ||
                  pendingTools.length > 0
                }
                onActions={() => setPanel("actions")}
              />
            </div>
          </>
        )}
        {!isChat && (
          <div className="companion-content">
            {tab === "feed" && (
              <InspirationPage
                key="feed"
                client={client}
                kind="feed"
                onDiscuss={discussInspiration}
                editInstructions={feedEditor}
                onEditorClose={() => setFeedEditor(false)}
              />
            )}
            {tab === "discover" && (
              <InspirationPage
                key="ideas"
                client={client}
                kind="ideas"
                onDiscuss={discussInspiration}
              />
            )}
            {tab === "goals" && (
              <GoalsPage
                client={client}
                optionsOpen={goalOptions}
                onOptionsClose={() => setGoalOptions(false)}
                onCategory={(category: GoalCategory, parent?: Goal) => {
                  setGoalDraft(undefined);
                  setGoalInitiation(true);
                  setInspirationDraft(undefined);
                  setCategory("general");
                  setDrafts((current) => ({
                    ...current,
                    "new-side": goalStarter(category, parent),
                  }));
                  navigate("/new");
                }}
                onStart={(goal) => {
                  setGoalInitiation(true);
                  setInspirationDraft(undefined);
                  setGoalDraft(goal);
                  setCategory("general");
                  setDrafts((current) => ({
                    ...current,
                    "new-side": goalPrompt(goal),
                  }));
                  navigate("/new");
                }}
              />
            )}
            {tab === "library" && <LibraryPage client={client} />}
            {tab === "studio" && <Studio client={client} config={config} />}
            {tab === "settings" && (
              <Settings client={client} onConnection={onConnection} />
            )}
          </div>
        )}
      </main>
      <nav className="glass-tab-bar" aria-label={t("Main navigation")}>
        {primaryNavigation.map((item) => (
          <a
            key={item.id}
            href={`#${item.path}`}
            aria-label={item.label}
            aria-current={tab === item.id ? "page" : undefined}
            className={tab === item.id ? "selected" : ""}
          >
            <item.icon size={25} strokeWidth={1.9} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      {sidebarOpen && (
        <ConversationSidebar
          name={companion.name}
          sessions={sessions}
          index={index}
          activeId={activeId}
          onClose={() => {
            setSidebarOpen(false);
            if (route === "/tasks") navigate("/");
          }}
          onNew={newSideChat}
          busy={busy}
          error={actionError}
          onArchive={(id, archived) =>
            void action(async () => {
              setIndex(await client.archiveConversation(id, archived));
            })
          }
        />
      )}
      {panel === "actions" && (
        <ChatActions
          onClose={() => setPanel(undefined)}
          onNew={newSideChat}
          onExport={() => void exportConversation()}
          canExport={Boolean(activeId && messageEvents.length)}
        >
          {activeId && activeId !== index.mainId && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setIndex(await client.archiveConversation(activeId, true));
                  setPanel(undefined);
                  navigate("/");
                })
              }
            >
              <Archive size={22} />
              {t("Archive side chat")}
            </button>
          )}
          <a href="#/settings" onClick={() => setPanel(undefined)}>
            <Settings2 size={22} />
            {t("Settings")}
          </a>
        </ChatActions>
      )}
      {panel === "status" && (
        <CompanionSheet
          client={client}
          identity={companion}
          onIdentity={setCompanion}
          onClose={() => setPanel(undefined)}
          status={status}
          isMain={activeId === index.mainId}
          sessionId={activeId}
          sessions={sessions.filter(
            (session) => !index.entries[session.id]?.continuedBy,
          )}
          events={events}
          permissions={permissions}
          busy={busy || automaticCount > 0}
          onConfirm={confirm}
          onNew={newSideChat}
        />
      )}
      {selectedMessage && (
        <Sheet
          title={t("Message")}
          onClose={() => setSelectedMessage(undefined)}
        >
          <div className="chat-action-list">
            <button
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(
                    eventText(selectedMessage),
                  );
                  setSelectedMessage(undefined);
                  setToast(t("Copied"));
                })
              }
            >
              <Copy size={21} />
              {t("Copy text")}
            </button>
            {selectedMessage.type === "agent.message" && activeId && (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await client.saveReply(
                      selectedMessage.source_session_id ?? activeId,
                      selectedMessage.source_event_id ?? selectedMessage.id,
                    );
                    setSelectedMessage(undefined);
                    setToast(t("Saved to Library"));
                  })
                }
              >
                <Bookmark size={21} />
                {t("Save reply")}
              </button>
            )}
          </div>
        </Sheet>
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

function Settings({
  client,
  onConnection,
}: {
  client: Client;
  onConnection: () => void;
}) {
  return (
    <div className="page-content settings-page">
      <AuthPanel client={client} onChanged={onConnection} />
      <a className="settings-studio-link" href="#/studio">
        MA Studio <ExternalLink size={16} />
      </a>
      <section className="privacy-grid">
        <div>
          <ShieldCheck size={22} />
          <h3>{t("Every step is visible")}</h3>
          <p>
            {t(
              "Tools run directly by default and may send data to external services, change files, or incur charges. Upstream denials still apply. Execution records stay in the conversation.",
            )}
          </p>
        </div>
        <div>
          <Unplug size={22} />
          <h3>{t("A real connection")}</h3>
          <p>
            {t(
              "If sign-in expires or a request fails, Muse reports the error instead of generating simulated replies.",
            )}
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
          Volcano Ark
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}
