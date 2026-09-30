import { t } from "../../shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  Lightbulb,
  MessageCircle,
  MoreHorizontal,
  PanelRight,
  RefreshCw,
  Search,
  Shapes,
  ThumbsDown,
  ThumbsUp,
  WandSparkles,
} from "lucide-react";
import type { Client } from "../../src/api";
import type { InspirationItem } from "../../shared/inspiration";
import { Markdown } from "../../src/components";
import { useTask } from "../../src/useTask";
import { Modal } from "./Chrome";
import { navLabel } from "./labels";
import {
  MacIdeas,
  ideaDetail,
  ideaSections,
  type IdeaActivation,
  type IdeaDetail,
  type MacIdeasSnapshot,
} from "./ideas";

function IdeaRow({
  item,
  activation,
  busy,
  onOpen,
  onFeedback,
}: {
  item: InspirationItem;
  activation?: IdeaActivation;
  busy: boolean;
  onOpen: () => void;
  onFeedback: (direction: "up" | "down") => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const choose = (fn: () => void) => {
    if (menu.current) menu.current.open = false;
    fn();
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <div role="listitem" className="idea-row">
      <span className="idea-icon" aria-hidden="true">
        {item.emoji || <Lightbulb size={28} strokeWidth={1.5} />}
      </span>
      <button
        className="idea-open"
        onClick={onOpen}
        aria-label={t("View idea: {title}", { title: item.title })}
      >
        <h3>{item.title}</h3>
        <p>{item.body}</p>
      </button>
      {activation?.phase === "confirmed" && (
        <span
          className="idea-started"
          role="img"
          aria-label={t("Started in chat")}
        >
          <Check size={18} />
        </span>
      )}
      <details className="idea-options" ref={menu}>
        <summary
          aria-label={t("Idea feedback: {title}", { title: item.title })}
        >
          <MoreHorizontal size={19} />
        </summary>
        <div className="idea-menu">
          <button onClick={() => choose(onOpen)}>
            <WandSparkles size={16} />
            {t("Let's do it")}
          </button>
          <hr />
          <button
            disabled={busy}
            onClick={() => choose(() => onFeedback("up"))}
          >
            <ThumbsUp size={16} />
            {t("More like this")}
          </button>
          <button
            disabled={busy}
            onClick={() => choose(() => onFeedback("down"))}
          >
            <ThumbsDown size={16} />
            {t("Not interested")}
          </button>
        </div>
      </details>
    </div>
  );
}

export function IdeaPreview({
  item,
  detail,
  activation,
  busy,
  onClose,
  onActivate,
}: {
  item: InspirationItem;
  detail?: IdeaDetail;
  activation?: IdeaActivation;
  busy: boolean;
  onClose: () => void;
  onActivate: (selected: string[]) => void;
}) {
  const [selected, setSelected] = useState(
    () => activation?.selected ?? detail?.included.map((item) => item.id) ?? [],
  );
  const emptySelection = Boolean(
    detail?.included.length &&
    detail.included.every((item) => item.selectable) &&
    !selected.length,
  );
  const pending = activation?.phase === "sending";
  const started = activation?.phase === "confirmed";
  const icons = {
    conversation: MessageCircle,
    research: Search,
    document: FileText,
    app: Shapes,
    scheduled: FileText,
  };
  return (
    <Modal className="idea-preview" title={item.title} onClose={onClose}>
      <div className="idea-preview-scroll">
        <Markdown text={item.body} />
        {item.reason && <p className="idea-fit-reason">{item.reason}</p>}
        {detail?.included.length ? (
          <section className="idea-included" aria-label={t("What's included")}>
            <h4>{t("What's included")}</h4>
            {detail.included.map((activity) => {
              const Icon = icons[activity.kind];
              const canSelect =
                activity.selectable &&
                !started &&
                !pending &&
                activation?.phase !== "preparing";
              const content = (
                <>
                  <span className="idea-activity-icon">
                    <Icon size={21} strokeWidth={1.5} />
                  </span>
                  <span>
                    <strong>{activity.title}</strong>
                    <span>{activity.description}</span>
                  </span>
                  {activity.selectable && (
                    <span
                      className={`idea-selection ${selected.includes(activity.id) ? "selected" : ""}`}
                    >
                      {selected.includes(activity.id) && <Check size={15} />}
                    </span>
                  )}
                </>
              );
              return canSelect ? (
                <button
                  key={activity.id}
                  className="idea-included-row"
                  aria-pressed={selected.includes(activity.id)}
                  disabled={busy}
                  onClick={() =>
                    setSelected((old) =>
                      old.includes(activity.id)
                        ? old.filter((id) => id !== activity.id)
                        : [...old, activity.id],
                    )
                  }
                >
                  {content}
                </button>
              ) : (
                <div key={activity.id} className="idea-included-row">
                  {content}
                </div>
              );
            })}
          </section>
        ) : null}
        {detail && (
          <section className="idea-how">
            <h4>{t("How it works")}</h4>
            <p>{detail.howItWorks}</p>
          </section>
        )}
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
        {activation?.error && (
          <p className="feed-error" role="alert">
            {activation.error}
          </p>
        )}
      </div>
      <footer>
        <button
          className="idea-primary"
          disabled={busy || pending || emptySelection}
          onClick={() => onActivate(selected)}
        >
          {started ? <MessageCircle size={18} /> : <WandSparkles size={18} />}
          {busy
            ? t("Starting…")
            : pending
              ? t("Checking submission…")
              : started
                ? t("Open conversation")
                : activation?.phase === "preparing"
                  ? t("Continue setup")
                  : t("Let's do it")}
        </button>
      </footer>
    </Modal>
  );
}

function FeedbackDialog({
  item,
  service,
  onClose,
  onSaved,
  onEditorChange,
}: {
  item: InspirationItem;
  service: MacIdeas;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onEditorChange: (open: boolean) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dirty = Boolean(draft.trim());
  useEffect(() => {
    onEditorChange(true);
    return () => onEditorChange(false);
  }, [onEditorChange]);
  useEffect(() => {
    const target = window as Window & {
      __OPEN_MUSE_HAS_UNSAVED_DOCUMENT__?: boolean;
      __OPEN_MUSE_DOCUMENT_SAVING__?: boolean;
    };
    target.__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__ = dirty || busy;
    target.__OPEN_MUSE_DOCUMENT_SAVING__ = busy;
    const discard = () => {
      if (!lock.current) closeRef.current();
    };
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("muse-discard-document", discard);
    window.addEventListener("beforeunload", leave);
    return () => {
      target.__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__ = false;
      target.__OPEN_MUSE_DOCUMENT_SAVING__ = false;
      window.removeEventListener("muse-discard-document", discard);
      window.removeEventListener("beforeunload", leave);
    };
  }, [dirty, busy]);
  const close = () => {
    if (!lock.current) dirty ? setConfirm(true) : onClose();
  };
  async function save(reason: string) {
    if (lock.current || !reason.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await service.feedback(item.id, "down", reason);
      await onSaved();
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={writing ? t("Write something") : t("Give feedback")}
      className="idea-feedback-dialog"
      onClose={close}
    >
      {writing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft);
          }}
        >
          <button
            type="button"
            className="idea-back"
            disabled={busy}
            onClick={() => setWriting(false)}
          >
            <ArrowLeft size={18} />
            {t("Back")}
          </button>
          <textarea
            autoFocus
            aria-label={t("Idea feedback")}
            maxLength={600}
            rows={4}
            value={draft}
            disabled={busy}
            placeholder={t("What didn't work about this idea?")}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="idea-primary" disabled={busy || !draft.trim()}>
            {busy ? t("Saving…") : t("Send")}
          </button>
        </form>
      ) : (
        <div className="idea-feedback-reasons">
          {[
            t("Not relevant"),
            t("Too repetitive"),
            t("Too specific"),
            t("I don't like it"),
            t("I just want to hide it"),
          ].map((reason) => (
            <button
              key={reason}
              disabled={busy}
              onClick={() => void save(reason)}
            >
              {reason}
              <ChevronRight size={18} />
            </button>
          ))}
          <button disabled={busy} onClick={() => setWriting(true)}>
            {t("Write something")}
            <ChevronRight size={18} />
          </button>
        </div>
      )}
      {error && (
        <p className="feed-error" role="alert">
          {error}
        </p>
      )}
      {confirm && (
        <Modal title={t("Discard feedback?")} onClose={() => setConfirm(false)}>
          <p>{t("Your feedback has not been saved.")}</p>
          <div className="feed-dialog-actions">
            <button className="pill-button" onClick={() => setConfirm(false)}>
              {t("Keep editing")}
            </button>
            <button className="pill-button" onClick={onClose}>
              {t("Discard changes")}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

export function IdeasPage({
  client,
  onMainChat,
  onOpenChat,
  onConnect,
  onEditorChange,
  split,
  onToggleChat,
}: {
  client: Client;
  onMainChat: (id: string) => Promise<void>;
  onOpenChat: (id: string) => void;
  onConnect: () => void;
  onEditorChange: (open: boolean) => void;
  split: boolean;
  onToggleChat: () => void;
}) {
  const service = useMemo(() => new MacIdeas(client), [client]);
  const [data, setData] = useState<MacIdeasSnapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>();
  const [dismissed, setDismissed] = useState<InspirationItem>();
  const [feedback, setFeedback] = useState<InspirationItem>();
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const lock = useRef(false);
  const reading = useRef(false);
  const sequence = useRef(0);
  const run = data?.run;
  const pending = Boolean(run && !["complete", "failed"].includes(run.phase));
  const resumable = run && ["preparing", "ready"].includes(run.phase);
  const activationPending = Object.values(data?.activations ?? {}).some(
    (activation) => activation.phase === "sending",
  );
  const generation = useTask(client, pending ? run?.session_id : undefined);
  const refresh = useCallback(async () => {
    if (reading.current || lock.current) return;
    reading.current = true;
    const request = ++sequence.current;
    try {
      const snapshot = await service.refresh();
      if (alive.current && request === sequence.current) {
        setData(snapshot);
        setError("");
      }
    } catch (error) {
      if (alive.current && request === sequence.current)
        setError((error as Error).message);
    } finally {
      reading.current = false;
      if (alive.current) setLoading(false);
    }
  }, [service]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const foreground = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      alive.current = false;
      sequence.current++;
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [refresh]);
  useEffect(() => {
    if (!pending && !activationPending) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [pending, activationPending, refresh]);
  async function action(fn: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    sequence.current++;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      try {
        const snapshot = await service.snapshot();
        if (alive.current) setData(snapshot);
      } catch (error) {
        if (alive.current) setError((error as Error).message);
      }
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  const sections = ideaSections(data?.items ?? [], data?.feedback ?? {});
  const detail = data?.items.find((item) => item.id === selected);
  const list = (items: InspirationItem[]) => (
    <div role="list">
      {items.map((item) => (
        <IdeaRow
          key={item.id}
          item={item}
          activation={data?.activations[item.id]}
          busy={busy}
          onOpen={() => setSelected(item.id)}
          onFeedback={(direction) =>
            void action(async () => {
              await service.feedback(item.id, direction);
              if (direction === "down") {
                setDismissed(item);
                setNotice("");
              } else setNotice(t("Thanks for the feedback."));
            })
          }
        />
      ))}
    </div>
  );
  return (
    <section className="desktop-ideas" aria-label={navLabel("ideas")}>
      <button
        className="ideas-split-toggle icon-button"
        aria-label={
          split ? t("Close side-by-side chat") : t("Open side-by-side chat")
        }
        aria-pressed={split}
        onClick={onToggleChat}
      >
        <PanelRight size={22} />
      </button>
      <div className="ideas-column">
        <header className="ideas-heading">
          <h1>{navLabel("ideas")}</h1>
        </header>
        <p className="ideas-description">
          {t(
            "I'm always thinking about new and different ways to help you. I'll surface my favorite ideas here.",
          )}
        </p>
        {error && (
          <div className="feed-error" role="alert">
            {error}
            <button disabled={busy} onClick={() => void refresh()}>
              {t("Refresh")}
            </button>
          </div>
        )}
        {loading && (
          <div
            className="ideas-loading"
            role="status"
            aria-label={t("Loading ideas")}
          >
            {[0, 1, 2].map((id) => (
              <div key={id}>
                <span />
                <p />
                <p />
              </div>
            ))}
          </div>
        )}
        {!loading && !sections.featured.length && (
          <aside className="ideas-empty">
            <h3>{t("No ideas yet.")}</h3>
            <p>
              {t("New ideas show up here as your companion learns about you.")}
            </p>
          </aside>
        )}
        <div className="ideas-sections">
          {sections.featured.length > 0 && (
            <section aria-label={t("Featured ideas")}>
              {list(sections.featured)}
            </section>
          )}
          {sections.groups.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h2>{group.title}</h2>
              {list(group.items)}
            </section>
          ))}
        </div>
        {notice && (
          <p className="ideas-notice" role="status">
            {notice}
          </p>
        )}
        {dismissed && (
          <div className="ideas-notice" role="status">
            {t("Idea dismissed")}
            <button onClick={() => setFeedback(dismissed)}>
              {t("Give feedback")}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await service.undoDismissal(dismissed.id);
                  setDismissed(undefined);
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
                : t("Thinking of new ways to help…")}
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
        {activationPending && (
          <p className="feed-status" role="status">
            {t(
              "Checking idea submission. Refresh reads history; it never resends an unconfirmed request.",
            )}
          </p>
        )}
        {!loading && (
          <footer className="feed-generation">
            <button
              className="pill-button"
              disabled={busy || !data || (pending && !resumable)}
              onClick={() =>
                client.signedIn()
                  ? void action(() => service.generate())
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
              aria-label={t("Refresh ideas")}
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <p>
              {t(
                "Generated with MA when you ask. Feedback is saved on this Mac and shapes future ideas. Automatic background suggestions are not connected yet.",
              )}
            </p>
          </footer>
        )}
      </div>
      {detail && data && (
        <IdeaPreview
          key={detail.id}
          item={detail}
          detail={ideaDetail(detail, data)}
          activation={data.activations[detail.id]}
          busy={busy}
          onClose={() => setSelected(undefined)}
          onActivate={(selected) => {
            if (!client.signedIn()) {
              setSelected(undefined);
              onConnect();
              return;
            }
            setSelected(undefined);
            void action(() => service.activate(detail, selected, onMainChat));
          }}
        />
      )}
      {feedback && (
        <FeedbackDialog
          item={feedback}
          service={service}
          onEditorChange={onEditorChange}
          onClose={() => setFeedback(undefined)}
          onSaved={async () => {
            setData(await service.snapshot());
            setNotice(t("Thanks for the feedback."));
          }}
        />
      )}
    </section>
  );
}
