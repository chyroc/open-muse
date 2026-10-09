import { t } from "../../shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouteHeader } from "./routeHeader";
import type { Client } from "../../src/api";
import {
  defaultFeedInstructions,
  type InspirationItem,
  type InspirationSnapshot,
} from "../../shared/inspiration";
import { Markdown } from "../../src/components";
import { useTask } from "../../src/useTask";
import {
  backgroundClient,
  type BackgroundClient,
} from "../../src/background-client";
import {
  isBackgroundPost,
  mergeBackgroundFeed,
  useBackgroundFeed,
} from "../../src/background-feed";
import { FeedIcon, Modal, SplitChatIcon } from "./Chrome";
import { FeedInstructions, shownInstructions } from "./FeedInstructions";
import { FeedMedia } from "./FeedMedia";
import {
  emptyFeedPresentation,
  feedPosts,
  feedPresentationStore,
  postAge,
  postMoment,
} from "./feed";
import {
  ReviseIcon,
  InfoIcon,
  EllipsisIcon,
  HeartFilledIcon,
  HeartIcon,
  PencilIcon,
  SlidersIcon,
  BubbleIcon,
  TrashIcon,
} from "./icons";

// Drawn when a post has no emoji of its own.
function FeedPostGlyph() {
  return <FeedIcon size="1em" strokeWidth={1.75} aria-hidden="true" />;
}

function Spinner() {
  return <span className="feed-spinner" aria-hidden="true" />;
}

