import { t } from "../shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Heart,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Client } from "./api";
import type {
  InspirationItem,
  InspirationKind,
  InspirationSnapshot,
} from "../shared/inspiration";
import { useRefreshHandler } from "./PullToRefresh";
import { Markdown, dateLabel } from "./components";
import { PageHeader } from "./MusePages";
import { useTask } from "./useTask";
import { defaultFeedInstructions } from "../shared/inspiration";
import {
  emptyIdeaCatalogState,
  type IdeaCatalogState,
} from "../shared/idea-catalog";
import {
  catalogSections,
  IdeaRow,
  IdeaSheet,
  ideaStartMessage,
  shownGeneratedIdea,
  type ShownIdea,
} from "./IdeaCatalog";
import { backgroundClient, type BackgroundClient } from "./background-client";
import {
  isBackgroundPost,
  mergeBackgroundFeed,
  useBackgroundFeed,
} from "./background-feed";
import "./inspiration.css";

export function InspirationPost({
  item,
  onLike,
  onDiscuss,
  busy,
}: {
  item: InspirationItem;
  onLike: () => void;
  onDiscuss: () => void;
  busy: boolean;
}) {
  const [info, setInfo] = useState(false);
  // Prepared by the service on the account's schedule: no like on this
  // device, and Discuss always opens a new draft.
  const away = isBackgroundPost(item);
  return (
    <article className="inspiration-post" aria-label={item.title}>
      <span className="post-symbol" aria-hidden="true">
        {item.emoji || "✦"}
      </span>
      <div className="post-content">
        <h2 aria-label={t("Feed post: {title}", { title: item.title })}>
          {item.title}
        </h2>
        <Markdown text={item.body} />
        <PostImages item={item} />
        <Sources item={item} />
        <footer className="post-actions">
          {!away && (
            <button
              aria-label={item.liked ? t("Unlike post") : t("Like post")}
              aria-pressed={item.liked}
              disabled={busy}
              onClick={onLike}
            >
              <Heart size={20} fill={item.liked ? "currentColor" : "none"} />
            </button>
          )}
          <button className="post-discuss" onClick={onDiscuss}>
            <MessageCircle size={19} />
            {t("Discuss")}
          </button>
          <button
            aria-label={t("Post information")}
            aria-expanded={info}
            onClick={() => setInfo(!info)}
          >
            <time dateTime={item.created_at}>{dateLabel(item.created_at)}</time>
          </button>
        </footer>
        {info && (
          <aside className="post-information">
            <strong>{t("Why this post")}</strong>
            <p>{item.reason}</p>
            {away && (
              <p>{t("Prepared while you were away, on your schedule.")}</p>
            )}
            <a href={`#/task/${item.session_id}`}>
              {t("View generation conversation")} <ArrowUpRight size={14} />
            </a>
          </aside>
        )}
      </div>
    </article>
  );
}

// An idea generated for this person, in the same row as the catalog's.
export function InspirationIdea({
  item,
  onOpen,
}: {
  item: InspirationItem;
  onOpen: () => void;
}) {
  return <IdeaRow idea={shownGeneratedIdea(item)} onOpen={onOpen} />;
}

// A post's pictures in a row that scrolls sideways; one that fails to load
// is dropped rather than left as a blank card.
function PostImages({ item }: { item: InspirationItem }) {
  const [failed, setFailed] = useState<string[]>([]);
  const images = (item.images ?? []).filter(
    (image) => !failed.includes(image.url),
  );
  return images.length ? (
    <div className="post-images">
      {images.map((image) => (
        <img
          key={image.url}
          src={image.url}
          alt={image.alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed((current) => [...current, image.url])}
        />
      ))}
    </div>
  ) : null;
}

function Sources({ item }: { item: InspirationItem }) {
  return item.sources.length ? (
    <ul className="post-sources" aria-label={t("Sources")}>
      {item.sources.map((source) => (
        <li key={source.url}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.title}
            <ArrowUpRight size={13} />
          </a>
        </li>
      ))}
    </ul>
  ) : null;
}

