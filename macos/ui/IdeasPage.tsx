import { t } from "../../shared/i18n";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useRouteHeader } from "./routeHeader";
import { RefreshCw } from "lucide-react";
import type { Client } from "../../src/api";
import type { InspirationItem } from "../../shared/inspiration";
import { Markdown } from "../../src/components";
import { useTask } from "../../src/useTask";
import { Modal, SplitChatIcon } from "./Chrome";
import { navLabel, refreshIdeasLabel, viewIdeaLabel } from "./labels";
import {
  AlarmIcon,
  ChevronRightIcon,
  CircleCheckFilledIcon,
  CircleIcon,
  DocumentIcon,
  AppGridIcon,
  LightbulbIcon,
  SearchIcon,
  BubbleIcon,
  WandIcon,
  CloseIcon,
  type IconProps,
} from "./icons";
import { IdeaActionsMenu, IdeaToastView, useIdeaToast } from "./IdeaMenu";
import {
  MacIdeas,
  ideaDetail,
  ideaSections,
  type IdeaActivation,
  type IdeaDetail,
  type MacIdeasSnapshot,
} from "./ideas";
import { focusedItem } from "./focusItem";

type RowActions = {
  onOpen: () => void;
  onMoreLikeThis: () => void;
  onNotInterested: () => void;
};

function IdeaIcon({ emoji }: { emoji?: string }) {
  return emoji ? (
    <span className="idea-icon idea-icon-emoji" aria-hidden="true">
      {emoji}
    </span>
  ) : (
    <span className="idea-icon idea-icon-chip" aria-hidden="true">
      <LightbulbIcon width={15} height={15} />
    </span>
  );
}

