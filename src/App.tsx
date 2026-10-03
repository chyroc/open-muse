import { formatLocale, systemLanguage, t } from "../shared/i18n";
import { flushSync } from "react-dom";
import { isNetworkFailure } from "../shared/network-error";
import { isBackgroundPost } from "./background-feed";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  goalPlanningMessage,
  goalPrompt,
  goalStarter,
  type GoalCategory,
} from "../shared/goals";
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
import { haptic } from "./haptics";
import { Studio } from "./Studio";
import { appSurface, exportText, shareText } from "./platform";
import {
  announceReminders,
  reminderNotificationsSupported,
} from "./reminderNotifications";
import { backgroundClient } from "./background-client";
import { registerThisIPhone } from "./iphone-device";
import { Sheet, primaryNavigation } from "./MusePages";
import { LibraryPage } from "./LibraryPage";
import {
  MessageAttachments,
  StagedAttachments,
  imagePreview,
  type StagedAttachment,
} from "./Attachments";
import {
  checkAttachment,
  maxAttachments,
  messageAttachments,
} from "../shared/attachments";
import { videoFrameCount, videoFrames } from "./videoFrames";
import { turnOutputs } from "../shared/turn-outputs";
import type { LibraryFile } from "../shared/library";
import { TurnOutputs } from "./TurnOutputs";
import { workCards } from "../shared/work-steps";
import { WorkCard } from "./WorkCard";
import { companionActivity } from "../shared/companion-activity";
import {
  ChatActions,
  ChatComposer,
  ChatHeader,
  CompanionAvatar,
  ConversationSidebar,
  MessageBubble,
  MessageQuote,
  ScrollToLatest,
} from "./ChatUI";
import { splitQuote } from "../shared/message-quote";
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
        surface: appSurface(),
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
  // The iPhone app reports itself to the signed-in account's device list at
  // start, after signing in, and on returning to the foreground; it is
  // throttled and silent, and does nothing in other builds.
  useEffect(() => {
    if (!restored) return;
    const report = () => {
      if (document.hidden) return;
      void Promise.resolve()
        .then(() => registerThisIPhone())
        .catch(() => {});
    };
    report();
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [restored, revision]);
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
  // The companion's look, wherever its avatar is drawn.
  useEffect(() => {
    const root = document.documentElement;
    if (companion.avatar) root.dataset.avatar = companion.avatar;
    else delete root.dataset.avatar;
  }, [companion.avatar]);
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
  const sentMedia = useCallback(
    (fileId: string) => client.sentMedia(fileId),
    [client],
  );
  // This device's reactions, by the message's source event.
  const [reactions, setReactions] = useState<Record<string, string>>({});
  useEffect(() => {
    setReactions({});
    void client.reactions().then(setReactions, () => {});
  }, [client]);
  const reactionKey = (message: AgentEvent) =>
    message.source_event_id ?? message.id;
  const readyAttachments = staged.filter((item) => item.state === "ready");
  const stagedCount = useRef(0);
  stagedCount.current = staged.length;
  const attachFiles = (files: File[], replacing?: string, video?: string) => {
    // A video's placeholder gives its slot to the frames that replace it.
    let count = stagedCount.current - (replacing ? 1 : 0);
    if (replacing)
      setStaged((current) => current.filter((item) => item.key !== replacing));
    for (const file of files) {
      if (file.type.startsWith("video/")) {
        attachVideo(file, count);
        count = maxAttachments;
        continue;
      }
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
          if ("file_id" in item) {
            setAttachmentNames((names) => ({
              ...names,
              [item.file_id]: item.name,
            }));
            // Kept on this device so the sent photo or video opens again.
            if (kind === "image")
              void client.keepSentImage(item.file_id, file, video);
          }
        },
        (error: Error) => update({ state: "failed", error: error.message }),
      );
    }
  };
  // A video is attached as evenly spaced still frames, as many as the
  // remaining attachment slots allow.
  const attachVideo = (file: File, count: number) => {
    const key = uuid();
    const room = maxAttachments - count;
    if (room <= 0) {
      setStaged((current) => [
        ...current,
        {
          key,
          name: file.name,
          kind: "image",
          state: "failed",
          error: t("Attach up to {count} files per message.", {
            count: maxAttachments,
          }),
        },
      ]);
      return;
    }
    setStaged((current) => [
      ...current,
      {
        key,
        name: file.name,
        kind: "image",
        state: "uploading",
        note: t("Preparing video…"),
      },
    ]);
    void client.keepSentVideo(key, file);
    videoFrames(file, Math.min(room, videoFrameCount)).then(
      (frames) => attachFiles(frames, key, key),
      () =>
        setStaged((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  state: "failed",
                  note: undefined,
                  error: t("This video could not be read."),
                }
              : item,
          ),
        ),
    );
  };
  const task = useTask(client, activeId);
  // useTask already drops another conversation's events; until the session
  // itself is read, the events kept on this device show.
  const events =
    task.session && task.session.id !== activeId ? [] : task.events;
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
  // Whether Health is connected, so its reads run without asking.
  const [healthLinked, setHealthLinked] = useState(false);
  useEffect(() => {
    if (!healthRequests.length) return;
    let active = true;
    void client.healthConnected().then(
      (value) => active && setHealthLinked(value),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [client, healthRequests.length]);
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
  const loadFailures = useRef(0);
  const reload = useCallback(async () => {
    // Signed in on this device: the chat can open from the local index while
    // the workspace check below goes to the cloud.
    if (client.signedIn())
      void client
        .conversationIndex()
        .then((conversations) => {
          if (!alive.current) return;
          setIndex(conversations);
          setLoading(false);
        })
        .catch(() => {});
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
      // The conversation index is on this device, so the chat can show its
      // kept history at once; the session list follows from the cloud.
      const listed = client.sessions();
      listed.catch(() => {}); // Reported when awaited below.
      const conversations = await client.conversationIndex();
      if (!alive.current) return;
      setIndex(conversations);
      setLoading(false);
      const result = await listed;
      if (!alive.current) return;
      setSessions(result.data);
      setLoadError("");
      loadFailures.current = 0;
    } catch (error) {
      if (!alive.current) return;
      // A network hiccup is retried on the next reload; it is shown, in the
      // person's language, only when it happens twice in a row.
      if (isNetworkFailure(error)) {
        if (++loadFailures.current >= 2)
          setLoadError(t("Can’t reach the network right now. Retrying…"));
      } else setLoadError((error as Error).message);
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
  // The account's main chat or archive changed on another device.
  useEffect(
    () =>
      client.onAccountData(() => {
        void client
          .conversationIndex()
          .then((conversations) => alive.current && setIndex(conversations))
          .catch(() => {});
      }),
    [client],
  );
  async function beginWelcome(retry = false) {
    if (welcomeJob.current) return;
    welcomeJob.current = true;
    setWelcomeError("");
    // Once the welcome is settled, checking it again runs quietly and never
    // holds back the chat.
    const known = await client.welcomeState().catch(() => undefined);
    if (!known || !["confirmed", "skipped"].includes(known.phase))
      setWelcomeBusy(true);
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
  // Upcoming reminders are handed to the system to announce while the app is
  // closed: refreshed on launch, after each change in the conversation (the
  // companion may have just set one), and when the app goes to the background.
  const signedIn = config?.mode === "ark";
  useEffect(() => {
    if (!reminderNotificationsSupported()) return;
    if (!signedIn) {
      announceReminders([]);
      return;
    }
    let active = true;
    const refresh = () =>
      void client.upcoming().then(
        ({ items }) => active && announceReminders(items),
        () => {},
      );
    refresh();
    const hidden = () => document.hidden && refresh();
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [client, signedIn, lastEventId]);
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
    let read = false;
    // The name and look as last read show at once; the cloud read follows.
    void client
      .cachedCompanion()
      .then((look) => {
        if (active && look && !read)
          setCompanion((current) => ({ ...current, ...look }));
      })
      .catch(() => {});
    void client
      .companionIdentity()
      .then((value) => {
        read = true;
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
    // A reaction adds room under its message, so it also keeps the pin.
  }, [activeId, lastEventId, task.loading, awayFromBottom, reactions]);
  // Content that grows after it is shown, such as history merged in or
  // pictures that finish loading, keeps the pin unless the person scrolled
  // away from the bottom.
  const awayRef = useRef(awayFromBottom);
  awayRef.current = awayFromBottom;
  useEffect(() => {
    const body = conversationBody.current;
    if (!body) return;
    const observer = new ResizeObserver(() => {
      if (!awayRef.current) body.scrollTop = body.scrollHeight;
    });
    for (const child of Array.from(body.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [activeId, lastEventId, task.loading]);
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
  // Starts a message from a menu: the draft must be in place before the
  // keyboard rises, within the same tap.
  function prefill(prompt: string) {
    const text = systemLanguage() === "zh-CN" ? prompt : `${prompt} `;
    flushSync(() => setDraft(text));
    const input = document.querySelector<HTMLTextAreaElement>(
      ".chat-composer textarea",
    );
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(text.length, text.length);
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
          // The service's scheduled posts are not saved items, so there is
          // nothing to link.
          if (!isBackgroundPost(inspirationDraft))
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
  // Sends one message to the main chat and opens it there, as a goal
  // category's + does. The main chat is created when there is none yet.
  const sendToMain = (text: string, { goals = false } = {}) => {
    navigate("/");
    return action(async () => {
      if (goals) await client.prepareGoals();
      let sessionId = index.mainId;
      if (!sessionId) {
        const session = await client.openConversation(
          "main",
          t("Main chat"),
          "general",
        );
        if (!alive.current) return;
        sessionId = session.id;
        setIndex(await client.conversationIndex());
      }
      await client.send(sessionId, { type: "user.message", text });
      if (alive.current) setAwayFromBottom(false);
    });
  };
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
  // A connection that drops for a moment and comes back is not shown.
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    if (task.connected) {
      setConnecting(false);
      return;
    }
    const timer = setTimeout(() => setConnecting(true), 1500);
    return () => clearTimeout(timer);
  }, [task.connected]);
  const sideTitle =
    taskRoute && activeId !== index.mainId
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
  const activity =
    config?.mode === "ark"
      ? companionActivity(currentEvents, {
          running: state === "running",
          approval: permissions.length > 0,
          mac: macTools.length > 0,
          health: healthRequests.length
            ? healthLinked
              ? "auto"
              : "ask"
            : undefined,
          interrupted: Boolean(task.error || loadError),
          connecting: Boolean(activeId) && connecting,
        })
      : undefined;
  // A task's narration is folded into one card per turn.
  const work = workCards(events, state === "running");
  // Files the companion saved to the Library in this conversation, shown
  // under the reply of the turn that made them. Read again after each turn.
  const [savedFiles, setSavedFiles] = useState<LibraryFile[]>([]);
  const conversationIds = [
    ...new Set(
      [activeId, ...events.map((event) => event.source_session_id)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ].join(",");
  const turnDone = state !== "running" && state !== "attention";
  useEffect(() => {
    if (!conversationIds || !turnDone) return;
    let active = true;
    const ids = new Set(conversationIds.split(","));
    void client.libraryFiles().then(
      ({ data }) =>
        active &&
        setSavedFiles(data.filter((file) => ids.has(file.session_id))),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [client, conversationIds, turnDone, lastEventId]);
  const outputs = turnOutputs(events, savedFiles, work.hidden);
  // Replies to the app's own browser requests are bookkeeping, not chat.
  const browserReplies = new Set<string>();
  let inBrowserTurn = false;
  for (const event of events) {
    if (event.type === "user.message")
      inBrowserTurn = event.app_initiation === "browser";
    else if (inBrowserTurn && event.type === "agent.message")
      browserReplies.add(event.id);
  }
  const messageEvents = events.filter(
    (event) =>
      ["user.message", "agent.message"].includes(event.type) &&
      !event.app_initiation &&
      !browserReplies.has(event.id) &&
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
            showMore={tab !== "discover" && !isSideDraft}
            status={status}
            activity={activity}
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
                  ? t("Sign in to your Open Muse account to start chatting")
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
                // A new side chat stays empty until its first message.
                !isSideDraft &&
                !messageEvents.length &&
                !task.error &&
                !welcomeBusy &&
                !welcomeError &&
                (!welcome ||
                  ["confirmed", "skipped"].includes(welcome.phase)) && (
                  <div className="main-chat-empty">
                    <h1>{t("Your main chat")}</h1>
                    <p>{t("One conversation you can always come back to.")}</p>
                  </div>
                )
              )}
              {messageEvents.map((event, position) => {
                const card = work.cardAt.get(event.id);
                if (work.hidden.has(event.id))
                  return card ? <WorkCard key={card.id} work={card} /> : null;
                const date = event.created_at ?? event.processed_at;
                const previousDate =
                  messageEvents[position - 1]?.created_at ??
                  messageEvents[position - 1]?.processed_at;
                const timestamp = date ? Date.parse(date) : NaN;
                const showTime =
                  Number.isFinite(timestamp) &&
                  (!previousDate ||
                    timestamp - Date.parse(previousDate) > 5 * 60 * 1000);
                // A message that quotes something shows the quote above it.
                const sent =
                  event.type === "user.message"
                    ? splitQuote(eventText(event))
                    : { text: eventText(event) };
                return (
                  <Fragment key={event.id}>
                    {card && <WorkCard work={card} />}
                    <div
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
                          reaction={reactions[reactionKey(event)]}
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
                        <>
                          {sent.quote && <MessageQuote text={sent.quote} />}
                          <MessageBubble
                            label={t("Message options {number}", {
                              number: position + 1,
                            })}
                            onOptions={(bubble) => {
                              setSelectedBubble(bubble);
                              setSelectedMessage(event);
                            }}
                            reaction={reactions[reactionKey(event)]}
                          >
                            <MessageAttachments
                              items={messageAttachments(event, attachmentNames)}
                              load={sentMedia}
                            />
                            {sent.text && <Markdown text={sent.text} />}
                          </MessageBubble>
                        </>
                      )}
                      {outputs.get(event.id) && (
                        <TurnOutputs
                          files={outputs.get(event.id)!}
                          client={client}
                        />
                      )}
                    </div>
                  </Fragment>
                );
              })}
              {work.trailing && <WorkCard work={work.trailing} />}
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
                  {appSurface() !== "mac" && activeId && (
                    // Without the Mac app nothing answers; the person can
                    // tell the companion to go on without it.
                    <button
                      type="button"
                      className="approval-notice-action"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await client.answerCustomTools(
                            activeId,
                            macTools.map((event) => ({
                              custom_tool_use_id: event.id,
                              is_error: true,
                              content: [
                                {
                                  type: "text",
                                  text: "The person skipped this step from another device; the Open Muse Mac app did not run it. Continue without it, and ask them if you need what it would have provided.",
                                },
                              ],
                            })),
                          );
                        })
                      }
                    >
                      {t("Skip")}
                    </button>
                  )}
                </div>
              )}
              <ChatComposer
                name={companion.name}
                newSideChat={isSideDraft}
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
                onStart={(text) => void sendToMain(text)}
              />
            )}
            {tab === "goals" && (
              <GoalsPage
                client={client}
                optionsOpen={goalOptions}
                onOptionsClose={() => setGoalOptions(false)}
                onCategory={(category: GoalCategory, parent?: Goal) => {
                  // A category starts planning in the main chat at once.
                  if (!parent) {
                    void sendToMain(goalPlanningMessage(category), {
                      goals: true,
                    });
                    return;
                  }
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
            onClick={() => {
              if (tab !== item.id) haptic("selection");
            }}
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
          onRename={() => prefill(t("Change your name to"))}
          onChangeAvatar={() => prefill(t("Change your avatar to"))}
          prepareSession={async () => {
            if (activeId && activeId !== index.mainId) return activeId;
            const session = await client.openConversation(
              "main",
              t("Main chat"),
              category,
            );
            setIndex(await client.conversationIndex());
            return session.id;
          }}
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
          reaction={reactions[reactionKey(selectedMessage)]}
          onReact={(emoji) => {
            // Shown at once; the stored record is the source of truth.
            const key = reactionKey(selectedMessage);
            setReactions(({ [key]: _, ...rest }) =>
              emoji ? { ...rest, [key]: emoji } : rest,
            );
            void client
              .setReaction(key, emoji)
              .catch(() => client.reactions())
              .then(setReactions, () => {});
          }}
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
