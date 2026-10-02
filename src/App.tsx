import { formatLocale, systemLanguage, t } from "../shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Bookmark,
  Check,
  Copy,
  HeartPulse,
  Laptop,
  LoaderCircle,
  RefreshCw,
  Reply,
  Settings2,
  Share as ShareIcon,
  ShieldCheck,
  TextSelect,
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
import { digest, uuid } from "../shared/crypto";
import { goalPrompt, goalStarter, type GoalCategory } from "../shared/goals";
import { Markdown, PermissionCard } from "./components";
import type {
  AgentEvent,
  AppConfig,
  Category,
  Goal,
  Session,
} from "../shared/types";
import {
  eventText,
  pendingCustomTools,
  pendingPermissions,
  taskState,
} from "../shared/types";
import { canAutoApprove } from "../shared/approval-policy";
import { HealthRequestCard } from "./HealthRequestCard";
import { isHealthRequest } from "../shared/health";
import { SettingsHome } from "./SettingsHome";
import { PageSheet } from "./PageSheet";
import { PullToRefresh } from "./PullToRefresh";
import { MessageMenu, type MessageMenuAction } from "./MessageMenu";
import { Studio } from "./Studio";
import { exportText, shareText } from "./platform";
import { backgroundClient } from "./background-client";
import { Sheet, primaryNavigation } from "./MusePages";
import { LibraryPage } from "./LibraryPage";
import {
  MessageAttachments,
  StagedAttachments,
  imagePreview,
  type StagedAttachment,
} from "./Attachments";
import { checkAttachment, messageAttachments } from "../shared/attachments";
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
        account: backgroundClient,
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
  // A key replaced or removed on another device lives at the account service,
  // so re-check it whenever the app returns to the foreground.
  useEffect(() => {
    if (!restored) return;
    const foreground = () => {
      if (document.hidden) return;
      void client.syncAccount().then(
        (changed) => changed && setRevision((value) => value + 1),
        () => {},
      );
    };
    document.addEventListener("visibilitychange", foreground);
    return () => document.removeEventListener("visibilitychange", foreground);
  }, [client, restored]);
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
  const [hashRoute, setRoute] = useState(location.hash.slice(1) || "/");
  // Settings is a sheet over the page that was open before it.
  const settingsOpen = hashRoute === "/settings";
  const [pageRoute, setPageRoute] = useState(settingsOpen ? "/" : hashRoute);
  const route = settingsOpen ? pageRoute : hashRoute;
  const [index, setIndex] = useState<ConversationIndex>(emptyConversations);
  const isSideDraft = route === "/new";
  const taskRoute = route.startsWith("/task/") ? route.slice(6) : undefined;
  const tab =
    taskRoute || isSideDraft
      ? "home"
      : route === "/studio"
        ? "studio"
        : (primaryNavigation.find((item) => item.path === route)?.id ?? "home");
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
  const [selectedBubble, setSelectedBubble] = useState<HTMLElement>();
  const [selectingText, setSelectingText] = useState<string>();
  const [goalDraft, setGoalDraft] = useState<Goal>();
  const [goalInitiation, setGoalInitiation] = useState(false);
  const [goalOptions, setGoalOptions] = useState(false);
  const [libraryOptions, setLibraryOptions] = useState(false);
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
  const welcomePhase = welcome?.phase;
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [welcomeError, setWelcomeError] = useState("");
  const checkedWelcome = useRef(false);
  const welcomeJob = useRef(false);
  const checkInJob = useRef(false);
  const busyRef = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<Category>("general");
  const draftKey = activeId ?? (isSideDraft ? "new-side" : "new-main");
  const draft = drafts[draftKey] ?? "";
  // Staged attachments belong to the conversation being written; switching
  // conversations drops them (the uploaded copies simply expire in MA).
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [attachmentNames, setAttachmentNames] = useState<
    Record<string, string>
  >({});
  const carryStaged = useRef<string>(undefined);
  useEffect(() => {
    // Creating the conversation for this message moves the draft with it.
    if (carryStaged.current === draftKey) carryStaged.current = undefined;
    else setStaged([]);
  }, [draftKey]);
  useEffect(() => {
    void client.attachmentNames().then(setAttachmentNames, () => {});
  }, [client]);
  const readyAttachments = staged.filter((item) => item.state === "ready");
  const stagedCount = useRef(0);
  stagedCount.current = staged.length;
  const attachFiles = (files: File[]) => {
    let count = stagedCount.current;
    for (const file of files) {
      const key = uuid();
      let kind: StagedAttachment["kind"];
      try {
        kind = checkAttachment(file.name, file.type, file.size, count).kind;
      } catch (error) {
        setStaged((current) => [
          ...current,
          {
            key,
            name: file.name,
            kind: file.type.startsWith("image/") ? "image" : "document",
            state: "failed",
            error: (error as Error).message,
          },
        ]);
        continue;
      }
      setStaged((current) => [
        ...current,
        { key, name: file.name, kind, state: "uploading" },
      ]);
      const position = count++;
      const update = (patch: Partial<StagedAttachment>) =>
        setStaged((current) =>
          current.map((item) =>
            item.key === key ? { ...item, ...patch } : item,
          ),
        );
      if (kind === "image")
        void imagePreview(file).then(
          (preview) => preview && update({ preview }),
        );
      client.uploadAttachment(file, file.name, position).then(
        (item) => {
          update({ state: "ready", value: item, name: item.name });
          if ("file_id" in item)
            setAttachmentNames((names) => ({
              ...names,
              [item.file_id]: item.name,
            }));
        },
        (error: Error) => update({ state: "failed", error: error.message }),
      );
    }
  };
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
  // The Mac app runs mac_* custom tools and answers them; this device waits.
  const customTools = pendingCustomTools(currentEvents);
  const macTools = customTools.filter((event) =>
    event.name?.startsWith("mac_"),
  );
  // Apple Health reads wait for the person to share them on the iPhone.
  const healthRequests = customTools.filter(isHealthRequest);
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
      if (next !== "/settings") setPageRoute(next);
      if (next === "/tasks") setSidebarOpen(true);
      setActionError("");
      setSelectedMessage(undefined);
      setPanel(undefined);
      setGoalOptions(false);
      setLibraryOptions(false);
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
    if (
      loading ||
      config?.mode !== "ark" ||
      Boolean(loadError) ||
      tab !== "home" ||
      isSideDraft ||
      taskRoute ||
      welcomeBusy ||
      (welcomePhase &&
        welcomePhase !== "confirmed" &&
        welcomePhase !== "skipped")
    )
      return;
    // Due reminders, then check-ins, start only while the main chat is in
    // front of the person.
    const run = (checkIn = true) => {
      if (document.hidden || checkInJob.current) return;
      checkInJob.current = true;
      void client
        .deliverUpcoming(systemLanguage())
        .catch(() => undefined)
        .then(async (reminder) =>
          reminder || !checkIn
            ? reminder
            : await client.startCheckIn(systemLanguage()),
        )
        .then((record) => {
          if (record && alive.current) void reload();
        })
        .catch(() => {
          /* An app-initiated check-in never interrupts the person. */
        })
        .finally(() => {
          checkInJob.current = false;
        });
    };
    const visible = () => run();
    run();
    // Reminders fall due while the app stays open; check-ins wait for a return.
    const tick = setInterval(() => run(false), 60000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [
    client,
    loading,
    config?.mode,
    loadError,
    tab,
    isSideDraft,
    taskRoute,
    welcomePhase,
    welcomeBusy,
    reload,
  ]);
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
      const attachments = readyAttachments.flatMap((item) =>
        item.value ? [item.value] : [],
      );
      if (!text && !attachments.length) return;
      if (staged.some((item) => item.state !== "ready"))
        throw new Error(
          t("Wait for uploads to finish or remove failed attachments."),
        );
      if (goalInitiation || goalDraft) await client.prepareGoals();
      let sessionId = activeId;
      if (!sessionId || sessionId === index.mainId) {
        const session = await client.openConversation(
          isSideDraft ? "side" : "main",
          isSideDraft
            ? (goalDraft?.title ?? (text || attachments[0].name)).slice(0, 60)
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
        carryStaged.current = session.id;
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
      await client.send(sessionId, {
        type: "user.message",
        text,
        ...(attachments.length ? { attachments } : {}),
      });
      if (alive.current) {
        setGoalInitiation(false);
        setDrafts((current) => ({ ...current, [sessionId!]: "" }));
        setStaged([]);
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
        : permissions.length || healthRequests.length
          ? t("Waiting for approval")
          : macTools.length
            ? t("Waiting for your Mac")
            : task.error || loadError
              ? t("Connection interrupted")
              : t("Connected");
  const messageEvents = events.filter(
    (event) =>
      ["user.message", "agent.message"].includes(event.type) &&
      !event.app_initiation &&
      (eventText(event) || messageAttachments(event).length),
  );
  const isChat = tab === "home";
  // The long-press menu for a message: reply, copy, select, share, and for
  // the assistant's replies, saving to the Library.
  function messageActions(message: AgentEvent): MessageMenuAction[] {
    const text = eventText(message);
    const actions: MessageMenuAction[] = [
      {
        label: t("Reply"),
        icon: <Reply size={20} />,
        onSelect: () => {
          const quote = text
            .split("\n")
            .filter((line) => line.trim())
            .slice(0, 3)
            .map((line) => `> ${line}`)
            .join("\n");
          setDrafts((current) => ({
            ...current,
            [draftKey]: `${quote}\n\n${current[draftKey] ?? ""}`,
          }));
        },
      },
      {
        label: t("Copy"),
        icon: <Copy size={20} />,
        onSelect: () =>
          void action(async () => {
            await navigator.clipboard.writeText(text);
            setToast(t("Copied"));
          }),
      },
      {
        label: t("Select"),
        icon: <TextSelect size={20} />,
        onSelect: () => setSelectingText(text),
      },
      {
        label: t("Share…"),
        icon: <ShareIcon size={20} />,
        onSelect: () =>
          void action(async () => {
            await shareText(text);
          }),
      },
    ];
    if (message.type === "agent.message" && activeId)
      actions.push({
        label: t("Save to Library"),
        icon: <Bookmark size={20} />,
        disabled: busy,
        onSelect: () =>
          void action(async () => {
            await client.saveReply(
              message.source_session_id ?? activeId,
              message.source_event_id ?? message.id,
            );
            setToast(t("Saved to Library"));
          }),
      });
    return actions;
  }
  // Messages that arrive while a conversation is open rise into place; a
  // batch of several at once is history loading and appears without motion.
  const seenMessages = useRef<{ conversation?: string; ids: Set<string> }>({
    ids: new Set(),
  });
  if (seenMessages.current.conversation !== activeId)
    seenMessages.current = { conversation: activeId, ids: new Set() };
  const unseen = messageEvents.filter(
    (event) => !seenMessages.current.ids.has(event.id),
  );
  const arriving = new Set(
    unseen.length <= 2 && seenMessages.current.ids.size
      ? unseen.map((event) => event.id)
      : [],
  );
  useEffect(() => {
    for (const event of messageEvents) seenMessages.current.ids.add(event.id);
  });
  return (
    <div className="app-shell muse-shell companion-shell">
      <main
        className={`companion-main ${isChat ? "chat-page" : "content-page"}`}
      >
        {tab !== "studio" ? (
          <ChatHeader
            name={companion.name}
            onSidebar={() => setSidebarOpen(true)}
            onStatus={() => setPanel("status")}
            onMore={() =>
              tab === "feed"
                ? setFeedEditor(true)
                : tab === "goals"
                  ? setGoalOptions(true)
                  : tab === "library"
                    ? setLibraryOptions(true)
                    : setPanel("actions")
            }
            moreLabel={
              tab === "goals"
                ? t("Goals options")
                : tab === "library"
                  ? t("Library options")
                  : undefined
            }
            feed={tab === "feed"}
            showSidebar={isChat}
            showMore={tab !== "discover"}
            status={status}
            activity={status === t("Connected") ? undefined : status}
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
            <strong>MA Studio</strong>
            <span />
          </header>
        )}
        <div className="connection-notices">
          {config?.mode === "disconnected" && (
            <a className="connect-notice" href="#/settings">
              <Unplug size={16} />
              <span>
                {client.identity.accountMode() &&
                !client.identity.accountOwner()
                  ? t("Sign in to your Muse account to start chatting")
                  : t("Add an Ark API key to start chatting")}
              </span>
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
                    className={`chat-message-group ${event.type === "user.message" ? "from-user" : "from-assistant"}${arriving.has(event.id) ? " arriving" : ""}`}
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
                        onOptions={(bubble) => {
                          setSelectedBubble(bubble);
                          setSelectedMessage(event);
                        }}
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
                        onOptions={(bubble) => {
                          setSelectedBubble(bubble);
                          setSelectedMessage(event);
                        }}
                      >
                        <MessageAttachments
                          items={messageAttachments(event, attachmentNames)}
                        />
                        {eventText(event) && (
                          <Markdown text={eventText(event)} />
                        )}
                      </MessageBubble>
                    )}
                  </div>
                );
              })}
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
              {activeId &&
                healthRequests.map((event) => (
                  <HealthRequestCard
                    key={event.id}
                    client={client}
                    session={activeId}
                    event={event}
                    name={companion.name}
                    onAnswered={() => void task.refresh()}
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
              {healthRequests.length > 0 && !pendingTools.length && (
                <button
                  className="approval-notice"
                  onClick={() =>
                    conversationBody.current
                      ?.querySelector(".health-card")
                      ?.scrollIntoView({ block: "center", behavior: "smooth" })
                  }
                >
                  <HeartPulse size={15} />
                  {t("Apple Health data requested")}
                </button>
              )}
              {macTools.length > 0 && (
                <div className="approval-notice" role="status">
                  <Laptop size={15} />
                  {t("Waiting for Open Muse on your Mac to finish this step")}
                </div>
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
                onAttach={attachFiles}
                attachments={
                  <StagedAttachments
                    items={staged}
                    onRemove={(key) =>
                      setStaged((current) =>
                        current.filter((item) => item.key !== key),
                      )
                    }
                  />
                }
                attachmentsReady={readyAttachments.length > 0}
                attachmentsPending={staged.some(
                  (item) => item.state !== "ready",
                )}
              />
            </div>
          </>
        )}
        {!isChat && (
          <PullToRefresh className="companion-content">
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
            {tab === "library" && (
              <LibraryPage
                client={client}
                optionsOpen={libraryOptions}
                onOptionsClose={() => setLibraryOptions(false)}
              />
            )}
            {tab === "studio" && <Studio client={client} config={config} />}
          </PullToRefresh>
        )}
      </main>
      <nav
        className="glass-tab-bar"
        aria-label={t("Main navigation")}
        style={
          {
            "--tab-index": Math.max(
              0,
              primaryNavigation.findIndex((item) => item.id === tab),
            ),
          } as React.CSSProperties
        }
      >
        {primaryNavigation.some((item) => item.id === tab) && (
          <span className="tab-selection" aria-hidden="true" />
        )}
        {primaryNavigation.map((item) => (
          <a
            key={item.id}
            href={`#${item.path}`}
            aria-label={item.label}
            aria-current={tab === item.id ? "page" : undefined}
            className={tab === item.id ? "selected" : ""}
          >
            <item.icon size={26} strokeWidth={2} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      {settingsOpen && (
        <PageSheet title={t("Settings")} onClose={() => navigate(pageRoute)}>
          <SettingsHome
            client={client}
            onConnection={onConnection}
            onDraft={(text) => {
              setDrafts((current) => ({
                ...current,
                [index.mainId ?? "new-main"]: text,
              }));
              setSidebarOpen(false);
              navigate("/");
            }}
          />
        </PageSheet>
      )}
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
          events={events}
          permissions={permissions}
          busy={busy || automaticCount > 0}
          onConfirm={confirm}
          onNew={newSideChat}
        />
      )}
      {selectedMessage && selectedBubble && (
        <MessageMenu
          source={selectedBubble}
          fromUser={selectedMessage.type === "user.message"}
          onClose={() => {
            setSelectedMessage(undefined);
            setSelectedBubble(undefined);
          }}
          actions={messageActions(selectedMessage)}
        />
      )}
      {selectingText !== undefined && (
        <Sheet
          title={t("Select text")}
          onClose={() => setSelectingText(undefined)}
        >
          <div className="selectable-text">{selectingText}</div>
        </Sheet>
      )}
      {selectedMessage && !selectedBubble && (
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