export function InspirationPage({
  client,
  kind,
  onDiscuss,
  onStart,
  editInstructions,
  onEditorClose,
  background = backgroundClient,
}: {
  client: Client;
  kind: InspirationKind;
  onDiscuss: (item: InspirationItem) => void;
  // Sends a catalog idea to the main chat as a message from the person.
  onStart?: (text: string) => void;
  editInstructions?: boolean;
  onEditorClose?: () => void;
  // The Open Muse service, whose scheduled posts join the Feed.
  background?: BackgroundClient;
}) {
  const [data, setData] = useState<InspirationSnapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [idea, setIdea] = useState<ShownIdea>();
  const [catalogState, setCatalogState] = useState<IdeaCatalogState>(
    emptyIdeaCatalogState,
  );
  // Ideas folding away after "Not interested", before they are hidden.
  const [leaving, setLeaving] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const lock = useRef(false);
  const refreshing = useRef(false);
  const run = data?.runs[kind];
  const pending = run && !["complete", "failed"].includes(run.phase);
  const resumable = run && ["ready", "preparing"].includes(run.phase);
  // Reuse the same exact-name web-read auto-approval policy as ordinary chat.
  const generation = useTask(client, pending ? run?.session_id : undefined);
  const latestTool = [...generation.events]
    .reverse()
    .find((event) => event.type === "agent.tool_use")?.name;
  const latestActivity = latestTool?.startsWith("memory_")
    ? t("Reading personal memory")
    : latestTool === "web_search"
      ? t("Searching the web")
      : latestTool === "web_fetch"
        ? t("Reading a web page")
        : undefined;
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const result = client.signedIn()
        ? await client.refreshInspiration(kind)
        : await client.inspiration();
      if (alive.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      refreshing.current = false;
      if (alive.current) setLoading(false);
    }
  }, [client, kind]);
  const away = useBackgroundFeed(kind === "feed" ? background : null);
  useRefreshHandler(
    useCallback(
      () => Promise.all([refresh(), away.reload()]).then(() => {}),
      [refresh, away.reload],
    ),
  );
  useEffect(() => {
    alive.current = true;
    // Show what this device already has while the cloud is read.
    void client
      .cachedInspiration()
      .then((cached) => {
        if (alive.current) setData((current) => current ?? cached);
      })
      .catch(() => {});
    void refresh();
    const foreground = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [refresh]);
  useEffect(() => {
    if (kind !== "ideas") return;
    let active = true;
    void client
      .ideaCatalogState()
      .then((state) => {
        if (active) setCatalogState(state);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client, kind]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [pending, refresh]);
  async function action(fn: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      // Read state after both success and uncertain writes; never repeat POST.
      try {
        const result = await client.inspiration();
        if (alive.current) setData(result);
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      }
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  const found = mergeBackgroundFeed(data?.items ?? [], away.posts).filter(
    (item) => item.kind === kind,
  );
  const ideas = kind === "ideas";
  const items = ideas
    ? found.filter((item) => !catalogState.hidden.includes(item.id))
    : found;
  const sections = ideas ? catalogSections(catalogState.hidden) : [];
  function remember(id: string, reaction: "liked" | "hidden") {
    void client
      .reactToCatalogIdea(id, reaction)
      .then((state) => alive.current && setCatalogState(state))
      .catch((e) => alive.current && setError((e as Error).message));
  }
  function startIdea(shown: ShownIdea) {
    if (shown.generated) onDiscuss(shown.generated);
    else onStart?.(ideaStartMessage(shown));
  }
  function likeIdea(shown: ShownIdea) {
    if (shown.generated)
      void action(() => client.likeInspiration(shown.id, true));
    else remember(shown.id, "liked");
    setNotice(t("Got it. You’ll see more ideas like this."));
  }
  function hideIdea(shown: ShownIdea) {
    setLeaving((current) => [...current, shown.id]);
    setNotice(t("Hidden. You won’t see this idea here again."));
  }
  // Once its row has folded away, the idea stays hidden on this device.
  function gone(id: string) {
    setLeaving((current) => current.filter((value) => value !== id));
    setCatalogState((current) => ({
      ...current,
      hidden: [...current.hidden, id],
    }));
    remember(id, "hidden");
  }
  const row = (shown: ShownIdea) => (
    <IdeaRow
      key={shown.id}
      idea={shown}
      leaving={leaving.includes(shown.id)}
      onGone={() => gone(shown.id)}
      onOpen={() => setIdea(shown)}
    />
  );
  // The default instructions are shown in the person's language.
  const instructions =
    data?.instructions.content === defaultFeedInstructions
      ? t(defaultFeedInstructions)
      : (data?.instructions.content ?? "");
  const title = kind === "feed" ? t("Feed") : t("Ideas");
  return (
    <section className={`muse-page inspiration-page ${kind}`}>
      <PageHeader title={title} />
      {ideas && (
        <div className="idea-catalog">
          {sections.map((section, index) => (
            <section
              key={section.title ?? index}
              aria-label={section.title || undefined}
            >
              {section.title && (
                <h2 className="idea-section-title">{section.title}</h2>
              )}
              {section.ideas.map(row)}
            </section>
          ))}
          {items.length > 0 && (
            <section aria-label={t("Made for you")}>
              <h2 className="idea-section-title">{t("Made for you")}</h2>
              {items.map((item) => row(shownGeneratedIdea(item)))}
            </section>
          )}
        </div>
      )}
      {!ideas && error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {loading && !ideas && !data && (
        <p className="inspiration-status" role="status">
          <LoaderCircle size={19} className="spin" />
          {t("Loading…")}
        </p>
      )}
      {kind === "feed" && data && !data.instructionsDismissed && (
        <aside className="feed-instructions-card">
          <h2>{t("Prompt instructions")}</h2>
          <p>
            {t(
              "Your feed is shaped by these instructions. Changes apply to future posts.",
            )}
          </p>
          <div>{instructions}</div>
          <footer>
            <button
              disabled={!client.signedIn()}
              onClick={() => setEditing(true)}
            >
              {t("Edit")}
            </button>
            <button
              disabled={!client.signedIn() || busy}
              onClick={() =>
                void action(() => client.dismissFeedInstructions())
              }
            >
              {t("Got it")}
            </button>
          </footer>
        </aside>
      )}
      {kind === "feed" && data?.instructionsDismissed && (
        <button
          type="button"
          className="feed-instructions-pill"
          aria-label={t("Edit feed instructions")}
          disabled={!client.signedIn()}
          onClick={() => setEditing(true)}
        >
          {instructions}
        </button>
      )}
      {ideas ? (
        error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )
      ) : items.length ? (
        <div className="personal-feed">
          {items.map((item) => (
            <InspirationPost
              key={item.id}
              item={item}
              busy={busy}
              onLike={() =>
                void action(() => client.likeInspiration(item.id, !item.liked))
              }
              onDiscuss={() => onDiscuss(item)}
            />
          ))}
        </div>
      ) : (
        !loading && (
          <div className="inspiration-empty">
            <Lightbulb size={28} strokeWidth={1.5} />
            <h2>{t("A feed that gets to know you")}</h2>
            <p>
              {t(
                "Discover useful things shaped by your conversations, interests, and goals.",
              )}
            </p>
            {!client.signedIn() && (
              <a href="#/settings">{t("Connect to MA to get started")}</a>
            )}
          </div>
        )
      )}
      {run?.error && (
        <p className="inline-error" role="alert">
          {run.error}
        </p>
      )}
      {pending && (
        <div className="inspiration-status" role="status">
          <LoaderCircle size={17} className="spin" />
          <span>
            {run.phase === "creating" || run.phase === "sending"
              ? t("Checking submission…")
              : resumable
                ? t("Ready to continue generation")
                : kind === "feed"
                  ? t("Finding something worth sharing…")
                  : t("Finding ideas for you…")}
          </span>
        </div>
      )}
      {pending && latestActivity && (
        <p className="inspiration-latest">
          {t("Latest activity:")} {latestActivity}
        </p>
      )}
      <div className="inspiration-bottom">
        <button
          className="generate-inspiration"
          disabled={
            !client.signedIn() ||
            loading ||
            busy ||
            Boolean(pending && !resumable)
          }
          onClick={() => void action(() => client.generateInspiration(kind))}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <RefreshCw size={17} />
          )}
          {resumable
            ? t("Continue generation")
            : kind === "feed"
              ? t("Find new posts")
              : t("Find new ideas")}
        </button>
        {run?.session_id && (
          <a href={`#/task/${run.session_id}`}>
            {t("View generation conversation")}
          </a>
        )}
      </div>
      {kind === "feed" && data && (editing || editInstructions) && (
        <FeedInstructionsEditor
          client={client}
          initial={data.instructions}
          onSaved={(instructions) =>
            setData((current) => current && { ...current, instructions })
          }
          onClose={() => {
            setEditing(false);
            onEditorClose?.();
          }}
        />
      )}
      {idea && (
        <IdeaSheet
          key={idea.id}
          idea={idea}
          onClose={() => setIdea(undefined)}
          onStart={() => startIdea(idea)}
          onLike={() => likeIdea(idea)}
          onHide={() => hideIdea(idea)}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </section>
  );
}

function FeedInstructionsEditor({
  client,
  initial,
  onSaved,
  onClose,
}: {
  client: Client;
  initial: InspirationSnapshot["instructions"];
  onSaved: (value: InspirationSnapshot["instructions"]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const guard = useRef(false);
  const [draft, setDraft] = useState(initial.content);
  const [revision, setRevision] = useState(initial.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  async function save() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      onSaved(await client.saveFeedInstructions(draft, revision));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      const { instructions } = await client.inspiration();
      setDraft(instructions.content);
      setRevision(instructions.revision);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="feed-instructions-editor"
      aria-label={t("Feed instructions")}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <button
          className="glass-button"
          aria-label={t("Close feed instructions")}
          disabled={busy}
          onClick={onClose}
        >
          <X size={21} />
        </button>
        <strong>{t("Feed instructions")}</strong>
        <button
          className="instructions-save"
          disabled={busy || !client.signedIn() || !draft.trim()}
          onClick={() => void save()}
        >
          {busy ? t("Saving…") : t("Save")}
        </button>
      </header>
      <p>
        <SlidersHorizontal size={18} />
        {t("What would you like to see in your feed?")}
      </p>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button disabled={busy} onClick={() => void reload()}>
            {t("Discard draft and reload saved version")}
          </button>
        </div>
      )}
      <textarea
        aria-label={t("Feed instructions text")}
        value={draft}
        maxLength={4000}
        disabled={busy || !client.signedIn()}
        onChange={(e) => setDraft(e.target.value)}
      />
      <footer>
        {client.signedIn()
          ? t(
              "Save instructions to your personal MA memory. Changes shape future posts, not existing ones.",
            )
          : t("Connect to MA in Settings to save your own feed instructions.")}
      </footer>
    </dialog>
  );
}
