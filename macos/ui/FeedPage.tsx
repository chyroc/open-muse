import { t } from "../../shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouteHeader } from "./routeHeader";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Heart,
  Info,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { Client } from "../../src/api";
import type {
  InspirationItem,
  InspirationSnapshot,
} from "../../shared/inspiration";
import { Markdown } from "../../src/components";
import { useTask } from "../../src/useTask";
import { Empty, Modal, SplitChatIcon } from "./Chrome";
import { FeedInstructions, shownInstructions } from "./FeedInstructions";
import {
  emptyFeedPresentation,
  feedEditions,
  feedPresentationStore,
  moveFeedItem,
  type FeedMove,
} from "./feed";

export function FeedPost({
  item,
  first,
  last,
  busy,
  onLove,
  onDiscuss,
  onMove,
  onDelete,
}: {
  item: InspirationItem;
  first: boolean;
  last: boolean;
  busy: boolean;
  onLove: () => void;
  onDiscuss: () => void;
  onMove: (direction: FeedMove) => void;
  onDelete: () => void;
}) {
  const [why, setWhy] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const choose = (fn: () => void) => {
    if (menu.current) menu.current.open = false;
    fn();
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && menu.current)
        menu.current.open = false;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <article className="feed-post" aria-label={item.title}>
      <span className="feed-post-icon" aria-hidden="true">
        {item.emoji || "✦"}
      </span>
      <div className="feed-post-content">
        <header>
          <h3>{item.title}</h3>
          <details className="feed-post-options" ref={menu}>
            <summary
              aria-label={t("Options for {title}", { title: item.title })}
            >
              <MoreHorizontal size={18} />
            </summary>
            <div className="feed-post-menu">
              {!first && (
                <button
                  disabled={busy}
                  onClick={() => choose(() => onMove("up"))}
                >
                  <ArrowUp size={16} />
                  {t("Move up")}
                </button>
              )}
              {!last && (
                <button
                  disabled={busy}
                  onClick={() => choose(() => onMove("down"))}
                >
                  <ArrowDown size={16} />
                  {t("Move down")}
                </button>
              )}
              {!first && (
                <button
                  disabled={busy}
                  onClick={() => choose(() => onMove("top"))}
                >
                  <ArrowUpToLine size={16} />
                  {t("Move to top")}
                </button>
              )}
              <button onClick={() => choose(() => setWhy(true))}>
                <Info size={16} />
                {t("Why I created this")}
              </button>
              <button disabled={busy} onClick={() => choose(onDelete)}>
                <Trash2 size={16} />
                {t("Delete")}
              </button>
            </div>
          </details>
        </header>
        <Markdown text={item.body} />
        {item.sources.length > 0 && (
          <ul className="feed-sources" aria-label={t("Sources")}>
            {item.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        )}
        <footer>
          <button
            className={`feed-love ${item.liked ? "loved" : ""}`}
            disabled={busy}
            aria-label={item.liked ? t("Remove love") : t("Love")}
            aria-pressed={item.liked}
            onClick={onLove}
          >
            <Heart
              size={23}
              fill={item.liked ? "currentColor" : "none"}
              strokeWidth={1.6}
            />
          </button>
          <button disabled={busy} onClick={onDiscuss}>
            <MessageCircle size={23} strokeWidth={1.6} />
            {t("Discuss")}
          </button>
        </footer>
      </div>
      {why && (
        <Modal
          title={t("Why I created this post")}
          onClose={() => setWhy(false)}
        >
          <p className="feed-reason">{item.reason}</p>
        </Modal>
      )}
    </article>
  );
}