// A post's options: when it was written, why it was made, and removal.
function FeedPostMenu({
  item,
  busy,
  onWhy,
  onDelete,
}: {
  item: InspirationItem;
  busy: boolean;
  onWhy: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    anchor.current
      ?.querySelector<HTMLButtonElement>("[role=menuitem]")
      ?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const at = Date.parse(item.created_at);
  const choose = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <div className="feed-post-options" ref={anchor}>
      <button
        ref={trigger}
        type="button"
        className="feed-icon-button"
        aria-label={t("Post options")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <EllipsisIcon />
      </button>
      {open && (
        <div className="feed-menu" role="menu" aria-label={t("Post options")}>
          {Number.isFinite(at) && (
            <div className="feed-menu-time">
              <time dateTime={new Date(at).toISOString()}>
                {postMoment(at)}
              </time>
            </div>
          )}
          <button role="menuitem" onClick={() => choose(onWhy)}>
            <span className="feed-menu-icon">
              <InfoIcon />
            </span>
            <span>{t("Why I created this")}</span>
          </button>
          <hr />
          <button
            role="menuitem"
            className="destructive"
            disabled={busy}
            onClick={() => choose(onDelete)}
          >
            <span className="feed-menu-icon">
              <TrashIcon />
            </span>
            <span>{t("Delete")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function FeedPost({
  item,
  busy,
  onLove,
  onDiscuss,
  onDelete,
}: {
  item: InspirationItem;
  busy: boolean;
  onLove: () => void;
  onDiscuss: () => void;
  onDelete: () => void;
}) {
  const [why, setWhy] = useState(false);
  const at = Date.parse(item.created_at);
  return (
    <article className="feed-post" aria-label={item.title}>
      <div className="feed-post-row">
        <span className="feed-post-icon" aria-hidden="true">
          {item.emoji ? <span>{item.emoji}</span> : <FeedPostGlyph />}
        </span>
        <div className="feed-post-content">
          <div className="feed-post-text">
            <div className="feed-post-title">
              <h2>{item.title}</h2>
              <div className="feed-post-meta">
                {Number.isFinite(at) && (
                  <time
                    dateTime={new Date(at).toISOString()}
                    title={postMoment(at)}
                  >
                    {postAge(at)}
                  </time>
                )}
                <FeedPostMenu
                  item={item}
                  busy={busy}
                  onWhy={() => setWhy(true)}
                  onDelete={onDelete}
                />
              </div>
            </div>
            <Markdown text={item.body} />
            {item.sources.length > 0 && (
              <ul className="feed-post-sources" aria-label={t("Sources")}>
                {item.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <FeedMedia item={item} />
          <div className="feed-post-spacer" aria-hidden="true" />
          <footer>
            {/* Posts the service prepared on a schedule have no love here. */}
            {!isBackgroundPost(item) && (
              <button
                type="button"
                className={`feed-action feed-love ${item.liked ? "loved" : ""}`}
                disabled={busy}
                aria-label={item.liked ? t("Remove love") : t("Love")}
                aria-pressed={item.liked}
                onClick={onLove}
              >
                {item.liked ? <HeartFilledIcon /> : <HeartIcon />}
              </button>
            )}
            <button
              type="button"
              className="feed-action labeled"
              disabled={busy}
              onClick={onDiscuss}
            >
              <BubbleIcon />
              {t("Discuss")}
            </button>
          </footer>
        </div>
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

function FeedPostSkeleton() {
  return (
    <div className="feed-post feed-skeleton" aria-hidden="true">
      <div className="feed-post-row">
        <span className="feed-post-icon feed-bone" />
        <div className="feed-post-content">
          <div className="feed-post-text">
            <div className="feed-post-title">
              <span className="feed-bone line" style={{ width: "66%" }} />
              <span className="feed-bone dot" />
            </div>
            <span className="feed-bone line" />
            <span className="feed-bone line" style={{ width: "92%" }} />
          </div>
          <div className="feed-media">
            <span className="feed-bone picture" />
          </div>
          <div className="feed-post-spacer" />
          <footer>
            <span className="feed-bone dot start" />
            <span className="feed-bone pill" />
          </footer>
        </div>
      </div>
    </div>
  );
}

function GenerateLabel({
  signedIn,
  resumable,
  generating,
  idle,
}: {
  signedIn: boolean;
  resumable: boolean;
  generating: boolean;
  idle: string;
}) {
  if (!signedIn) return <>{t("Connect to MA")}</>;
  if (resumable) return <>{t("Continue generation")}</>;
  if (generating)
    return (
      <span className="feed-button-busy">
        <Spinner />
        {t("Generating…")}
      </span>
    );
  return <>{idle}</>;
}

export function FeedPage({
  client,
  onDiscuss,
  onConnect,
  onEditorChange,
  split,
  onToggleChat,
  background = backgroundClient,
}: {
  // The Open Muse service, whose scheduled posts join the feed.
  background?: BackgroundClient;
  client: Client;
  onDiscuss: (item: InspirationItem) => void;
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
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [removed, setRemoved] = useState<InspirationItem>();
  const alive = useRef(true);
  const lock = useRef(false);
  const reading = useRef(false);
  const request = useRef(0);
  const store = useMemo(() => feedPresentationStore(client), [client]);
  const run = data?.runs.feed;
  const pending = Boolean(run && !["complete", "failed"].includes(run.phase));
  const resumable = Boolean(run && ["preparing", "ready"].includes(run.phase));
  const generation = useTask(client, pending ? run?.session_id : undefined);
  const away = useBackgroundFeed(background);
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
      if (alive.current) {
        setBusy(false);
        setStarting(false);
      }
    }
  }
  const signedIn = client.signedIn();
  const generating = starting || (pending && !resumable);
  const generate = () => {
    if (!signedIn) return onConnect();
    if (generating || busy) return;
    setStarting(true);
    void action(() => client.generateInspiration("feed"));
  };
  const remove = (item: InspirationItem) =>
    void action(async () => {
      await store.update((state) => ({
        ...state,
        hidden: [...new Set([...state.hidden, item.id])],
      }));
      setRemoved(item);
    });
  const items = mergeBackgroundFeed(data?.items ?? [], away.posts);
  const posts = feedPosts(items, presentation);
  const hasPosts = posts.length > 0;
  // The built-in prompt sits on the page as a card until someone edits it;
  // after that it is changed from the header.
  const untouched = Boolean(
    data && data.instructions.content.trim() === defaultFeedInstructions,
  );
  const custom = Boolean(data && !untouched);
  // A failed run's error is stored in English and shown in the app's language.
  const problems = [error, run?.error && t(run.error), generation.error].filter(
    (value): value is string => Boolean(value),
  );
  const generateButton = (idle: string, variant: "primary" | "flat") => (
    <button
      type="button"
      className={`feed-button ${variant}`}
      aria-busy={generating}
      aria-disabled={generating || busy || !data}
      onClick={generate}
    >
      <GenerateLabel
        signedIn={signedIn}
        resumable={resumable}
        generating={generating}
        idle={idle}
      />
    </button>
  );
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
          {custom && (
            <button
              type="button"
              className="feed-icon-button flat"
              aria-label={t("Edit feed instructions")}
              onClick={() => setEditing(true)}
            >
              <SlidersIcon />
            </button>
          )}
        </header>
        {untouched && data && (
          <div className="feed-prompt-slot">
            <section
              className="feed-prompt-card"
              aria-labelledby="feed-prompt-heading"
            >
              <h2 id="feed-prompt-heading">{t("Your feed prompt")}</h2>
              <p title={shownInstructions(data.instructions.content)}>
                {shownInstructions(data.instructions.content)}
              </p>
              <div className="feed-prompt-actions">
                <button
                  type="button"
                  className="feed-button flat with-icon"
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon />
                  {t("Edit")}
                </button>
                {generateButton(t("Generate"), "primary")}
              </div>
            </section>
          </div>
        )}
        <div className="feed-list">
          {loading ? (
            <div
              className="feed-loading"
              role="status"
              aria-busy="true"
              aria-label={t("Loading feed")}
            >
              <FeedPostSkeleton />
              <FeedPostSkeleton />
              <FeedPostSkeleton />
            </div>
          ) : !data ? (
            <div className="feed-alert" role="alert">
              <p className="feed-alert-title">{t("The feed didn't load.")}</p>
              {error && <p className="feed-alert-detail">{error}</p>}
              <button
                type="button"
                className="feed-button flat"
                onClick={() => void refresh()}
              >
                {t("Try again")}
              </button>
            </div>
          ) : (
            <>
              {problems.map((problem, index) => (
                <div className="feed-alert" role="alert" key={index}>
                  <p className="feed-alert-detail">{problem}</p>
                </div>
              ))}
              {!hasPosts && (
                <div className="feed-empty">
                  <div className="feed-empty-content">
                    <ReviseIcon className="feed-empty-icon" />
                    <h2>{t("Getting your feed ready")}</h2>
                    <p>
                      {t(
                        "Posts chosen for you will show up here as your companion learns what you care about.",
                      )}
                    </p>
                    {custom && generateButton(t("Generate now"), "primary")}
                  </div>
                </div>
              )}
              <div
                className="feed-posts"
                role="log"
                aria-live="polite"
                aria-label={t("Feed editions")}
              >
                {posts.map((item) => (
                  <FeedPost
                    key={item.id}
                    item={item}
                    busy={busy}
                    onLove={() =>
                      void action(() =>
                        client.likeInspiration(item.id, !item.liked),
                      )
                    }
                    onDiscuss={() => onDiscuss(item)}
                    onDelete={() => remove(item)}
                  />
                ))}
              </div>
              {custom && hasPosts && (
                <div className="feed-more">
                  {generateButton(t("Generate now"), "flat")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {removed && (
        <div className="feed-undo" role="status">
          <span>{t("Post removed from this Mac.")}</span>
          <button
            type="button"
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
    </section>
  );
}
