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
  const activeDocument = useRef<IdentityDocument | undefined>(undefined);
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
  const id =
    route.page === "chat" && !route.newSide
      ? route.conversation
        ? currentConversation(index, route.conversation)
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
      const [remote, conversations, identity] = await Promise.all([
        client.sessions(),
        client.conversationIndex(),
        client.companionIdentity(),
      ]);
      if (!alive.current) return;
      setSessions(remote.data);
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
    if (activeDocument.current) {
      setNotice(
        "Close the document before leaving this workspace. Your draft is preserved.",
      );
      return;
    }
    location.hash = path;
  }
  const goPage = (page: Page) => {
    navigate(page === "chat" ? "/" : `/${page}`);
    setDrawer(false);
    setQuery("");
  };
  useEffect(() => {
    alive.current = true;
    const change = () => {
      setRoute(parseRoute(location.hash));
      setError("");
      setMenu(false);
      setAway(false);
    };
    const command = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (activeDocument.current) {
        setNotice(
          "Close the document before switching workspaces or accounts. Your draft is preserved.",
        );
        return;
      }
      if (action === "settings") setSettings(true);
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
    };
  }, [reload]);
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
      setSettings(true);
      return;
    }
    await action(async () => {
      let target = id;
      if (!target || target === index.mainId) {
        const session = await client.openConversation(
          route.newSide ? "side" : "main",
          route.newSide ? text.slice(0, 60) : "Main chat",
        );
        target = session.id;
        setIndex(await client.conversationIndex());
        // Keep an unconfirmed message with its exact conversation, even across route changes.
        setDrafts((old) => ({ ...old, [draftKey]: "", [target!]: text }));
        navigate(route.newSide ? `/chat/${target}` : "/");
      }
      await client.send(target, { type: "user.message", text });
      setDrafts((old) => ({ ...old, [target!]: "" }));
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
    ? "New side chat"
    : id && id !== index.mainId
      ? (index.entries[id]?.title ?? task.session?.title ?? "Side chat")
      : "Chat";

  return (
    <div className="desktop-shell">
      <Rail
        page={route.page}
        onNavigate={goPage}
        onSearch={() => {
          setQuery("");
          setSearch(true);
        }}
        onSettings={() =>
          document
            ? setNotice(
                "Close the document before switching accounts. Your draft is preserved.",
              )
            : setSettings(true)
        }
        onStatus={() => setStatusOpen((value) => !value)}
      />
      {drawer && !document && (
        <aside className="chat-drawer" aria-label="Side chats">
          <header>
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Search side chats"
                placeholder="Search"
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
            <MessageCircle size={17} /> Main chat
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
                    ? "No matching chats"
                    : archived
                      ? "No archived chats"
                      : "Start a side chat"
                }
                icon={<MessagesSquare size={29} strokeWidth={1.4} />}
              >
                <p>
                  Side chats are an optional way to organize conversations by
                  topic.
                </p>
                <button
                  className="pill-button"
                  onClick={() => {
                    navigate("/new");
                    setDrawer(false);
                  }}
                >
                  New side chat
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
            <Plus size={17} /> New side chat
          </button>
        </aside>
      )}
      {document && (
        <Suspense
          fallback={
            <main className="workspace">
              <Empty title="Opening document…" />
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
      <main className="workspace" hidden={Boolean(document)}>
        {route.page === "chat" ? (
          <>
            <header className="chat-toolbar">
              <button
                className="glass-pill"
                aria-label="Open chats and side chats"
                aria-expanded={drawer}
                onClick={() => setDrawer((value) => !value)}
              >
                <Menu size={19} />
                {chatTitle}
              </button>
              <div className="toolbar-spacer" />
              <button
                className="glass-pill"
                aria-label="Conversation options"
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
                    New side chat
                  </button>
                  <button
                    onClick={() => {
                      setStatusOpen(true);
                      setMenu(false);
                    }}
                  >
                    Assistant status
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
                      {index.entries[id]?.archived ? "Unarchive" : "Archive"}{" "}
                      side chat
                    </button>
                  )}
                </div>
              )}
            </header>
            <div
              className="chat-scroll"
              ref={scroll}
              role="log"
              aria-label="Chat messages"
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
                    route.newSide ? "Start a side chat" : `Hello, I'm ${name}`
                  }
                >
                  <p>
                    {ready
                      ? "What's on your mind?"
                      : "Connect to Ark MA to start your conversation."}
                  </p>
                  {!ready && (
                    <button
                      className="pill-button"
                      onClick={() => setSettings(true)}
                    >
                      Connect to Ark MA
                    </button>
                  )}
                </Empty>
              )}
              {task.loading && !messages.length && (
                <p className="subtle loading-label">
                  Loading your conversation…
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
                        aria-label="Copy message"
                        onClick={() =>
                          void action(async () => {
                            await navigator.clipboard.writeText(
                              eventText(event),
                            );
                            setNotice("Message copied");
                          })
                        }
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        aria-label="Reply to message"
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
                          aria-label="Save reply to library"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await client.saveReply(
                                event.source_session_id ?? id!,
                                event.source_event_id ?? event.id,
                              );
                              setNotice("Saved to Library");
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
                    ? "Waiting for your approval"
                    : `${name} is working…`}
                </p>
              )}
            </div>
            {away && (
              <button
                className="jump-latest"
                aria-label="Jump to latest message"
                onClick={() => setAway(false)}
              >
                <ArrowDown size={18} />
              </button>
            )}
            {approvals.length > 0 && (
              <button
                className="approval-banner"
                onClick={() => {
                  setStatusOpen(true);
                  setStatusTab("approvals");
                }}
              >
                <ShieldCheck size={17} />
                {approvals.length} approval{approvals.length === 1 ? "" : "s"}{" "}
                needed
              </button>
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
                aria-label="Attach files"
                onClick={() =>
                  setNotice(
                    "File attachments are not connected in this desktop build yet.",
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
                aria-label={`Message ${name}`}
                placeholder="Message"
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
                aria-label="Dictate a message"
                onClick={() =>
                  setNotice(
                    "Use macOS Dictation from the Edit menu. Built-in voice input is not connected yet.",
                  )
                }
              >
                <Mic size={20} />
              </button>
              {running ? (
                <button
                  type="button"
                  className="send-button"
                  aria-label="Stop response"
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
                  aria-label="Send"
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
            <Empty title="Desktop view in progress">
              <p>
                This Mac-specific view has not been implemented yet. No sample
                or simulated content is shown.
              </p>
              <button className="pill-button" onClick={() => goPage("chat")}>
                Back to chat
              </button>
            </Empty>
          </section>
        )}
        {(error || task.error) && (
          <div className="error-banner" role="alert">
            <span>{error || task.error}</span>
            <button
              className="icon-button"
              aria-label="Refresh history"
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
              ? "Not connected"
              : running
                ? "Working"
                : task.connected
                  ? "Connected"
                  : id
                    ? "Reconnecting…"
                    : "Ready"
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
        <Modal title="Settings" wide onClose={() => setSettings(false)}>
          <AuthPanel
            client={client}
            onChanged={() => {
              void reload();
              setDrafts({});
            }}
          />
        </Modal>
      )}
      {search && (
        <Modal
          title="Search"
          onClose={() => {
            setSearch(false);
            setQuery("");
          }}
        >
          <label className="search-field">
            <Search size={20} />
            <input
              autoFocus
              placeholder="Search chats"
              aria-label="Search all chats"
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
              <p className="subtle">{loading ? "Loading…" : "No chats yet"}</p>
            )}
          </div>
        </Modal>
      )}
      {notice && (
        <div className="desktop-toast" role="status">
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
