import { systemLanguage, t } from "../../shared/i18n";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Menu,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import type { Client } from "../../src/api";
import { useTask } from "../../src/useTask";
import { AuthPanel } from "../../src/AuthPanel";
import { Markdown } from "../../src/components";
import { defaultIdentity } from "../../src/direct/identity";
import type {
  IdentityDocument,
  IdentityDocumentName,
} from "../../shared/identity";
import { StatusPanel, type StatusTab } from "./StatusPanel";
import { FeedPage } from "./FeedPage";
const IdeasPage = lazy(() =>
  import("./IdeasPage").then((module) => ({ default: module.IdeasPage })),
);
const GoalsPage = lazy(() =>
  import("./GoalsPage").then((module) => ({ default: module.GoalsPage })),
);
const LibraryPage = lazy(() =>
  import("./LibraryPage").then((module) => ({ default: module.LibraryPage })),
);
import { MacGoals } from "./goals";
import { libraryPath } from "./library";
import { openNativeSettings } from "./settings";
import { navLabel } from "./labels";
import { connectionError, connectionReady } from "./startup";
import { WorkspaceBoundary } from "./WorkspaceBoundary";
import { AssistantContent, messageParts } from "./ChoiceContent";
import { ComputerRequests, type MacAnswer } from "./ComputerRequests";
import {
  computerAvailable,
  computerChanged,
  declinedResult,
  isMacTool,
  policyAnswer,
  readComputer,
  runMacTool,
  type ComputerState,
} from "./computer";
import { healthToolName } from "../../shared/health";
import { UpcomingTab, upcomingChanged } from "./UpcomingTab";

// How often the open app checks for reminders that have come due.
const UPCOMING_CHECK_INTERVAL = 60000;
import { currentChoiceEvent } from "../../shared/chat-choices";
import { digest } from "../../shared/crypto";
import {
  discussionPrompt,
  type InspirationItem,
} from "../../shared/inspiration";
const DocumentEditor = lazy(() =>
  import("./DocumentEditor").then((module) => ({
    default: module.DocumentEditor,
  })),
);
import {
  currentConversation,
  emptyConversations,
} from "../../src/direct/conversations";
import {
  eventText,
  pendingCustomTools,
  pendingPermissions,
  taskState,
  type AgentEvent,
  type Goal,
  type Session,
} from "../../shared/types";
import { canAutoApprove } from "../../shared/approval-policy";
import { Avatar, Empty, Modal, Rail } from "./Chrome";
import {
  SideChatsPanel,
  keepChatPanelVisible,
  setKeepChatPanelVisible,
  storeChatPanelWidth,
  storedChatPanelWidth,
} from "./SideChats";
import { ShortcutsDialog } from "./Shortcuts";
import { groupLinks } from "./messageGroups";
import { droppedFiles, droppedFilesEvent } from "./dropped";
import { postCompanion, type CompanionState } from "./presence";
import {
  PanelEdgeHandle,
  panelEdge,
  panelOpacity,
  type PanelDrag,
} from "./PanelEdge";
import { CommandPalette, paletteItems } from "./Palette";
import { FindBar, findMatches, partKey } from "./FindBar";
import { MessageActions } from "./MessageActions";
import { registerThisMac } from "./devices";
import { useUnreadBadge } from "./unread";
import { speechAvailable, useReadAloud } from "./speech";
import { useVoiceConversation, type VoiceState } from "./voice";

const voiceLabels: Record<Exclude<VoiceState, "off">, string> = {
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};
import { readReactions, setReaction, type Mood } from "./reactions";
import {
  dictationAvailable,
  dictationEvent,
  dictationPreferences,
  joinDictation,
  readDictation,
  requestDictation,
  startDictation,
  stopDictation,
  type DictationEvent,
} from "./dictation";
import {
  SentFiles,
  StagedFiles,
  stageFile,
  thumbnail,
  type Staged,
} from "./Attachments";
import { attachmentAccept, messageAttachments } from "../../shared/attachments";
import { uuid } from "../../shared/crypto";
import {
  chatMessages,
  parseRoute,
  shouldSendOnKey,
  sideChats,
  type Page,
} from "./model";