function IdeaRow({
  item,
  activation,
  busy,
  onOpen,
  onMoreLikeThis,
  onNotInterested,
}: {
  item: InspirationItem;
  activation?: IdeaActivation;
  busy: boolean;
} & RowActions) {
  const started = activation?.phase === "confirmed";
  return (
    <div role="listitem" className="idea-list-item">
      <div className="idea-row">
        <IdeaIcon emoji={item.emoji} />
        <button
          type="button"
          className="idea-open"
          onClick={onOpen}
          aria-label={viewIdeaLabel(item.title)}
        >
          <h3 title={item.title}>{item.title}</h3>
          {item.body && <p title={item.body}>{item.body}</p>}
        </button>
        <div className="idea-row-actions">
          <IdeaActionsMenu
            title={item.title}
            appearance="row"
            busy={busy}
            onLetsDoIt={started ? undefined : onOpen}
            onMoreLikeThis={onMoreLikeThis}
            onNotInterested={onNotInterested}
          />
          {started && (
            <span
              className="idea-started"
              role="img"
              aria-label={t("Started in chat")}
            >
              <CircleCheckFilledIcon width={16} height={16} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function IdeaSection({
  heading,
  label,
  children,
}: {
  heading?: string;
  label?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      className="idea-section"
      aria-labelledby={heading ? id : undefined}
      aria-label={heading ? undefined : label}
    >
      {heading && (
        <div className="idea-section-heading">
          <h2 id={id}>{heading}</h2>
        </div>
      )}
      <div role="list">{children}</div>
    </section>
  );
}

function RowSkeleton({ delay }: { delay: number }) {
  const style = delay ? { animationDelay: `${delay}ms` } : undefined;
  return (
    <div className="idea-row-skeleton" aria-hidden="true">
      <span className="idea-skeleton idea-skeleton-icon" />
      <div>
        <span className="idea-skeleton idea-skeleton-title" style={style} />
        <span
          className="idea-skeleton idea-skeleton-title short"
          style={style}
        />
        <span
          className="idea-skeleton idea-skeleton-line first"
          style={style}
        />
        <span className="idea-skeleton idea-skeleton-line" style={style} />
        <span
          className="idea-skeleton idea-skeleton-line short"
          style={style}
        />
      </div>
      <span className="idea-skeleton-spacer" />
    </div>
  );
}

function SectionSkeleton() {
  return (
    <section aria-hidden="true">
      <div className="idea-section-heading">
        <span className="idea-skeleton idea-skeleton-heading" />
      </div>
      <div>
        {[0, 1, 2, 3].map((index) => (
          <RowSkeleton key={index} delay={index * 80} />
        ))}
      </div>
    </section>
  );
}

function IdeasLoading() {
  return (
    <div
      className="ideas-loading"
      role="status"
      aria-live="polite"
      aria-label={t("Loading ideas")}
    >
      <div>
        {[0, 1, 2, 3].map((index) => (
          <RowSkeleton key={index} delay={index * 80} />
        ))}
      </div>
      <SectionSkeleton />
    </div>
  );
}

const activityIcons: Record<
  IdeaDetail["included"][number]["kind"],
  ComponentType<IconProps>
> = {
  conversation: BubbleIcon,
  research: SearchIcon,
  document: DocumentIcon,
  app: AppGridIcon,
  scheduled: AlarmIcon,
};

export function IdeaPreview({
  item,
  detail,
  activation,
  busy,
  onClose,
  onActivate,
  onMoreLikeThis,
  onNotInterested,
}: {
  item: InspirationItem;
  detail?: IdeaDetail;
  activation?: IdeaActivation;
  busy: boolean;
  onClose: () => void;
  onActivate: (selected: string[]) => void;
  onMoreLikeThis?: () => void;
  onNotInterested?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const [selected, setSelected] = useState(
    () => activation?.selected ?? detail?.included.map((item) => item.id) ?? [],
  );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  const included = detail?.included ?? [];
  const emptySelection = Boolean(
    included.length &&
    included.every((item) => item.selectable) &&
    !selected.length,
  );
  const pending = activation?.phase === "sending";
  const started = activation?.phase === "confirmed";
  const available =
    !started && !pending && activation?.phase !== "preparing" && !busy;
  const toggle = (id: string) =>
    setSelected((old) =>
      old.includes(id) ? old.filter((value) => value !== id) : [...old, id],
    );
  return (
    <dialog
      ref={dialog}
      className="idea-preview"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <button
        type="button"
        className="idea-preview-close idea-elevated-button"
        aria-label={t("Close")}
        onClick={onClose}
      >
        <CloseIcon width={15} height={15} />
      </button>
      <div
        className="idea-preview-scroll"
        role="group"
        aria-labelledby={titleId}
      >
        <div className="idea-preview-content">
          <h2 id={titleId} title={item.title}>
            {item.title}
          </h2>
          <div className="idea-preview-body">
            {item.body && (
              <div className="idea-preview-description">
                <Markdown text={item.body} />
              </div>
            )}
            {(item.reason || included.length > 0 || detail) && (
              <section className="idea-preview-sections">
                {item.reason && (
                  <p className="idea-fit-reason">{item.reason}</p>
                )}
                {included.length > 0 && (
                  <div
                    className="idea-included"
                    aria-labelledby={`${titleId}-included`}
                  >
                    <h4 id={`${titleId}-included`}>{t("What's included")}</h4>
                    <div>
                      {included.map((activity) => {
                        const Icon = activityIcons[activity.kind];
                        const checked = selected.includes(activity.id);
                        const interactive = available && activity.selectable;
                        const showCheck =
                          included.length > 1 &&
                          (activity.selectable || !available);
                        return (
                          <div
                            key={activity.id}
                            className={`idea-included-row ${showCheck && interactive ? "interactive" : ""}`}
                            onClick={
                              showCheck && interactive
                                ? () => toggle(activity.id)
                                : undefined
                            }
                          >
                            <span
                              className="idea-activity-icon"
                              aria-hidden="true"
                            >
                              <Icon width={20} height={20} />
                            </span>
                            <span className="idea-included-text">
                              <strong>{activity.title}</strong>
                              {activity.description.trim() && (
                                <span>{activity.description}</span>
                              )}
                            </span>
                            {showCheck && (
                              <span
                                className="idea-check"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!interactive}
                                  aria-label={t("Include {title}", {
                                    title: activity.title,
                                  })}
                                  onChange={() => {
                                    if (interactive) toggle(activity.id);
                                  }}
                                />
                                {checked ? (
                                  <CircleCheckFilledIcon
                                    className="checked"
                                    width={20}
                                    height={20}
                                  />
                                ) : (
                                  <CircleIcon width={20} height={20} />
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {detail?.howItWorks && (
                  <div className="idea-how" aria-labelledby={`${titleId}-how`}>
                    <h4 id={`${titleId}-how`}>{t("How it works")}</h4>
                    <p>{detail.howItWorks}</p>
                  </div>
                )}
              </section>
            )}
            {item.sources.length > 0 && (
              <ul className="idea-sources" aria-label={t("Sources")}>
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
            {activation?.error && (
              <p className="idea-preview-error" role="alert">
                {activation.error}
              </p>
            )}
          </div>
        </div>
      </div>
      <footer>
        {onMoreLikeThis && onNotInterested && (
          <IdeaActionsMenu
            title={item.title}
            appearance="bubble"
            busy={busy}
            onLetsDoIt={
              started || pending || busy
                ? undefined
                : () => onActivate(selected)
            }
            letsDoItDisabled={emptySelection}
            onMoreLikeThis={onMoreLikeThis}
            onNotInterested={onNotInterested}
          />
        )}
        <button
          type="button"
          className="idea-primary"
          disabled={busy || pending || emptySelection}
          onClick={() => onActivate(selected)}
        >
          {started ? (
            <BubbleIcon width={15} height={15} />
          ) : (
            <WandIcon width={15} height={15} />
          )}
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
    </dialog>
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
  const chevron = (
    <ChevronRightIcon
      className="idea-feedback-chevron"
      width={14}
      height={14}
    />
  );
  return (
    <Modal
      title={writing ? t("Write something") : t("Give feedback")}
      className={`idea-feedback-dialog ${writing ? "writing" : ""}`}
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
            className="idea-back idea-elevated-button"
            aria-label={t("Back")}
            disabled={busy}
            onClick={() => setWriting(false)}
          >
            <ChevronRightIcon width={15} height={15} />
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
          <button className="idea-send" disabled={busy || !draft.trim()}>
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
              type="button"
              disabled={busy}
              onClick={() => void save(reason)}
            >
              <span>{reason}</span>
              {chevron}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => setWriting(true)}
          >
            <span>{t("Write something")}</span>
            {chevron}
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
  onConnect,
  onEditorChange,
  split,
  onToggleChat,
  focus,
}: {
  client: Client;
  onMainChat: (id: string) => Promise<void>;
  onConnect: () => void;
  onEditorChange: (open: boolean) => void;
  split: boolean;
  onToggleChat: () => void;
  // An idea to open, from a message's card.
  focus?: { id?: string; title?: string };
}) {
  const routeScroller = useRouteHeader<HTMLElement>();
  const service = useMemo(() => new MacIdeas(client), [client]);
  const [data, setData] = useState<MacIdeasSnapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>();
  // A card in the chat opens its idea once the ideas have loaded.
  const opened = useRef<string | undefined>(undefined);
  const target = focusedItem(data?.items ?? [], focus);
  useEffect(() => {
    if (!target || opened.current === target.id) return;
    opened.current = target.id;
    setSelected(target.id);
  }, [target]);
  const [feedback, setFeedback] = useState<InspirationItem>();
  const toasts = useIdeaToast();
  const showToast = toasts.show;
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
  // Runs one serialized change, then rereads local state. Resolves to whether
  // the change succeeded, or undefined when another change was still running.
  async function action(fn: () => Promise<unknown>, quiet = false) {
    if (lock.current) return undefined;
    lock.current = true;
    sequence.current++;
    setBusy(true);
    if (!quiet) setError("");
    let ok = true;
    try {
      await fn();
    } catch (error) {
      ok = false;
      if (alive.current && !quiet) setError((error as Error).message);
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
    return ok;
  }
  const moreLikeThis = (item: InspirationItem) =>
    void action(() => service.feedback(item.id, "up"), true).then(
      (ok) =>
        ok !== undefined &&
        showToast(
          ok
            ? { tone: "success", text: t("Thanks for the feedback.") }
            : { tone: "error", text: t("Couldn't save feedback. Try again.") },
        ),
    );
  const notInterested = (item: InspirationItem) =>
    void action(() => service.feedback(item.id, "down"), true).then(
      (ok) =>
        ok !== undefined &&
        showToast(
          ok
            ? {
                tone: "success",
                text: t("Idea dismissed"),
                action: {
                  label: t("Give feedback"),
                  onClick: () => setFeedback(item),
                },
              }
            : {
                tone: "error",
                text: t("Couldn't save feedback. Try again."),
              },
        ),
    );
  const sections = ideaSections(data?.items ?? [], data?.feedback ?? {});
  const hasIdeas = sections.featured.length > 0;
  const loadFailed = !loading && Boolean(error) && !hasIdeas;
  const detail = data?.items.find((item) => item.id === selected);
  const rows = (items: InspirationItem[]) =>
    items.map((item) => (
      <IdeaRow
        key={item.id}
        item={item}
        activation={data?.activations[item.id]}
        busy={busy}
        onOpen={() => setSelected(item.id)}
        onMoreLikeThis={() => moreLikeThis(item)}
        onNotInterested={() => notInterested(item)}
      />
    ));
  return (
    <>
      {/* Outside the scroller, so its scroll bar gutter never moves it. */}
      <button
        className="ideas-split-toggle icon-button"
        aria-label={
          split ? t("Close side-by-side chat") : t("Open side-by-side chat")
        }
        aria-pressed={split}
        onClick={onToggleChat}
      >
        <SplitChatIcon open={split} />
      </button>
      <section
        className="desktop-ideas route-scroller"
        aria-label={navLabel("ideas")}
        ref={routeScroller}
      >
        <IdeaToastView
          toast={toasts.toast}
          onDismiss={toasts.dismiss}
          onRemove={toasts.remove}
        />
        <div className="ideas-column">
          <header className="ideas-heading route-heading">
            <h1>{navLabel("ideas")}</h1>
          </header>
          <div className="ideas-description route-description">
            {loading ? (
              <span
                className="idea-skeleton ideas-subtitle-skeleton"
                aria-hidden="true"
              />
            ) : !hasIdeas && !loadFailed ? (
              t(
                "I'm always thinking about new and different ways to help you. I'll surface my favorite ideas here.",
              )
            ) : (
              <span className="ideas-subtitle-blank" aria-hidden="true" />
            )}
          </div>
          <div className="ideas-sections">
            {loading && !hasIdeas && <IdeasLoading />}
            {loadFailed && (
              <div className="ideas-state-card" role="alert">
                <p className="ideas-state-title">{t("Ideas didn't load.")}</p>
                <p className="ideas-state-body">{error}</p>
                <button
                  type="button"
                  className="ideas-flat-button"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  {t("Try again")}
                </button>
              </div>
            )}
            {!loading && !loadFailed && (
              <>
                {hasIdeas && (
                  <IdeaSection label={t("Featured ideas")}>
                    {rows(sections.featured)}
                  </IdeaSection>
                )}
                {sections.groups.map((group) => (
                  <IdeaSection key={group.title} heading={group.title}>
                    {rows(group.items)}
                  </IdeaSection>
                ))}
                {!hasIdeas && (
                  <div className="ideas-state-card">
                    <p className="ideas-state-title">{t("No ideas yet.")}</p>
                    <p className="ideas-state-body">
                      {t(
                        "New ideas show up here as your companion learns about you.",
                      )}
                    </p>
                  </div>
                )}
              </>
            )}
            {error && !loadFailed && (
              <p className="feed-error" role="alert">
                {error}
              </p>
            )}
            {run?.error && (
              <p className="feed-error" role="alert">
                {/* Stored in English; shown in the app's language. */}
                {t(run.error)}
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
            {activationPending && (
              <p className="feed-status" role="status">
                {t(
                  "Checking idea submission. Refresh reads history; it never resends an unconfirmed request.",
                )}
              </p>
            )}
            {!loading && (
              <footer className="ideas-generation">
                <button
                  type="button"
                  className="ideas-flat-button"
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
                  type="button"
                  className="ideas-refresh idea-borderless-button"
                  aria-label={refreshIdeasLabel()}
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={16} />
                </button>
              </footer>
            )}
          </div>
        </div>
        {detail && data && (
          <IdeaPreview
            key={detail.id}
            item={detail}
            detail={ideaDetail(detail, data)}
            activation={data.activations[detail.id]}
            busy={busy}
            onClose={() => setSelected(undefined)}
            onMoreLikeThis={() => moreLikeThis(detail)}
            onNotInterested={() => {
              setSelected(undefined);
              notInterested(detail);
            }}
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
              showToast({
                tone: "success",
                text: t("Thanks for the feedback."),
              });
            }}
          />
        )}
      </section>
    </>
  );
}