export function FeedPage({
  client,
  onDiscuss,
  onOpenChat,
  onConnect,
  onEditorChange,
  split,
  onToggleChat,
}: {
  client: Client;
  onDiscuss: (item: InspirationItem) => void;
  onOpenChat: (id: string) => void;
  onConnect: () => void;
  onEditorChange: (open: boolean) => void;
  split: boolean;
  onToggleChat: () => void;
}) {
  const routeScroller = useRouteHeader<HTMLElement>();
  const [data, setData] = useState<InspirationSnapshot>();
  const [presentation, setPresentation] = useState(emptyFeedPresentation);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<InspirationItem>();
  const [removed, setRemoved] = useState<InspirationItem>();
  const alive = useRef(true);
  const lock = useRef(false);
  const reading = useRef(false);
  const request = useRef(0);
  const store = useMemo(() => feedPresentationStore(client), [client]);
  const run = data?.runs.feed;
  const pending = Boolean(run && !["complete", "failed"].includes(run.phase));
  const resumable = run && ["preparing", "ready"].includes(run.phase);
  const generation = useTask(client, pending ? run?.session_id : undefined);
  const refresh = useCallback(async () => {
    if (lock.current || reading.current) return;
    reading.current = true;
    const sequence = ++request.current;
    try {
      const [snapshot, state] = await Promise.all([
        client.signedIn()
          ? client.refreshInspiration("feed")
          : client.inspiration(),
        store.read(),
      ]);
      if (alive.current && sequence === request.current) {
        setData(snapshot);
        setPresentation(state);
        setError("");
      }
    } catch (error) {
      if (alive.current && sequence === request.current)
        setError((error as Error).message);
    } finally {
      reading.current = false;
      if (alive.current) setLoading(false);
    }
  }, [client, store]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const foreground = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      alive.current = false;
      request.current++;
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [refresh]);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [pending, refresh]);
  useEffect(() => {
    onEditorChange(editing);
    return () => onEditorChange(false);
  }, [editing, onEditorChange]);
  async function action(fn: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    request.current++;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      // Reconcile ambiguous writes with reads. Never automatically repeat them.
      try {
        const [snapshot, state] = await Promise.all([
          client.inspiration(),
          store.read(),
        ]);
        if (alive.current) {
          setData(snapshot);
          setPresentation(state);
        }
      } catch (error) {
        if (alive.current) setError((error as Error).message);
      }
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const editions = feedEditions(data?.items ?? [], presentation);
  const hasPosts = Boolean(editions.length);
  return (
    <section
      className="desktop-feed route-scroller"
      aria-label={t("Feed")}
      ref={routeScroller}
    >
      <button
        className="feed-split-toggle icon-button"
        aria-label={
          split ? t("Close side-by-side chat") : t("Open side-by-side chat")
        }
        aria-pressed={split}
        onClick={onToggleChat}
      >
        <SplitChatIcon open={split} />
      </button>
      <div className="feed-column">
        <header className="feed-heading route-heading">
          <h1>{t("Feed")}</h1>
          <button
            className="feed-settings"
            aria-label={t("Edit feed instructions")}
            disabled={!data}
            onClick={() => setEditing(true)}
          >
            <SlidersHorizontal size={22} />
          </button>
        </header>
        {error && (
          <div className="feed-error" role="alert">
            {error}
            <button disabled={busy} onClick={() => void refresh()}>
              {t("Refresh")}
            </button>
          </div>
        )}
        {loading && (
          <p className="feed-status" role="status">
            {t("Loading your feed…")}
          </p>
        )}
        {!loading && data && !hasPosts && (
          <>
            <Empty title={t("Your personal feed")}>
              <p>
                {t(
                  "Useful discoveries and thoughtful updates, shaped by your conversations, interests, and goals.",
                )}
              </p>
            </Empty>
            <aside className="feed-prompt-card">
              <h2>{t("Your feed prompt")}</h2>
              <p>{shownInstructions(data.instructions.content)}</p>
              <footer>
                <button
                  className="pill-button"
                  onClick={() => setEditing(true)}
                >
                  {t("Edit")}
                </button>
              </footer>
            </aside>
          </>
        )}
        <div aria-label={t("Feed editions")}>
          {editions.map((edition) => (
            <section
              className="feed-edition"
              key={edition.key}
              aria-label={edition.label}
            >
              <h2>{edition.label}</h2>
              {edition.items.map((item, index) => (
                <FeedPost
                  key={item.id}
                  item={item}
                  first={index === 0}
                  last={index === edition.items.length - 1}
                  busy={busy}
                  onLove={() =>
                    void action(() =>
                      client.likeInspiration(item.id, !item.liked),
                    )
                  }
                  onDiscuss={() => onDiscuss(item)}
                  onMove={(direction) =>
                    void action(() =>
                      store.update((state) =>
                        moveFeedItem(state, data!.items, item.id, direction),
                      ),
                    )
                  }
                  onDelete={() => setDeleting(item)}
                />
              ))}
            </section>
          ))}
        </div>
        {removed && (
          <div className="feed-undo" role="status">
            {t("Post removed from this Mac.")}
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await store.update((state) => ({
                    ...state,
                    hidden: state.hidden.filter((id) => id !== removed.id),
                  }));
                  setRemoved(undefined);
                })
              }
            >
              {t("Undo")}
            </button>
          </div>
        )}
        {run?.error && (
          <p className="feed-error" role="alert">
            {run.error}
          </p>
        )}
        {generation.error && (
          <p className="feed-error" role="alert">
            {generation.error}
          </p>
        )}
        {pending && (
          <p className="feed-status" role="status">
            {run?.phase === "creating" || run?.phase === "sending"
              ? t("Checking submission…")
              : resumable
                ? t("Ready to continue generation")
                : t("Finding something worth sharing…")}
          </p>
        )}
        {run?.session_id && (pending || run.error) && (
          <button
            className="feed-text-button"
            onClick={() => onOpenChat(run.session_id!)}
          >
            {t("View generation conversation")}
          </button>
        )}
        {!loading && (
          <footer className="feed-generation">
            <button
              className="pill-button"
              disabled={busy || !data || (pending && !resumable)}
              onClick={() =>
                client.signedIn()
                  ? void action(() => client.generateInspiration("feed"))
                  : onConnect()
              }
            >
              {busy
                ? t("Working…")
                : !client.signedIn()
                  ? t("Connect to MA")
                  : resumable
                    ? t("Continue generation")
                    : t("Generate")}
            </button>
            <button
              className="icon-button"
              aria-label={t("Refresh feed")}
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <p>
              {t(
                "Generated with MA when you ask. Automatic background editions are not connected yet.",
              )}
            </p>
          </footer>
        )}
      </div>
      {editing && data && (
        <FeedInstructions
          client={client}
          initial={data.instructions}
          onSaved={(instructions) =>
            setData((old) => (old ? { ...old, instructions } : old))
          }
          onClose={() => setEditing(false)}
        />
      )}
      {deleting && (
        <Modal
          title={t("Delete this post?")}
          onClose={() => {
            if (!busy) setDeleting(undefined);
          }}
        >
          <p>
            {t(
              "Remove “{title}” from this Mac’s feed? The original MA conversation stays unchanged. You can undo this removal.",
              { title: deleting.title },
            )}
          </p>
          <div className="feed-dialog-actions">
            <button
              className="pill-button"
              disabled={busy}
              onClick={() => setDeleting(undefined)}
            >
              {t("Cancel")}
            </button>
            <button
              className="pill-button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const item = deleting;
                  await store.update((state) => ({
                    ...state,
                    hidden: [...new Set([...state.hidden, item.id])],
                  }));
                  setRemoved(item);
                  setDeleting(undefined);
                })
              }
            >
              {t("Delete post")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
