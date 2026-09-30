import { t } from "../../shared/i18n";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Menu,
  MessageCircle,
  MessagesSquare,
  Mic,
  MoreHorizontal,
  Plus,
  Search,
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
import { WorkspaceBoundary } from "./WorkspaceBoundary";
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
  pendingPermissions,
  taskState,
  type AgentEvent,
  type Session,
} from "../../shared/types";
import { canAutoApprove } from "../../shared/approval-policy";
import { ArchiveToggle, Empty, Modal, Rail } from "./Chrome";
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
  const [drawer, setDrawer] = useState(false);
  const [statusOpen, setStatusOpen] = useState(true);
  const [statusTab, setStatusTab] = useState<StatusTab>("activity");
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
  const [archived, setArchived] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(client.signedIn());
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState(false);
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
  const task = useTask(client, id);
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
  const chats = sideChats(sessions, index, query, archived);

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
  const goPage = (page: Page) => {
    // Reselecting Library closes the side-by-side chat and keeps the category.
    if (
      page === "library" &&
      route.page === "library" &&
      !activeDocument.current &&
      !feedEditorOpen.current
    ) {
      setSplitChat(false);
      setDrawer(false);
      return;
    }
    navigate(page === "chat" ? "/" : `/${page}`);
    setDrawer(false);
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
        setDrawer(false);
      }
      if (action === "main-chat") navigate("/");
    };
    const key = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey) return;
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
    void reload();
    const timer = setInterval(() => {
      if (!window.document.hidden) void reload();
    }, 15000);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener("hashchange", change);
      window.removeEventListener("muse-command", command);
      window.removeEventListener("keydown", key);
      window.removeEventListener("muse-credentials-changed", credentials);
    };
  }, [reload, client]);
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
  async function send() {
    const text = draft.trim();
    if (!text || running || busyRef.current) return;
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
      });
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
      setDrawer(false);
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
    setDrawer(false);
    setQuery("");
  };
  const messages = chatMessages(events);
  const chatTitle = route.newSide
    ? t("New side chat")
    : id && id !== index.mainId
      ? (index.entries[id]?.title ??
        goalLabels[id] ??
        task.session?.title ??
        t("Side chat"))
      : t("Chat");

  return (
    <div
      className={`desktop-shell ${route.page === "library" && splitChat ? "library-split" : ""}`}
    >
      <Rail
        page={route.page}
        onNavigate={goPage}
        onSearch={() => {
          setQuery("");
          setSearch(true);
        }}
        onSettings={() =>
          document || feedEditorOpen.current
            ? setNotice(
                t(
                  "Close the document before switching accounts. Your draft is preserved.",
                ),
              )
            : openSettings()
        }
        onStatus={() => {
          if (route.page !== "chat") {
            navigate("/");
            setStatusOpen(true);
          } else setStatusOpen((value) => !value);
        }}
      />
      {drawer && !document && (
        <aside className="chat-drawer" aria-label={t("Side chats")}>
          <header>
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label={t("Search side chats")}
                placeholder={t("Search")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <ArchiveToggle
              archived={archived}
              onChange={() => setArchived((value) => !value)}
            />
          </header>
          <button
            className="main-chat-link"
            onClick={() => {
              navigate("/");
              setDrawer(false);
            }}
          >
            <MessageCircle size={17} /> {t("Main chat")}
          </button>
          <div className="side-chat-list">
            {chats.map((session) => (
              <button
                key={session.id}
                aria-current={session.id === id ? "page" : undefined}
                onClick={() => openChat(session)}
              >
                {index.entries[session.id]?.title ?? session.title}
              </button>
            ))}
            {!chats.length && (
              <Empty
                title={
                  query
                    ? t("No matching chats")
                    : archived
                      ? t("No archived chats")
                      : t("Start a side chat")
                }
                icon={<MessagesSquare size={29} strokeWidth={1.4} />}
              >
                <p>
                  {t(
                    "Side chats are an optional way to organize conversations by topic.",
                  )}
                </p>
                <button
                  className="pill-button"
                  onClick={() => {
                    navigate("/new");
                    setDrawer(false);
                  }}
                >
                  {t("New side chat")}
                </button>
              </Empty>
            )}
          </div>
          <button
            className="drawer-new"
            onClick={() => {
              navigate("/new");
              setDrawer(false);
            }}
          >
            <Plus size={17} /> {t("New side chat")}
          </button>
        </aside>
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
              <button
                className="glass-pill"
                aria-label={t("Open chats and side chats")}
                aria-expanded={drawer}
                onClick={() => setDrawer((value) => !value)}
              >
                <Menu size={19} />
                {chatTitle}
              </button>
              <div className="toolbar-spacer" />
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
                {messages.map((event) => (
                  <article
                    key={event.id}
                    className={`message ${event.type === "user.message" ? "from-user" : "from-assistant"}`}
                  >
                    <div className="message-bubble">
                      <Markdown text={eventText(event)} />
                    </div>
                    <div className="message-actions">
                      <button
                        aria-label={t("Copy message")}
                        onClick={() =>
                          void action(async () => {
                            await navigator.clipboard.writeText(
                              eventText(event),
                            );
                            setNotice(t("Message copied"));
                          })
                        }
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        aria-label={t("Reply to message")}
                        onClick={() => {
                          setDrafts((old) => ({
                            ...old,
                            [draftKey]: `> ${eventText(event).replaceAll("\n", "\n> ")}\n\n`,
                          }));
                          composer.current?.focus();
                        }}
                      >
                        <MessagesSquare size={14} />
                      </button>
                      {event.type === "agent.message" && (
                        <button
                          aria-label={t("Save reply to library")}
                          disabled={busy}
                          onClick={() =>
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
                          }
                        >
                          <Plus size={15} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {running && (
                <p className="thinking" role="status">
                  {approvals.length
                    ? t("Waiting for your approval")
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
            <form
              className="desktop-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <button
                type="button"
                className="icon-button"
                aria-label={t("Attach files")}
                onClick={() =>
                  setNotice(
                    t(
                      "File attachments are not connected in this desktop build yet.",
                    ),
                  )
                }
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
                className="icon-button"
                aria-label={t("Dictate a message")}
                onClick={() =>
                  setNotice(
                    t(
                      "Use macOS Dictation from the Edit menu. Built-in voice input is not connected yet.",
                    ),
                  )
                }
              >
                <Mic size={20} />
              </button>
              {running ? (
                <button
                  type="button"
                  className="send-button"
                  aria-label={t("Stop response")}
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      if (id) {
                        await client.send(id, { type: "user.interrupt" });
                        await task.refresh();
                      }
                    })
                  }
                >
                  <Square size={15} />
                </button>
              ) : (
                <button
                  className="send-button"
                  aria-label={t("Send")}
                  disabled={busy || !draft.trim()}
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
      {statusOpen && route.page === "chat" && !document && (
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
          tab={statusTab}
          onTab={setStatusTab}
          onClose={() => setStatusOpen(false)}
          events={currentEvents}
          approvals={approvals}
          busy={busy}
          onConfirm={confirm}
          onDocument={openDocument}
        />
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
        <Modal
          title={t("Search")}
          onClose={() => {
            setSearch(false);
            setQuery("");
          }}
        >
          <label className="search-field">
            <Search size={20} />
            <input
              autoFocus
              placeholder={t("Search chats")}
              aria-label={t("Search all chats")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="search-results">
            {sessions
              .filter(
                (session) =>
                  !index.entries[session.id]?.continuedBy &&
                  (index.entries[session.id]?.title ?? session.title)
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .map((session) => (
                <button key={session.id} onClick={() => openChat(session)}>
                  <MessageCircle size={18} />
                  {index.entries[session.id]?.title ?? session.title}
                </button>
              ))}
            {!sessions.length && (
              <p className="subtle">
                {loading ? t("Loading…") : t("No chats yet")}
              </p>
            )}
          </div>
        </Modal>
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