export function DesktopApp({ client }: { client: Client }) {
  const [route, setRoute] = useState(() =>
    parseRoute(typeof location === "undefined" ? "" : location.hash),
  );
  const [index, setIndex] = useState(emptyConversations);
  const [sessions, setSessions] = useState<Session[]>([]);
  // A pinned panel opens with the app and stays open while moving around.
  const [keepPanel, setKeepPanel] = useState(keepChatPanelVisible);
  const [drawer, setDrawer] = useState(keepChatPanelVisible);
  const [drawerWidth, setDrawerWidth] = useState(storedChatPanelWidth);
  const keepPanelRef = useRef(keepPanel);
  keepPanelRef.current = keepPanel;
  // Choosing something from the panel closes it unless it is pinned.
  const settleDrawer = () => {
    if (!keepPanelRef.current) setDrawer(false);
  };
  const [statusOpen, setStatusOpen] = useState(true);
  const [statusTab, setStatusTab] = useState<StatusTab>("activity");
  // Dragging the status panel's edge, and settling it after a release.
  const [panelDrag, setPanelDrag] = useState<PanelDrag>({ kind: "idle" });
  const [panelSettle, setPanelSettle] = useState<{
    from: number;
    open: boolean;
  }>();
  const panelSurface = useRef<HTMLDivElement>(null);
  const panelWidth = () =>
    window.matchMedia("(max-width: 1050px)").matches ? 300 : 345;
  const commitPanel = (open: boolean) => {
    // A click on an edge toggles at once; a released drag glides the rest of
    // the way from wherever the pointer left the panel.
    const full = panelWidth();
    const from = panelSurface.current?.getBoundingClientRect().width ?? 0;
    if (from > 0 && from < full - 1) setPanelSettle({ from, open });
    setStatusOpen(open);
  };
  useLayoutEffect(() => {
    const surface = panelSurface.current;
    if (!panelSettle || !surface) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    surface.style.transition = "none";
    surface.style.width = `${panelSettle.from}px`;
    surface.style.opacity = "";
    void surface.offsetWidth;
    surface.style.transition = reduce
      ? "width 0.12s ease-out"
      : `width ${panelEdge.settleMs}ms ${panelEdge.settleEase}`;
    surface.style.width = panelSettle.open ? `${panelWidth()}px` : "0px";
    const done = window.setTimeout(() => {
      surface.style.transition = "";
      surface.style.width = "";
      setPanelSettle(undefined);
    }, panelEdge.settleMs + 40);
    return () => window.clearTimeout(done);
  }, [panelSettle]);
  const [identity, setIdentity] = useState(defaultIdentity);
  const [document, setDocument] = useState<IdentityDocument>();
  const feedEditorOpen = useRef(false);
  const onFeedEditorChange = useCallback((open: boolean) => {
    feedEditorOpen.current = open;
  }, []);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const connectionVersion = useRef(connectionEpoch);
  connectionVersion.current = connectionEpoch;
  const [splitChat, setSplitChat] = useState(false);
  const [quotedPost, setQuotedPost] = useState<InspirationItem>();
  const [goalConversation, setGoalConversation] = useState<string>();
  const [goalLabels, setGoalLabels] = useState<Record<string, string>>({});
  const [goalDrafts, setGoalDrafts] = useState<Record<string, boolean>>({});
  const [goalDraftReplacement, setGoalDraftReplacement] = useState<{
    key: string;
    text: string;
    goal?: boolean;
  }>();
  const routePage = useRef(route.page);
  routePage.current = route.page;
  const activeDocument = useRef<IdentityDocument | undefined>(undefined);
  const acceptedHash = useRef(location.hash);
  activeDocument.current = document;
  const [settings, setSettings] = useState(false);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(client.signedIn());
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState(false);
  const [prefill, setPrefill] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteGoals, setPaletteGoals] = useState<Goal[]>([]);
  const [reactions, setReactions] = useState<Record<string, Mood>>({});
  const [listening, setListening] = useState(false);
  const [autoSend, setAutoSend] = useState<string>();
  const dictationBase = useRef<{ key: string; text: string }>(undefined);
  // Find in the open conversation; undefined while the bar is closed.
  const [find, setFind] = useState<string>();
  const [findAt, setFindAt] = useState(0);
  // Files staged for each draft; they are sent only with that draft.
  const [stagedBy, setStagedBy] = useState<Record<string, Staged[]>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const filePicker = useRef<HTMLInputElement>(null);
  const name = identity.name;
  const [away, setAway] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const inspirationPage =
    route.page === "feed" ||
    route.page === "ideas" ||
    route.page === "goals" ||
    route.page === "library";
  const id =
    route.page === "chat" && !route.newSide
      ? route.conversation
        ? currentConversation(index, route.conversation)
        : index.mainId
      : inspirationPage && splitChat
        ? route.page === "goals" && goalConversation
          ? currentConversation(index, goalConversation)
          : index.mainId
        : undefined;
  const draftKey = id ?? (route.newSide ? "new-side" : "main");
  const draft = drafts[draftKey] ?? "";
  const staged = stagedBy[draftKey] ?? [];
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  const task = useTask(client, id);
  // Read through a ref so a new refresh function never re-runs the effects.
  const refreshTask = useRef(task.refresh);
  refreshTask.current = task.refresh;
  const events = task.session?.id === id ? task.events : [];
  const currentEvents = events.filter(
    (event) => !event.source_session_id || event.source_session_id === id,
  );
  const state = taskState(currentEvents, task.session?.status);
  const running = state === "running" || state === "attention";
  const approvals = pendingPermissions(currentEvents).filter(
    (event) =>
      !canAutoApprove(event) || task.autoApprovalFailures.includes(event.id),
  );
  const panelRow = (session: Session) => ({
    id: session.id,
    title: index.entries[session.id]?.title ?? session.title,
    updatedAt: Date.parse(session.updated_at) || undefined,
  });
  // This Mac answers only its own tools; another device answers the rest.
  const deviceCalls = pendingCustomTools(currentEvents);
  const macCalls = deviceCalls.filter((call) => isMacTool(call.name));
  const elsewhere = deviceCalls.filter((call) => !isMacTool(call.name));
  const macCallKey = macCalls.map((call) => call.id).join(",");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const config = await client.config();
      if (!alive.current) return;
      setReady(config.mode === "ark");
      if (config.mode !== "ark") {
        setIndex(emptyConversations());
        setSessions([]);
        setIdentity(defaultIdentity());
        return;
      }
      const epoch = connectionVersion.current;
      const [remote, conversations, identity, labels] = await Promise.all([
        client.sessions(),
        client.conversationIndex(),
        client.companionIdentity(),
        new MacGoals(client).labels(),
      ]);
      if (!alive.current || connectionVersion.current !== epoch) return;
      setGoalLabels(labels);
      setSessions(
        remote.data.map((session) => ({
          ...session,
          title: labels[session.id] ?? session.title,
        })),
      );
      setIndex(conversations);
      setIdentity(identity);
      setError("");
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [client]);

  function navigate(path: string) {
    if (activeDocument.current || feedEditorOpen.current) {
      setNotice(
        t(
          "Close the document before leaving this workspace. Your draft is preserved.",
        ),
      );
      return;
    }
    location.hash = path;
  }
  // The Mac app answers with its own settings window; the panel is the fallback.
  function openSettings() {
    if (!openNativeSettings()) setSettings(true);
  }
  // The avatar menu seeds the main composer and leaves the sending to the user.
  // Attachments and any open document are untouched, and nothing is created.
  function prefillComposer(text: string) {
    const key = index.mainId ?? "main";
    setDrafts((old) => ({ ...old, [key]: text }));
    setGoalDrafts((old) => ({ ...old, [key]: false }));
    setPrefill((value) => value + 1);
  }
  const goPage = (page: Page) => {
    // Reselecting Library closes the side-by-side chat and keeps the category.
    if (
      page === "library" &&
      route.page === "library" &&
      !activeDocument.current &&
      !feedEditorOpen.current
    ) {
      setSplitChat(false);
      settleDrawer();
      return;
    }
    navigate(page === "chat" ? "/" : `/${page}`);
    settleDrawer();
    setQuery("");
  };
  useEffect(() => {
    alive.current = true;
    const change = () => {
      if (activeDocument.current || feedEditorOpen.current) {
        history.replaceState(null, "", acceptedHash.current || "#/");
        return;
      }
      acceptedHash.current = location.hash;
      setRoute(parseRoute(location.hash));
      setError("");
      setMenu(false);
      setAway(false);
    };
    const command = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (activeDocument.current || feedEditorOpen.current) {
        setNotice(
          t(
            "Close the document before switching workspaces or accounts. Your draft is preserved.",
          ),
        );
        return;
      }
      if (action === "settings") openSettings();
      if (action === "search") setSearch(true);
      if (action === "new-chat") {
        navigate("/new");
        settleDrawer();
      }
      if (action === "main-chat") navigate("/");
      if (action === "shortcuts") setShortcutsOpen(true);
      if (action === "find") setFind((value) => value ?? "");
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.metaKey && !event.isComposing) {
        // Escape belongs to an open dialog or menu first.
        if (
          window.document.querySelector("dialog[open], [role=menu], .find-bar")
        )
          return;
        if (event.shiftKey) {
          event.preventDefault();
          composer.current?.focus();
        } else if (listeningRef.current) void stopDictation().catch(() => {});
        else stopRef.current();
        return;
      }
      if (!event.metaKey || event.altKey) return;
      if (
        event.key.toLowerCase() === "f" ||
        (event.key.toLowerCase() === "k" && event.shiftKey)
      ) {
        event.preventDefault();
        command(new CustomEvent("muse-command", { detail: "find" }));
        return;
      }
      if (event.key === "/" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        command(
          new CustomEvent("muse-command", {
            detail: event.key === "/" ? "shortcuts" : "main-chat",
          }),
        );
        return;
      }
      if (["k", ",", "n"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        command(
          new CustomEvent("muse-command", {
            detail:
              event.key === ","
                ? "settings"
                : event.key.toLowerCase() === "n"
                  ? "new-chat"
                  : "search",
          }),
        );
      }
    };
    window.addEventListener("hashchange", change);
    window.addEventListener("muse-command", command);
    window.addEventListener("keydown", key);
    // The settings window can sign in or out for the whole app.
    const credentials = () => {
      void client.restore().then(() => {
        if (!alive.current) return;
        setConnectionEpoch((value) => value + 1);
        void reload();
      });
    };
    window.addEventListener("muse-credentials-changed", credentials);
    // Quick chat sends into the main chat from its own panel.
    const conversations = () => {
      void reload();
      void refreshTask.current();
    };
    window.addEventListener("muse-conversations-changed", conversations);
    // An Ark key replaced in the settings window or on another device is kept
    // by the account service, not in Keychain, so re-check it on focus.
    const focus = () => {
      void client.syncAccount().then(
        (changed) => {
          if (!changed || !alive.current) return;
          setConnectionEpoch((value) => value + 1);
          void reload();
        },
        () => {},
      );
    };
    window.addEventListener("focus", focus);
    // Startup restores the Keychain login without blocking this window.
    const ready = (event: Event) => {
      if (!alive.current) return;
      const failure = connectionError(event);
      if (failure) setError(failure);
      setConnectionEpoch((value) => value + 1);
      void reload();
    };
    window.addEventListener(connectionReady, ready);
    void reload();
    const timer = setInterval(() => {
      if (!window.document.hidden) void reload();
    }, 15000);
    // The poll skips its work while another window occludes this one, so the
    // workspace reads the connection again as soon as it is visible instead of
    // waiting for the next tick. Drafts and open documents are not touched.
    const visibility = () => {
      if (!window.document.hidden) void reload();
    };
    window.document.addEventListener("visibilitychange", visibility);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("hashchange", change);
      window.removeEventListener("muse-command", command);
      window.removeEventListener("keydown", key);
      window.removeEventListener("muse-credentials-changed", credentials);
      window.removeEventListener("muse-conversations-changed", conversations);
      window.removeEventListener("focus", focus);
      window.removeEventListener(connectionReady, ready);
    };
  }, [reload, client]);
  // Calls for this Mac run only after the person answers. "Allow in this chat"
  // trusts the rest of that conversation until the app quits; every call is
  // answered exactly once and a failed answer is never resent automatically.
  const trustedChats = useRef(new Set<string>());
  const answeringMac = useRef("");
  const answerMac = useCallback(
    (answer: MacAnswer) => {
      if (!id || !macCalls.length || answeringMac.current === macCallKey)
        return;
      answeringMac.current = macCallKey;
      if (answer === "chat") trustedChats.current.add(id);
      const calls = macCalls;
      const session = id;
      void action(async () => {
        const results = [];
        for (const call of calls)
          results.push(
            answer === "deny" ? declinedResult(call) : await runMacTool(call),
          );
        try {
          await client.answerCustomTools(session, results);
        } catch (failure) {
          // The person may try again; the client re-reads history first.
          // A trusted chat stops running calls on its own after a failure.
          answeringMac.current = "";
          trustedChats.current.delete(session);
          throw failure;
        } finally {
          await task.refresh();
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, macCallKey, client],
  );
  useEffect(() => {
    if (id && macCalls.length && trustedChats.current.has(id))
      answerMac("once");
  }, [id, macCallKey, answerMac, macCalls.length]);
  // The person's standing choice in Computer use settings answers computer
  // control for them: always allow, or always deny. It never covers Calendar,
  // Location or a batch that mixes them in, and applies only while on.
  const [macState, setMacState] = useState<ComputerState>();
  useEffect(() => {
    if (!computerAvailable()) return;
    let active = true;
    const refresh = () =>
      void readComputer()
        .then((value) => active && value && setMacState(value))
        .catch(() => {});
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(computerChanged, refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener(computerChanged, refresh);
    };
  }, []);
  useEffect(() => {
    if (!id || !macCalls.length || trustedChats.current.has(id)) return;
    const answer = policyAnswer(macState, macCalls);
    if (answer) answerMac(answer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, macCallKey, macState, answerMac]);
  // The palette reaches goals too; they are read when it opens.
  useEffect(() => {
    if (!search || !ready) return;
    let active = true;
    void Promise.resolve()
      .then(() => client.goals())
      .then((value) => active && setPaletteGoals(value.data))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [search, ready, client]);
  // Spoken text replaces only what this dictation added, so typing before it
  // started is kept and each partial result settles into the final one.
  useEffect(() => {
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<DictationEvent>).detail;
      if (!detail || typeof detail !== "object") return;
      if ("ended" in detail) {
        setListening(false);
        const base = dictationBase.current;
        dictationBase.current = undefined;
        if (detail.error) setError(detail.error);
        // Automatic send applies to dictation that finished on its own terms.
        else if (base && dictationPreferences().autoSend) setAutoSend(base.key);
        return;
      }
      const base = dictationBase.current;
      if (!base || typeof detail.text !== "string") return;
      setDrafts((old) => ({
        ...old,
        [base.key]: joinDictation(base.text, detail.text).slice(0, 16000),
      }));
    };
    window.addEventListener(dictationEvent, listen);
    return () => window.removeEventListener(dictationEvent, listen);
  }, []);
  // Send once the dictated text has settled into the draft it was meant for.
  useEffect(() => {
    if (!autoSend) return;
    setAutoSend(undefined);
    if (autoSend === draftKey && draft.trim()) void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend]);
  // Leaving the conversation ends dictation into it.
  useEffect(() => {
    if (listening && dictationBase.current?.key !== draftKey)
      void stopDictation().catch(() => {});
  }, [draftKey, listening]);
  // Settings can hand over a draft, such as an imported memory, for the main
  // chat; the person reviews and sends it.
  const draftRef = useRef<(text: string) => void>(undefined);
  draftRef.current = (text: string) => {
    navigate("/");
    prefillComposer(text);
  };
  useEffect(() => {
    const draft = (event: Event) => {
      const text = (event as CustomEvent).detail;
      if (typeof text === "string" && text.trim())
        draftRef.current?.(text.slice(0, 16000));
    };
    window.addEventListener("muse-draft", draft);
    return () => window.removeEventListener("muse-draft", draft);
  }, []);
  // Moods left on messages are kept on this Mac for the signed-in account.
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void Promise.resolve()
      .then(() => readReactions(client))
      .then((value) => active && setReactions(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client, ready, connectionEpoch]);
  // In account builds this Mac shows up in the account's device list. It
  // reports itself at start and hourly; a failure never interrupts the app.
  useEffect(() => {
    if (!ready) return;
    const report = () =>
      void Promise.resolve()
        .then(registerThisMac)
        .catch(() => {});
    report();
    const timer = setInterval(report, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [ready, connectionEpoch]);
  // MA image blocks carry no name, so the names come from this device.
  useEffect(() => {
    if (!ready) return;
    void Promise.resolve()
      .then(() => client.attachmentNames())
      .then(setFileNames, () => {});
  }, [client, ready, connectionEpoch]);
  // Due reminders and recurring tasks go into the main chat while the app runs,
  // even with the window closed. Each occurrence is claimed before it is sent
  // and never sent twice; a busy main chat simply waits for the next check.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const epoch = connectionVersion.current;
    const deliver = () =>
      void Promise.resolve()
        .then(() => client.deliverUpcoming(systemLanguage()))
        .then(async (record) => {
          if (!record || !alive || connectionVersion.current !== epoch) return;
          window.dispatchEvent(new Event(upcomingChanged));
          await reload();
          await refreshTask.current();
        })
        .catch(() => {
          /* A reminder never interrupts the person; the next check retries reads only. */
        });
    deliver();
    const timer = setInterval(deliver, UPCOMING_CHECK_INTERVAL);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [ready, client, connectionEpoch, reload]);
  // The first main conversation opens with the companion's welcome, and after
  // a quiet day the main chat may open with one check-in. Both start only while
  // the main chat is in front of the person, and neither interrupts them.
  const mainInFront =
    ready &&
    route.page === "chat" &&
    !route.newSide &&
    (!route.conversation || route.conversation === index.mainId);
  const initiating = useRef(false);
  const welcomed = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!mainInFront) return;
    const run = () => {
      if (window.document.hidden || initiating.current) return;
      initiating.current = true;
      const epoch = connectionVersion.current;
      void (async () => {
        let changed = false;
        if (welcomed.current !== epoch) {
          welcomed.current = epoch;
          changed = true;
          const welcome = await client
            .startWelcome(systemLanguage())
            .catch(async (failure: Error) => {
              if (alive.current) setError(failure.message);
              return client.welcomeState().catch(() => undefined);
            });
          // A check-in never starts while the welcome is still unresolved.
          if (welcome && !["confirmed", "skipped"].includes(welcome.phase))
            return changed;
        }
        const checkIn = await client
          .startCheckIn(systemLanguage())
          .catch(() => undefined);
        return changed || Boolean(checkIn);
      })()
        .then(async (changed) => {
          if (!changed || !alive.current || connectionVersion.current !== epoch)
            return;
          await reload();
          await refreshTask.current();
        })
        .finally(() => {
          initiating.current = false;
        });
    };
    run();
    window.document.addEventListener("visibilitychange", run);
    return () => window.document.removeEventListener("visibilitychange", run);
  }, [mainInFront, client, connectionEpoch, reload]);
  useEffect(() => {
    if (!away && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [id, events.at(-1)?.id, away]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const input = composer.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  }, [draft]);
  useEffect(() => {
    if (inspirationPage && splitChat && quotedPost) composer.current?.focus();
  }, [inspirationPage, splitChat, quotedPost]);
  useEffect(() => {
    if (route.page === "goals" && splitChat) composer.current?.focus();
  }, [route.page, splitChat, goalConversation, draft]);
  useEffect(() => {
    if (route.page === "library" && splitChat && draft)
      composer.current?.focus();
  }, [route.page, splitChat, draft]);
  // A seeded composer takes focus with the caret after the prompt.
  useEffect(() => {
    if (!prefill) return;
    const field = composer.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [prefill]);
  useEffect(() => {
    if (route.page !== "goals") setGoalConversation(undefined);
  }, [route.page]);

  async function action(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  // Dictation writes into the draft that was open when it started.
  async function toggleDictation() {
    if (!dictationAvailable()) {
      setNotice(
        t(
          "Use macOS Dictation from the Edit menu. Built-in voice input needs the Mac app.",
        ),
      );
      return;
    }
    const language = systemLanguage() === "zh-CN" ? "zh-CN" : "en-US";
    try {
      if (listening) {
        await stopDictation();
        return;
      }
      let state = await readDictation(language);
      if (
        state &&
        (state.microphone === "not-asked" || state.speech === "not-asked")
      )
        state = await requestDictation(language);
      if (
        !state ||
        state.microphone !== "allowed" ||
        state.speech !== "allowed"
      ) {
        setError(
          t(
            "Allow the microphone and speech recognition for Open Muse in System Settings.",
          ),
        );
        return;
      }
      dictationBase.current = { key: draftKey, text: draft };
      await startDictation(language, dictationPreferences().cues);
      setListening(true);
      composer.current?.focus();
    } catch (failure) {
      setListening(false);
      setError((failure as Error).message);
    }
  }
  // Stopping is the person's own request; it is sent once, never retried.
  function stop() {
    if (!running || !id) return;
    void action(async () => {
      await client.send(id, { type: "user.interrupt" });
      await task.refresh();
    });
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const listeningRef = useRef(listening);
  listeningRef.current = listening;
  // Each file is checked against the shared limits, then uploaded to MA.
  function attach(files: File[]) {
    const key = draftKey;
    let count = stagedRef.current.length;
    const update = (id: string, patch: Partial<Staged>) =>
      setStagedBy((old) => ({
        ...old,
        [key]: (old[key] ?? []).map((item) =>
          item.key === id ? { ...item, ...patch } : item,
        ),
      }));
    for (const file of files) {
      const item = stageFile(file, count, uuid());
      if (item.state === "uploading") count++;
      setStagedBy((old) => ({ ...old, [key]: [...(old[key] ?? []), item] }));
      if (item.state !== "uploading") continue;
      if (item.kind === "image")
        void thumbnail(file).then(
          (preview) => preview && update(item.key, { preview }),
        );
      client.uploadAttachment(file, file.name, count - 1).then(
        (value) => {
          update(item.key, { state: "ready", value, name: value.name });
          if ("file_id" in value)
            setFileNames((old) => ({ ...old, [value.file_id]: value.name }));
        },
        (failure: Error) =>
          update(item.key, { state: "failed", error: failure.message }),
      );
    }
  }
  // Files dropped on the floating pill wait until the main chat is in front.
  const [dropped, setDropped] = useState<File[]>([]);
  useEffect(() => {
    const receive = (event: Event) => {
      const files = droppedFiles((event as CustomEvent).detail);
      if (!files.length) return;
      setDropped(files);
      setStatusOpen(true);
      navigate("/");
      settleDrawer();
    };
    window.addEventListener(droppedFilesEvent, receive);
    return () => window.removeEventListener(droppedFilesEvent, receive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (
      !dropped.length ||
      route.page !== "chat" ||
      route.newSide ||
      route.conversation
    )
      return;
    if (ready) attach(dropped);
    else setError(t("Connect to Ark MA to start your conversation."));
    setDropped([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropped, route.page, route.newSide, route.conversation, ready]);
  async function send() {
    const text = draft.trim();
    const files = staged.flatMap((item) =>
      item.state === "ready" && item.value ? [item.value] : [],
    );
    if ((!text && !files.length) || running || busyRef.current) return;
    if (staged.some((item) => item.state !== "ready")) {
      setError(t("Wait for uploads to finish or remove failed attachments."));
      return;
    }
    if (!ready) {
      openSettings();
      return;
    }
    const quote =
      !route.newSide && (!id || id === index.mainId) ? quotedPost : undefined;
    const message = quote
      ? `${discussionPrompt(quote)}\n\nMy message:\n${text}`
      : text;
    if (message.length > 16000) {
      setError(
        t(
          "This message and its quoted post exceed the message limit. Shorten your message or remove the quote.",
        ),
      );
      return;
    }
    await action(async () => {
      const epoch = connectionVersion.current;
      if (goalDrafts[draftKey]) {
        await client.prepareGoals();
        if (connectionVersion.current !== epoch)
          throw new Error(
            t("The connection changed. Your message was not sent."),
          );
      }
      let target = id;
      if (!target || target === index.mainId) {
        const session = await client.openConversation(
          route.newSide ? "side" : "main",
          route.newSide ? text.slice(0, 60) : t("Main chat"),
        );
        target = session.id;
        setIndex(await client.conversationIndex());
        // Keep an unconfirmed message with its exact conversation, even across route changes.
        setDrafts((old) => ({ ...old, [draftKey]: "", [target!]: text }));
        if (!inspirationPage) navigate(route.newSide ? `/chat/${target}` : "/");
      }
      await client.send(target, {
        type: "user.message",
        text: message,
        ...(files.length ? { attachments: files } : {}),
      });
      setStagedBy((old) => ({ ...old, [draftKey]: [], [target!]: [] }));
      if (quote) setQuotedPost(undefined);
      setDrafts((old) => ({ ...old, [target!]: "" }));
      setGoalDrafts((old) => ({ ...old, [draftKey]: false, [target!]: false }));
      setAway(false);
      await task.refresh();
      await reload();
    });
  }
  const openDocument = (name: IdentityDocumentName) =>
    void action(async () => {
      const current = await client.companionIdentity();
      setIdentity(current);
      setDocument(current.documents[name]);
      settleDrawer();
    });
  const confirm = (result: "allow" | "deny", event: AgentEvent) =>
    void action(async () => {
      if (!id) return;
      await client.send(id, {
        type: "user.tool_confirmation",
        tool_use_id: event.id,
        result,
      });
      await task.refresh();
    });
  const openChat = (session: Session) => {
    navigate(`/chat/${session.id}`);
    setSearch(false);
    settleDrawer();
    setQuery("");
  };
  const messages = chatMessages(events);
  useUnreadBadge(id, messages);
  const readAloud = useReadAloud();
  const companionState: CompanionState = running
    ? "thinking"
    : readAloud.speaking
      ? "speaking"
      : "";
  useEffect(() => postCompanion(name, companionState), [name, companionState]);
  // A voice conversation sends each spoken turn through the normal send, so
  // quotes, goals and connection checks apply exactly as when typing.
  const voice = useVoiceConversation({
    messages,
    running,
    submit: (text) => {
      setDrafts((old) => ({ ...old, [draftKey]: text }));
      setAutoSend(draftKey);
    },
    onError: setError,
    onIdle: () =>
      setNotice(t("The voice conversation ended because nothing was heard.")),
  });
  const endVoice = voice.end;
  // Moving to another conversation hangs up.
  useEffect(() => () => endVoice(), [draftKey, endVoice]);
  const voiceAvailable = dictationAvailable() && speechAvailable();
  const parts = messageParts(messages, events);
  const links = groupLinks(
    parts.map(({ event, part }) => ({
      side: event.type === "user.message" ? "user" : "agent",
      at: event.processed_at ?? event.created_at,
      reacted: Boolean(reactions[event.id]) && part !== "intro",
    })),
  );
  const found = findMatches(parts, find ?? "", (event) =>
    messageAttachments(event, fileNames).map((item) => item.name),
  );
  const current = found.length ? found[findAt % found.length] : undefined;
  // The current match scrolls into the middle of the conversation.
  useEffect(() => {
    if (!current) return;
    setAway(true);
    scroll.current
      ?.querySelector(`[data-part="${CSS.escape(current)}"]`)
      ?.scrollIntoView?.({
        block: "center",
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? "auto"
          : "smooth",
      });
  }, [current]);
  // Find belongs to one conversation.
  useEffect(() => setFind(undefined), [id]);
  const activeChoice = currentChoiceEvent(currentEvents)?.id;
  const chatTitle = route.newSide
    ? t("New side chat")
    : id && id !== index.mainId
      ? (index.entries[id]?.title ??
        goalLabels[id] ??
        task.session?.title ??
        t("Side chat"))
      : navLabel("chat");

  return (
    <div
      className={`desktop-shell ${inspirationPage && splitChat ? "side-split" : ""} ${route.page === "library" && splitChat ? "library-split" : ""}`}
    >
      <Rail
        page={route.page}
        onNavigate={goPage}
        companion={
          route.page === "chat" || document
            ? undefined
            : {
                name,
                onOpen: () => {
                  setStatusOpen(true);
                  goPage("chat");
                },
              }
        }
        onSearch={() => {
          setQuery("");
          setSearch(true);
        }}
        onShortcuts={() => setShortcutsOpen(true)}
        onSettings={() =>
          document || feedEditorOpen.current
            ? setNotice(
                t(
                  "Close the document before switching accounts. Your draft is preserved.",
                ),
              )
            : openSettings()
        }
      />
      {/* A pinned panel docks on the chat page only; elsewhere it waits there
          until the person comes back to the chat. */}
      {drawer && !document && (route.page === "chat" || !keepPanel) && (
        <SideChatsPanel
          chats={sideChats(sessions, index, "").map(panelRow)}
          archivedChats={sideChats(sessions, index, "", true).map(panelRow)}
          main={(() => {
            const session = sessions.find((item) => item.id === index.mainId);
            return session ? { updatedAt: panelRow(session).updatedAt } : {};
          })()}
          activeId={id}
          mainActive={
            route.page === "chat" &&
            !route.newSide &&
            (!id || id === index.mainId)
          }
          drafting={route.page === "chat" && Boolean(route.newSide)}
          query={query}
          onQuery={setQuery}
          keepVisible={keepPanel}
          onKeepVisible={(value) => {
            setKeepChatPanelVisible(value);
            setKeepPanel(value);
          }}
          width={drawerWidth}
          onWidth={(value, done) => {
            setDrawerWidth(value);
            if (done) storeChatPanelWidth(value);
          }}
          onClose={() => {
            setKeepChatPanelVisible(false);
            setKeepPanel(false);
            setDrawer(false);
          }}
          onOpenMain={() => {
            navigate("/");
            settleDrawer();
          }}
          onOpenChat={(chat) => {
            const session = sessions.find((item) => item.id === chat);
            if (session) openChat(session);
          }}
          onNewChat={() => {
            navigate("/new");
            settleDrawer();
          }}
          onUnarchive={(chat) =>
            void action(async () => {
              await client.archiveConversation(chat, false);
              await reload();
            })
          }
        />
      )}
      {document && (
        <Suspense
          fallback={
            <main className="workspace">
              <Empty title={t("Opening document…")} />
            </main>
          }
        >
          <DocumentEditor
            key={document.name}
            initial={document}
            client={client}
            connected={ready}
            onSaved={setIdentity}
            onClose={() => setDocument(undefined)}
            onChat={() => {
              setDocument(undefined);
              location.hash = "/";
            }}
          />
        </Suspense>
      )}
      {route.page === "feed" && !document && (
        <main className="workspace">
          <FeedPage
            key={connectionEpoch}
            client={client}
            split={splitChat}
            onToggleChat={() => setSplitChat((value) => !value)}
            onEditorChange={onFeedEditorChange}
            onConnect={() => openSettings()}
            onOpenChat={(id) => navigate(`/chat/${id}`)}
            onDiscuss={(item) => {
              setQuotedPost(item);
              setSplitChat(true);
            }}
          />
        </main>
      )}
      {route.page === "ideas" && !document && (
        <main className="workspace">
          <Suspense fallback={<Empty title={t("Opening ideas…")} />}>
            <IdeasPage
              key={connectionEpoch}
              client={client}
              split={splitChat}
              onToggleChat={() => setSplitChat((value) => !value)}
              onEditorChange={onFeedEditorChange}
              onConnect={() => openSettings()}
              onOpenChat={(id) => navigate(`/chat/${id}`)}
              onMainChat={async (id) => {
                const conversations = await client.conversationIndex();
                if (
                  !alive.current ||
                  connectionVersion.current !== connectionEpoch
                )
                  return;
                setIndex(conversations);
                setQuotedPost(undefined);
                if (
                  currentConversation(conversations, id) ===
                  conversations.mainId
                )
                  setSplitChat(true);
                else navigate(`/chat/${id}`);
                await reload();
              }}
            />
          </Suspense>
        </main>
      )}
      {route.page === "goals" && !document && (
        <main className="workspace">
          <WorkspaceBoundary key={connectionEpoch}>
            <Suspense fallback={<Empty title={t("Opening goals…")} />}>
              <GoalsPage
                key={connectionEpoch}
                client={client}
                selectedId={route.goal}
                onSelect={(id) => navigate(id ? `/goals/${id}` : "/goals")}
                split={splitChat}
                onToggleChat={() => setSplitChat((value) => !value)}
                onEditorChange={onFeedEditorChange}
                onConnect={() => openSettings()}
                onOpenChat={(id) => navigate(`/chat/${id}`)}
                onConversation={async (id) => {
                  const [conversations, labels] = await Promise.all([
                    client.conversationIndex(),
                    new MacGoals(client).labels(),
                  ]);
                  if (
                    !alive.current ||
                    connectionVersion.current !== connectionEpoch ||
                    routePage.current !== "goals"
                  )
                    throw new Error(
                      t(
                        "The workspace changed. Reopen Goals to continue the saved conversation.",
                      ),
                    );
                  setIndex(conversations);
                  setGoalLabels(labels);
                  setGoalConversation(id);
                  setQuotedPost(undefined);
                  setSplitChat(true);
                  await reload();
                }}
                onDraft={(text) => {
                  const key = index.mainId ?? "main";
                  setGoalConversation(undefined);
                  setQuotedPost(undefined);
                  setSplitChat(true);
                  if (drafts[key]?.trim() && drafts[key] !== text)
                    setGoalDraftReplacement({ key, text, goal: true });
                  else {
                    setDrafts((old) => ({ ...old, [key]: text }));
                    setGoalDrafts((old) => ({ ...old, [key]: true }));
                  }
                }}
              />
            </Suspense>
          </WorkspaceBoundary>
        </main>
      )}
      {route.page === "library" && !document && (
        <main className="workspace library-workspace">
          <WorkspaceBoundary key={connectionEpoch}>
            <Suspense fallback={<Empty title={t("Opening Library…")} />}>
              <LibraryPage
                key={connectionEpoch}
                client={client}
                identity={identity}
                view={route.libraryView ?? "all"}
                split={splitChat}
                onView={(view) => navigate(libraryPath(view))}
                onConnect={() => openSettings()}
                onToggleChat={() => setSplitChat((value) => !value)}
                onOpenChat={(id) => navigate(`/chat/${id}`)}
                onDocument={openDocument}
                onDraft={(text) => {
                  const key = index.mainId ?? "main";
                  setQuotedPost(undefined);
                  setSplitChat(true);
                  if (drafts[key]?.trim() && drafts[key] !== text)
                    setGoalDraftReplacement({ key, text });
                  else {
                    setDrafts((old) => ({ ...old, [key]: text }));
                    setGoalDrafts((old) => ({ ...old, [key]: false }));
                  }
                }}
              />
            </Suspense>
          </WorkspaceBoundary>
        </main>
      )}
      <main
        className={`workspace ${inspirationPage ? "feed-split-chat" : ""} ${route.page === "library" ? "library-split-chat" : ""}`}
        hidden={Boolean(document) || (inspirationPage && !splitChat)}
      >
        {route.page === "chat" || (inspirationPage && splitChat) ? (
          <>
            <header className="chat-toolbar">
              {/* A pinned panel stands in for its own toggle. */}
              {!(drawer && keepPanel && route.page === "chat") && (
                <button
                  className="glass-pill"
                  aria-label={t("Open chats and side chats")}
                  aria-expanded={drawer}
                  onClick={() => setDrawer((value) => !value)}
                >
                  <Menu size={19} />
                  <span className="glass-pill-label">{chatTitle}</span>
                </button>
              )}
              <div className="toolbar-spacer" />
              {route.page === "chat" && !statusOpen && (
                // With the status panel closed, the companion sits at the top
                // of the conversation and reopens it.
                <button
                  className="toolbar-avatar companion-float"
                  aria-label={t("Assistant status")}
                  onClick={() => setStatusOpen(true)}
                >
                  <span className="companion-face">
                    <Avatar />
                  </span>
                  <span className="companion-name">{name}</span>
                </button>
              )}
              {inspirationPage && (
                <button
                  className="glass-pill"
                  aria-label={t("Close side-by-side chat")}
                  onClick={() => setSplitChat(false)}
                >
                  <X size={18} />
                </button>
              )}
              <button
                className="glass-pill"
                aria-label={t("Conversation options")}
                aria-expanded={menu}
                onClick={() => setMenu((value) => !value)}
              >
                <MoreHorizontal size={20} />
              </button>
              {menu && (
                <div className="conversation-menu">
                  <button
                    onClick={() => {
                      navigate("/new");
                      setMenu(false);
                    }}
                  >
                    {t("New side chat")}
                  </button>
                  <button
                    onClick={() => {
                      if (inspirationPage)
                        navigate(
                          id && id !== index.mainId ? `/chat/${id}` : "/",
                        );
                      setStatusOpen(true);
                      setMenu(false);
                    }}
                  >
                    {t("Assistant status")}
                  </button>
                  {id && id !== index.mainId && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await client.archiveConversation(
                            id,
                            !index.entries[id]?.archived,
                          );
                          await reload();
                          navigate("/");
                          setMenu(false);
                        })
                      }
                    >
                      {index.entries[id]?.archived
                        ? t("Unarchive")
                        : t("Archive")}{" "}
                      {t("side chat")}
                    </button>
                  )}
                </div>
              )}
            </header>
            {find !== undefined && (
              <FindBar
                query={find}
                onQuery={(value) => {
                  setFind(value);
                  setFindAt(0);
                }}
                count={found.length}
                position={found.length ? findAt % found.length : 0}
                onStep={(step) =>
                  setFindAt(
                    (value) =>
                      (value + step + found.length) % (found.length || 1),
                  )
                }
                onClose={() => {
                  setFind(undefined);
                  composer.current?.focus();
                }}
              />
            )}
            <div
              className="chat-scroll"
              ref={scroll}
              role="log"
              aria-label={t("Chat messages")}
              aria-busy={task.loading}
              onScroll={() => {
                const element = scroll.current;
                if (element)
                  setAway(
                    element.scrollHeight -
                      element.clientHeight -
                      element.scrollTop >
                      90,
                  );
              }}
            >
              {!messages.length && !task.loading && (
                <Empty
                  title={
                    route.newSide
                      ? t("Start a side chat")
                      : t("Hello, I'm {name}", { name })
                  }
                >
                  <p>
                    {ready
                      ? t("What's on your mind?")
                      : t("Connect to Ark MA to start your conversation.")}
                  </p>
                  {!ready && (
                    <button
                      className="pill-button"
                      onClick={() => openSettings()}
                    >
                      {t("Connect to Ark MA")}
                    </button>
                  )}
                </Empty>
              )}
              {task.loading && !messages.length && (
                <p className="subtle loading-label">
                  {t("Loading your conversation…")}
                </p>
              )}
              <div className="message-stack">
                {parts.map(({ event, part }, index) => (
                  <article
                    key={`${event.id}:${part}`}
                    data-part={partKey({ event, part })}
                    className={`message ${event.type === "user.message" ? "from-user" : "from-assistant"}${links[index].prev ? " grouped-prev" : ""}${links[index].next ? " grouped-next" : ""}${found.includes(partKey({ event, part })) ? " found" : ""}${current === partKey({ event, part }) ? " current" : ""}`}
                  >
                    <div className="message-bubble">
                      {event.type === "agent.message" ? (
                        <AssistantContent
                          text={eventText(event)}
                          part={part}
                          reply={event.choice_reply}
                          active={
                            !event.source_session_id &&
                            activeChoice === event.id
                          }
                          busy={busy || task.loading}
                          streaming={running}
                          onChoose={(option) =>
                            void action(async () => {
                              if (!id) return;
                              try {
                                await client.answerChoice(
                                  id,
                                  event.id,
                                  option,
                                  digest(eventText(event)),
                                );
                                setAway(false);
                              } finally {
                                await task.refresh();
                              }
                            })
                          }
                        />
                      ) : (
                        <>
                          <SentFiles
                            items={messageAttachments(event, fileNames)}
                          />
                          {eventText(event) && (
                            <Markdown text={eventText(event)} />
                          )}
                        </>
                      )}
                    </div>
                    {reactions[event.id] && part !== "intro" && (
                      <span
                        className="message-mood"
                        aria-label={t("Your mood: {mood}", {
                          mood: reactions[event.id],
                        })}
                      >
                        {reactions[event.id]}
                      </span>
                    )}
                    <MessageActions
                      fromAssistant={event.type === "agent.message"}
                      mood={reactions[event.id]}
                      busy={busy}
                      onMood={(mood) =>
                        void setReaction(client, event.id, mood).then(
                          (next) => alive.current && setReactions(next),
                        )
                      }
                      onCopy={() =>
                        void action(async () => {
                          await navigator.clipboard.writeText(eventText(event));
                          setNotice(t("Message copied"));
                        })
                      }
                      onReply={() => {
                        setDrafts((old) => ({
                          ...old,
                          [draftKey]: `> ${eventText(event).replaceAll("\n", "\n> ")}\n\n`,
                        }));
                        composer.current?.focus();
                      }}
                      onSave={
                        event.type === "agent.message"
                          ? () =>
                              void action(async () => {
                                await client.saveReply(
                                  event.source_session_id ?? id!,
                                  event.source_event_id ?? event.id,
                                );
                                setNotice(t("Saved to Library"));
                                window.dispatchEvent(
                                  new Event("muse-library-changed"),
                                );
                              })
                          : undefined
                      }
                      speaking={readAloud.speaking === event.id}
                      onSpeak={
                        event.type === "agent.message" && speechAvailable()
                          ? () =>
                              void readAloud
                                .toggle(event.id, eventText(event))
                                .catch((failure: Error) =>
                                  setError(failure.message),
                                )
                          : undefined
                      }
                      onSelect={() => {
                        const bubble = scroll.current?.querySelector(
                          `[data-part="${CSS.escape(partKey({ event, part }))}"] .message-bubble`,
                        );
                        const selection = window.getSelection();
                        if (!bubble || !selection) return;
                        selection.selectAllChildren(bubble);
                      }}
                    />
                  </article>
                ))}
              </div>
              {running && (
                <p className="thinking" role="status">
                  {approvals.length || macCalls.length
                    ? t("Waiting for your approval")
                    : elsewhere.length
                      ? elsewhere.every((call) => call.name === healthToolName)
                        ? t("Waiting for your iPhone")
                        : t("Waiting for another device")
                      : t("{name} is working…", { name })}
                </p>
              )}
            </div>
            {away && (
              <button
                className="jump-latest"
                aria-label={t("Jump to latest message")}
                onClick={() => setAway(false)}
              >
                <ArrowDown size={18} />
              </button>
            )}
            {macCalls.length > 0 && (
              <ComputerRequests
                calls={macCalls}
                busy={busy || answeringMac.current === macCallKey}
                onAnswer={answerMac}
                onSettings={(section) => {
                  if (!openNativeSettings(section)) setSettings(true);
                }}
              />
            )}
            {approvals.length > 0 && (
              <button
                className="approval-banner"
                onClick={() => {
                  if (inspirationPage)
                    navigate(id && id !== index.mainId ? `/chat/${id}` : "/");
                  setStatusOpen(true);
                  setStatusTab("approvals");
                }}
              >
                <ShieldCheck size={17} />
                {t(
                  approvals.length === 1
                    ? "{count} approval needed"
                    : "{count} approvals needed",
                  { count: approvals.length },
                )}
              </button>
            )}
            {quotedPost && !route.newSide && (!id || id === index.mainId) && (
              <aside className="feed-quote">
                <MessageCircle size={15} />
                <span>{quotedPost.title}</span>
                <button
                  className="icon-button"
                  aria-label={t("Remove quoted post")}
                  onClick={() => setQuotedPost(undefined)}
                >
                  <X size={15} />
                </button>
              </aside>
            )}
            {voice.state !== "off" && (
              <div className={`voice-bar ${voice.state}`} role="status">
                <span className="voice-dot" aria-hidden="true" />
                <span>{t(voiceLabels[voice.state])}</span>
                <button
                  type="button"
                  className="pill-button"
                  onClick={voice.end}
                >
                  {t("End")}
                </button>
              </div>
            )}
            <form
              className={`desktop-composer ${staged.length ? "has-files" : ""}`}
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
              onDragOver={(event) => {
                if (ready && event.dataTransfer.types.includes("Files"))
                  event.preventDefault();
              }}
              onDrop={(event) => {
                if (!ready || !event.dataTransfer.files.length) return;
                event.preventDefault();
                attach([...event.dataTransfer.files]);
              }}
            >
              <StagedFiles
                items={staged}
                onRemove={(key) =>
                  setStagedBy((old) => ({
                    ...old,
                    [draftKey]: (old[draftKey] ?? []).filter(
                      (item) => item.key !== key,
                    ),
                  }))
                }
              />
              <input
                ref={filePicker}
                type="file"
                multiple
                hidden
                accept={attachmentAccept}
                onChange={(event) => {
                  attach([...(event.currentTarget.files ?? [])]);
                  event.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={t("Attach files")}
                disabled={!ready}
                onClick={() => filePicker.current?.click()}
              >
                <Plus size={23} />
              </button>
              <textarea
                ref={composer}
                rows={1}
                value={draft}
                maxLength={16000}
                aria-label={t("Message {name}", { name })}
                placeholder={t("Message")}
                onChange={(event) =>
                  setDrafts((old) => ({
                    ...old,
                    [draftKey]: event.target.value,
                  }))
                }
                onPaste={(event) => {
                  const files = [...event.clipboardData.files];
                  if (!ready || !files.length) return;
                  event.preventDefault();
                  attach(files);
                }}
                onKeyDown={(event) => {
                  if (
                    shouldSendOnKey({
                      ...event,
                      isComposing: event.nativeEvent.isComposing,
                    })
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                type="button"
                className={`icon-button dictate ${listening ? "listening" : ""}`}
                aria-label={
                  listening ? t("Stop dictation") : t("Dictate a message")
                }
                aria-pressed={listening}
                onClick={() => void toggleDictation()}
              >
                <Mic size={20} />
              </button>
              {voiceAvailable && (
                <button
                  type="button"
                  className={`icon-button voice ${voice.state !== "off" ? "active" : ""}`}
                  aria-label={
                    voice.state === "off"
                      ? t("Start a voice conversation")
                      : t("End the voice conversation")
                  }
                  aria-pressed={voice.state !== "off"}
                  disabled={!ready}
                  onClick={() =>
                    voice.state === "off" ? void voice.start() : voice.end()
                  }
                >
                  <AudioLines size={20} />
                </button>
              )}
              {running ? (
                <button
                  type="button"
                  className="send-button"
                  aria-label={t("Stop response")}
                  disabled={busy}
                  onClick={stop}
                >
                  <Square size={15} />
                </button>
              ) : (
                <button
                  className="send-button"
                  aria-label={t("Send")}
                  disabled={
                    busy ||
                    (!draft.trim() && !staged.length) ||
                    staged.some((item) => item.state !== "ready")
                  }
                >
                  <ArrowUp size={21} />
                </button>
              )}
            </form>
          </>
        ) : (
          <section className="feature-page">
            <header>
              <h1>{route.page[0].toUpperCase() + route.page.slice(1)}</h1>
            </header>
            <Empty title={t("Desktop view in progress")}>
              <p>
                {t(
                  "This Mac-specific view has not been implemented yet. No sample or simulated content is shown.",
                )}
              </p>
              <button className="pill-button" onClick={() => goPage("chat")}>
                {t("Back to chat")}
              </button>
            </Empty>
          </section>
        )}
        {(error || task.error) && (
          <div className="error-banner" role="alert">
            <span>{error || task.error}</span>
            <button
              className="icon-button"
              aria-label={t("Refresh history")}
              onClick={() => {
                void reload();
                void task.refresh();
              }}
            >
              <ArrowDown size={16} />
            </button>
          </div>
        )}
      </main>
      {route.page === "chat" && !document && !statusOpen && !panelSettle && (
        <PanelEdgeHandle
          mode="open"
          width={panelWidth()}
          label={t("Click or drag to open the status panel")}
          onDrag={setPanelDrag}
          onCommit={commitPanel}
        />
      )}
      {route.page === "chat" &&
        !document &&
        (statusOpen || panelSettle || panelDrag.kind === "opening") && (
          <div
            ref={panelSurface}
            className={`status-surface${panelDrag.kind !== "idle" || panelSettle ? " is-moving" : ""}`}
            data-preview={
              panelDrag.kind === "closing" && panelDrag.preview
                ? "closing"
                : undefined
            }
            style={
              panelDrag.kind === "opening"
                ? {
                    width: panelDrag.reveal,
                    opacity: panelOpacity(panelDrag.reveal, panelWidth()),
                  }
                : undefined
            }
          >
            {statusOpen && (
              <PanelEdgeHandle
                mode="close"
                width={panelWidth()}
                label={t("Click or drag to close the status panel")}
                onDrag={setPanelDrag}
                onCommit={commitPanel}
              />
            )}
            <StatusPanel
              identity={identity}
              status={
                !ready
                  ? t("Not connected")
                  : running
                    ? t("Working")
                    : task.connected
                      ? t("Connected")
                      : id
                        ? t("Reconnecting…")
                        : t("Ready")
              }
              tone={
                !ready
                  ? "offline"
                  : running
                    ? "busy"
                    : task.connected || !id
                      ? "online"
                      : "offline"
              }
              tab={statusTab}
              onTab={setStatusTab}
              onClose={() => setStatusOpen(false)}
              events={currentEvents}
              approvals={approvals}
              busy={busy}
              onConfirm={confirm}
              onDocument={openDocument}
              onPrefill={prefillComposer}
              upcoming={
                <UpcomingTab
                  client={client}
                  connected={ready}
                  onEdit={prefillComposer}
                />
              }
            />
          </div>
        )}
      {shortcutsOpen && (
        <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />
      )}
      {settings && (
        <Modal title={t("Settings")} wide onClose={() => setSettings(false)}>
          <AuthPanel
            client={client}
            onChanged={() => {
              void reload();
              setDrafts({});
              setQuotedPost(undefined);
              setGoalConversation(undefined);
              setGoalLabels({});
              setGoalDrafts({});
              setGoalDraftReplacement(undefined);
              setConnectionEpoch((value) => value + 1);
            }}
          />
        </Modal>
      )}
      {search && (
        <CommandPalette
          query={query}
          onQuery={setQuery}
          loading={loading}
          items={paletteItems({
            query,
            chats: [
              ...sessions.filter((session) => session.id === index.mainId),
              ...sideChats(sessions, index, ""),
            ].map((session) => ({
              id: session.id,
              title: index.entries[session.id]?.title ?? session.title,
              preview: session.preview,
              updatedAt: session.updated_at,
              main: session.id === index.mainId,
            })),
            goals: paletteGoals,
            assistantName: name,
            onPage: goPage,
            onNewChat: () => navigate("/new"),
            onSettings: openSettings,
            onShortcuts: () => setShortcutsOpen(true),
            onChat: (chat) => {
              if (chat === index.mainId) return navigate("/");
              const session = sessions.find((item) => item.id === chat);
              if (session) openChat(session);
            },
            onGoal: (goal) => navigate(`/goals/${goal}`),
            onWrite: (text) => {
              navigate("/");
              prefillComposer(text);
            },
          })}
          onClose={() => {
            setSearch(false);
            setQuery("");
          }}
        />
      )}
      {goalDraftReplacement && (
        <Modal
          title={t("Replace the composer draft?")}
          onClose={() => setGoalDraftReplacement(undefined)}
        >
          <p>
            {goalDraftReplacement.goal
              ? t(
                  "Your existing message has not been sent. Replace it with the goal prompt?",
                )
              : t(
                  "Your existing message has not been sent. Replace it with the creation prompt?",
                )}
          </p>
          <div className="feed-dialog-actions">
            <button
              className="pill-button"
              onClick={() => setGoalDraftReplacement(undefined)}
            >
              {t("Keep my draft")}
            </button>
            <button
              className="pill-button"
              onClick={() => {
                const { key, text, goal } = goalDraftReplacement;
                setDrafts((old) => ({ ...old, [key]: text }));
                setGoalDrafts((old) => ({ ...old, [key]: Boolean(goal) }));
                setGoalDraftReplacement(undefined);
              }}
            >
              {t("Replace draft")}
            </button>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="desktop-toast" role="status">
          {notice}
          <button
            className="icon-button"
            aria-label={t("Dismiss notification")}
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
