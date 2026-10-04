import { formatLocale, t } from "../../shared/i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useRouteHeader } from "./routeHeader";
import type { Client } from "../../src/api";
import type { Goal } from "../../shared/types";
import { goalCategories, type GoalCategory } from "../../shared/goals";
import { Markdown } from "../../src/components";
import { Modal, SplitChatIcon } from "./Chrome";
import {
  RefreshIcon,
  SquareCheckIcon,
  SquarePlusIcon,
  SquareIcon,
  BriefcaseIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  DollarIcon,
  EllipsisIcon,
  HeartIcon,
  LaptopIcon,
  ListCheckIcon,
  PaletteIcon,
  PencilIcon,
  TrashIcon,
  PeopleIcon,
  WandIcon,
  type IconProps,
} from "./icons";
import { SquareCheckFilledIcon, GoalBoxIcon, GripIcon } from "./icons";
import {
  MacGoals,
  completedGoalGroups,
  goalActivityLabel,
  goalDayLabel,
  goalDescendants,
  macGoalStarter,
  type MacGoalsSnapshot,
} from "./goals";

type Glyph = ComponentType<IconProps>;
const categoryIcons: Record<GoalCategory, Glyph> = {
  health: HeartIcon,
  relationships: PeopleIcon,
  finance: DollarIcon,
  career: BriefcaseIcon,
  interests: PaletteIcon,
  productivity: LaptopIcon,
  custom: GoalBoxIcon,
};
const categoryDialogTitle = (category: GoalCategory) =>
  ({
    health: t("Create a health goal"),
    relationships: t("Create a relationships goal"),
    finance: t("Create a finance goal"),
    career: t("Create a career goal"),
    interests: t("Create an interests goal"),
    productivity: t("Create a productivity goal"),
    custom: t("Create a new goal"),
  })[category];
// Rows revealed per "Show more" step.
const revealStep = 10;

// A popover menu anchored to an icon button. It stays in the document so its
// items remain reachable to assistive technology while closed.
function GoalPopover({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: (close: (fn: () => void) => () => void) => ReactNode;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const choose = (fn: () => void) => () => {
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
    <details className={className} ref={menu}>
      <summary aria-label={label} aria-haspopup="menu">
        <EllipsisIcon />
      </summary>
      <div className="goal-menu" role="menu">
        {children(choose)}
      </div>
    </details>
  );
}

function MenuItem({
  icon: Icon,
  label,
  danger = false,
  disabled,
  onSelect,
}: {
  icon: Glyph;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      role="menuitem"
      className={danger ? "danger" : ""}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="goal-menu-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="goal-menu-label">{label}</span>
    </button>
  );
}

function MenuCheckbox({
  label,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="goal-menu-check" aria-hidden="true">
        {checked && <CheckIcon />}
      </span>
      <span className="goal-menu-label">{label}</span>
    </button>
  );
}

function GoalMenu({
  goal,
  busy,
  canAdd,
  className = "goal-options",
  onComplete,
  onAdd,
  onRename,
  onDelete,
}: {
  goal: Goal;
  busy: boolean;
  canAdd: boolean;
  className?: string;
  onComplete: () => void;
  onAdd: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <GoalPopover
      className={className}
      label={t("Options for {title}", { title: goal.title })}
    >
      {(choose) => (
        <>
          <MenuItem
            icon={SquareCheckIcon}
            disabled={busy}
            label={
              goal.status === "completed"
                ? t("Mark as not complete")
                : t("Complete")
            }
            onSelect={choose(onComplete)}
          />
          {canAdd && (
            <MenuItem
              icon={SquarePlusIcon}
              disabled={busy}
              label={t("Add subgoal")}
              onSelect={choose(onAdd)}
            />
          )}
          <MenuItem
            icon={PencilIcon}
            disabled={busy}
            label={t("Rename")}
            onSelect={choose(onRename)}
          />
          <hr />
          <MenuItem
            icon={TrashIcon}
            danger
            disabled={busy}
            label={t("Delete")}
            onSelect={choose(onDelete)}
          />
        </>
      )}
    </GoalPopover>
  );
}

function GoalCheck({
  goal,
  busy,
  onToggle,
}: {
  goal: Goal;
  busy: boolean;
  onToggle: () => void;
}) {
  const complete = goal.status === "completed";
  return (
    <button
      className="goal-check"
      role="checkbox"
      aria-label={t(
        complete ? "Mark {title} not complete" : "Mark {title} complete",
        { title: goal.title },
      )}
      aria-checked={complete}
      disabled={busy}
      onClick={onToggle}
    >
      {complete ? (
        <SquareCheckFilledIcon className="goal-check-done" />
      ) : (
        <>
          <SquareIcon className="goal-check-empty" />
          <SquareCheckIcon className="goal-check-preview" />
        </>
      )}
    </button>
  );
}

type RowHandlers = {
  onSelect: (goal: Goal) => void;
  onComplete: (goal: Goal) => void;
  onAdd: (goal: Goal) => void;
  onRename: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
};

function GoalRow({
  goal,
  all,
  subtitles,
  busy,
  depth = 0,
  handlers,
}: {
  goal: Goal;
  all: Goal[];
  subtitles: boolean;
  busy: boolean;
  depth?: number;
  handlers: RowHandlers;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = all.filter(
    (item) => item.parent_id === goal.id && item.status !== "completed",
  );
  const complete = goal.status === "completed";
  const subtitle = goal.status === "paused" ? t("Paused") : goal.description;
  const showSubtitle = subtitles && subtitle.trim().length > 0;
  const nested = children.length > 0 && !complete;
  return (
    <div className="goal-tree">
      <div
        className={`goal-row${showSubtitle ? " has-subtitle" : ""}${complete ? " completed" : ""}`}
        style={depth ? { marginInlineStart: depth * 32 } : undefined}
      >
        <span className="goal-row-lead">
          <GoalCheck
            goal={goal}
            busy={busy}
            onToggle={() => handlers.onComplete(goal)}
          />
          {nested && (
            <button
              className="goal-expand"
              aria-label={t(
                expanded
                  ? "Collapse subgoals for {title}"
                  : "Expand subgoals for {title}",
                { title: goal.title },
              )}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </button>
          )}
        </span>
        <button
          className="goal-row-open"
          aria-label={t("Open goal: {title}", { title: goal.title })}
          onClick={() => handlers.onSelect(goal)}
        >
          <strong title={goal.title}>{goal.title}</strong>
          {showSubtitle && <span>{subtitle}</span>}
        </button>
        <GoalMenu
          goal={goal}
          busy={busy}
          canAdd={depth === 0 && !goal.parent_id}
          onComplete={() => handlers.onComplete(goal)}
          onAdd={() => handlers.onAdd(goal)}
          onRename={() => handlers.onRename(goal)}
          onDelete={() => handlers.onDelete(goal)}
        />
      </div>
      {expanded && nested && (
        <div className="goal-subtree">
          {children.map((child) => (
            <GoalRow
              key={child.id}
              goal={child}
              all={all}
              subtitles={subtitles}
              busy={busy}
              depth={depth + 1}
              handlers={handlers}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompletedGoalRow({
  goal,
  busy,
  handlers,
}: {
  goal: Goal;
  busy: boolean;
  handlers: RowHandlers;
}) {
  return (
    <div className="goal-row goal-completed-row completed">
      <span className="goal-row-lead">
        <GoalCheck
          goal={goal}
          busy={busy}
          onToggle={() => handlers.onComplete(goal)}
        />
      </span>
      <button
        className="goal-row-open"
        aria-label={t("Open goal: {title}", { title: goal.title })}
        onClick={() => handlers.onSelect(goal)}
      >
        <strong title={goal.title}>{goal.title}</strong>
      </button>
      <GoalPopover
        className="goal-options"
        label={t("Options for {title}", { title: goal.title })}
      >
        {(choose) => (
          <MenuItem
            icon={TrashIcon}
            danger
            disabled={busy}
            label={t("Delete")}
            onSelect={choose(() => handlers.onDelete(goal))}
          />
        )}
      </GoalPopover>
    </div>
  );
}

function GoalsSection({
  id,
  label,
  accent = false,
  children,
}: {
  id: string;
  label: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="goals-section" aria-labelledby={id}>
      <div className={`goals-section-heading${accent ? " accent" : ""}`}>
        {accent && (
          <span className="goals-pulse-slot" aria-hidden="true">
            <span className="goals-pulse">
              <span className="goals-pulse-halo" />
              <span className="goals-pulse-dot" />
            </span>
          </span>
        )}
        <h2 id={id}>{label}</h2>
      </div>
      {children}
    </section>
  );
}

const skeletonCategoryWidths = [64, 128, 80, 64, 96, 112, 96];
function GoalsSkeleton({ subtitles }: { subtitles: boolean }) {
  return (
    <div
      className="goals-skeleton"
      role="status"
      aria-busy="true"
      aria-label={t("Loading goals")}
    >
      <div aria-hidden="true">
        <div className="goals-skeleton-heading">
          <span className="goals-pulse-slot">
            <span className="goals-skeleton-dot" />
          </span>
          <span className="goals-skeleton-bar heading" />
        </div>
        {[0, 1].map((row) => (
          <div
            className={`goals-skeleton-row${subtitles ? " has-subtitle" : ""}`}
            key={row}
          >
            <span className="goals-skeleton-box" />
            <span className="goals-skeleton-lines">
              <span className="goals-skeleton-bar title" />
              {subtitles && <span className="goals-skeleton-bar subtitle" />}
            </span>
          </div>
        ))}
      </div>
      <div aria-hidden="true">
        <div className="goals-skeleton-heading">
          <span className="goals-skeleton-bar heading" />
        </div>
        {skeletonCategoryWidths.map((width, row) => (
          <div className="goals-skeleton-category" key={row}>
            <span className="goals-skeleton-circle" />
            <span className="goals-skeleton-bar" style={{ width }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GoalsErrorState({
  connected,
  detail,
  busy,
  onRetry,
}: {
  connected: boolean;
  detail: string;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="goals-error-state" role="alert">
      <div className="goals-error-title">
        <CircleAlertIcon aria-hidden="true" />
        <h2>{t("Couldn't load goals right now.")}</h2>
      </div>
      <p>
        {connected
          ? t("Please try again.")
          : t("Reconnect and then try again.")}
      </p>
      {detail && <p className="goals-error-detail">{detail}</p>}
      <button
        className="goal-primary compact"
        disabled={!connected || busy}
        onClick={onRetry}
      >
        <RefreshIcon aria-hidden="true" />
        {t("Try again")}
      </button>
    </div>
  );
}

function GoalActivity({ goal, data }: { goal: Goal; data?: MacGoalsSnapshot }) {
  const entries = [...(data?.activity[goal.id] ?? [])].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
  if (!entries.length)
    return (
      <section
        className="goal-timeline"
        aria-label={t("Goal activity timeline")}
      >
        <p className="goal-timeline-empty">{t("No activity yet.")}</p>
      </section>
    );
  const latest = Date.parse(entries[0].at);
  return (
    <section className="goal-timeline" aria-label={t("Goal activity timeline")}>
      <h3>{t("Activity")}</h3>
      {Number.isFinite(latest) && (
        <h4 className="goal-timeline-day">{goalDayLabel(latest)}</h4>
      )}
      <ul>
        {entries.map((activity) => (
          <li key={activity.id}>
            <span className="goal-timeline-rail" aria-hidden="true">
              <CircleCheckIcon />
              <span className="goal-timeline-line" />
            </span>
            <div>
              <strong>{goalActivityLabel(activity.title)}</strong>
              <time dateTime={activity.at}>
                {new Date(activity.at).toLocaleString(formatLocale(), {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
              {activity.observed && (
                <small>{t("Change observed on this Mac")}</small>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RenameGoal({
  initial,
  client,
  onSaved,
  onClose,
  onEditorChange,
}: {
  initial: { goal: Goal; revision: string };
  client: Client;
  onSaved: () => Promise<void>;
  onClose: () => void;
  onEditorChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial.goal.title);
  const [baseline, setBaseline] = useState(initial);
  const [remote, setRemote] = useState<{ goal: Goal; revision: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false),
    closeRef = useRef(onClose);
  const dirty = draft.trim() !== baseline.goal.title;
  closeRef.current = onClose;
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
  async function save() {
    if (lock.current || !dirty || !draft.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await client.updateGoal(
        baseline.goal.id,
        { title: draft.trim() },
        baseline.revision,
      );
      await onSaved();
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function review() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const latest = await client.goals();
      const goal = latest.data.find((goal) => goal.id === initial.goal.id);
      if (!goal)
        throw new Error(
          t("This goal no longer exists. Your draft is preserved."),
        );
      setRemote({ goal, revision: latest.revision });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      className="goal-dialog goal-rename-dialog"
      title={t("Rename goal")}
      onClose={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor="goal-name">{t("Goal name")}</label>
        <input
          id="goal-name"
          aria-label={t("Goal name")}
          autoFocus
          maxLength={160}
          className="goal-input"
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        {error && (
          <div className="goals-alert" role="alert">
            {error}
            <button type="button" disabled={busy} onClick={() => void review()}>
              {t("Review cloud version")}
            </button>
          </div>
        )}
        {remote && (
          <aside className="goal-cloud-copy">
            <strong>{t("Latest name")}</strong>
            <p>{remote.goal.title}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBaseline(remote);
                setRemote(undefined);
                setError("");
              }}
            >
              {t("Keep my name and use latest revision")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(remote.goal.title);
                setBaseline(remote);
                setRemote(undefined);
                setError("");
              }}
            >
              {t("Replace draft with latest name")}
            </button>
          </aside>
        )}
        <footer className="goal-dialog-actions">
          <button
            type="button"
            className="goal-button"
            disabled={busy}
            onClick={close}
          >
            {t("Cancel")}
          </button>
          <button
            className="goal-button primary"
            disabled={busy || !dirty || !draft.trim()}
          >
            {busy ? t("Saving…") : t("Save")}
          </button>
        </footer>
      </form>
      {confirm && (
        <Modal
          title={t("Discard name changes?")}
          className="goal-dialog"
          onClose={() => setConfirm(false)}
        >
          <p className="goal-dialog-text">
            {t("The goal name has unsaved changes.")}
          </p>
          <div className="goal-dialog-actions">
            <button className="goal-button" onClick={() => setConfirm(false)}>
              {t("Keep editing")}
            </button>
            <button className="goal-button destructive" onClick={onClose}>
              {t("Discard changes")}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

export function GoalsPage({
  client,
  selectedId,
  onSelect,
  onConversation,
  onDraft,
  onOpenChat,
  onConnect,
  onEditorChange,
  split,
  onToggleChat,
}: {
  client: Client;
  selectedId?: string;
  onSelect: (id?: string) => void;
  onConversation: (id: string) => Promise<void>;
  onDraft: (text: string, goal?: Goal) => void;
  onOpenChat: (id: string) => void;
  onConnect: () => void;
  onEditorChange: (open: boolean) => void;
  split: boolean;
  onToggleChat: () => void;
}) {
  const routeScroller = useRouteHeader<HTMLElement>();
  const service = useMemo(() => new MacGoals(client), [client]);
  const [data, setData] = useState<MacGoalsSnapshot>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<GoalCategory>();
  const [completed, setCompleted] = useState(false);
  const [rename, setRename] = useState<{ goal: Goal; revision: string }>();
  const [deleting, setDeleting] = useState<{
    goal: Goal;
    revision: string;
    count: number;
  }>();
  const [shown, setShown] = useState(revealStep);
  const lock = useRef(false),
    alive = useRef(true),
    reading = useRef(false),
    sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (lock.current || reading.current) return;
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
    const timer = setInterval(foreground, 15000);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      alive.current = false;
      sequence.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", foreground);
      service.dispose();
    };
  }, [refresh, service]);
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
  const goals = data?.data ?? [];
  const subtitles = data?.subtitles ?? true;
  const current = goals.find((goal) => goal.id === selectedId);
  const activeGoals = goals.filter((goal) => goal.status !== "completed");
  const roots = activeGoals.filter(
    (goal) => !activeGoals.some((parent) => parent.id === goal.parent_id),
  );
  const finished = goals.filter((goal) => goal.status === "completed");
  const pending = data?.chats.find(
    (run) => !["confirmed", "failed"].includes(run.phase),
  );
  const addSubgoal = (goal: Goal) => {
    onSelect();
    onDraft(
      t('I want to create a sub-goal under "{title}" about ', {
        title: goal.title,
      }),
      goal,
    );
  };
  const complete = (goal: Goal) =>
    void action(() =>
      service.setCompleted(
        goal.id,
        goal.status !== "completed",
        data!.revision,
      ),
    );
  const handlers: RowHandlers = {
    onSelect: (goal) => {
      setCompleted(false);
      onSelect(goal.id);
    },
    onComplete: complete,
    onAdd: addSubgoal,
    onRename: (goal) => setRename({ goal, revision: data!.revision }),
    onDelete: (goal) =>
      setDeleting({
        goal,
        revision: data!.revision,
        count: goalDescendants(goals, goal.id).size,
      }),
  };
  const row = (goal: Goal) => (
    <GoalRow
      key={goal.id}
      goal={goal}
      all={goals}
      subtitles={subtitles}
      busy={busy}
      handlers={handlers}
    />
  );
  const alert = error ? (
    <div className="goals-alert" role="alert">
      <CircleAlertIcon aria-hidden="true" />
      <span>{error}</span>
      <button disabled={busy} onClick={() => void refresh()}>
        {t("Try again")}
      </button>
    </div>
  ) : null;
  const unavailable = !data && !!error && !loading;
  const empty = !!data && roots.length === 0;
  return (
    <section
      className="desktop-goals route-scroller"
      aria-label={t("Goals")}
      ref={routeScroller}
    >
      <button
        className="goals-split-toggle icon-button"
        aria-label={
          split ? t("Close side-by-side chat") : t("Open side-by-side chat")
        }
        aria-pressed={split}
        onClick={onToggleChat}
      >
        <SplitChatIcon open={split} />
      </button>
      <div className="goals-column">
        <header className="goals-heading route-heading">
          <h1>{t("Goals")}</h1>
          {goals.length > 0 && (
            <GoalPopover
              className="goals-header-options"
              label={t("Goals options")}
            >
              {(choose) => (
                <>
                  <MenuCheckbox
                    label={t("Show subtitles")}
                    checked={subtitles}
                    disabled={busy}
                    onSelect={choose(
                      () => void action(() => service.subtitles(!subtitles)),
                    )}
                  />
                  <hr />
                  <MenuItem
                    icon={ListCheckIcon}
                    label={t("Completed goals")}
                    onSelect={choose(() => setCompleted(true))}
                  />
                </>
              )}
            </GoalPopover>
          )}
        </header>
        {empty && (
          <p className="goals-description route-description">
            {t(
              "Pick a category and tell me what you're after, and I'll build a personalized plan that evolves with you.",
            )}
          </p>
        )}
        {!data && loading ? (
          <GoalsSkeleton subtitles />
        ) : unavailable ? (
          <div className="goals-content">
            <GoalsErrorState
              connected={client.signedIn()}
              detail={error}
              busy={busy}
              onRetry={() => void refresh()}
            />
          </div>
        ) : (
          <div className="goals-content">
            {alert}
            {roots.length > 0 && (
              <GoalsSection id="goals-user" label={t("Goals")} accent>
                <div className="goals-rows">
                  {roots.slice(0, shown).map(row)}
                  {roots.length > shown && (
                    <button
                      className="goals-show-more"
                      onClick={() => setShown((value) => value + revealStep)}
                    >
                      <span aria-hidden="true">
                        <GripIcon />
                      </span>
                      {t("Show {count} more", {
                        count: Math.min(revealStep, roots.length - shown),
                      })}
                    </button>
                  )}
                </div>
              </GoalsSection>
            )}
            <GoalsSection id="goals-create" label={t("Create a goal")}>
              <div
                className="goal-categories"
                role="group"
                aria-label={t("Goal categories")}
              >
                {goalCategories.map((category) => {
                  const Icon = categoryIcons[category.id];
                  return (
                    <button
                      className="goal-category"
                      key={category.id}
                      disabled={busy}
                      onClick={() => setCategory(category.id)}
                    >
                      <span className="goal-category-icon" aria-hidden="true">
                        <Icon />
                      </span>
                      <span className="goal-category-label">
                        {t(category.label)}
                      </span>
                      <span
                        className="goal-category-chevron"
                        aria-hidden="true"
                      >
                        <ChevronRightIcon />
                      </span>
                    </button>
                  );
                })}
              </div>
            </GoalsSection>
            {pending && (
              <aside className="goal-pending" role="status">
                <p>
                  {pending.phase === "creating" || pending.phase === "sending"
                    ? t("Checking goal submission…")
                    : t("Goal conversation ready to continue")}
                </p>
                {pending.error && (
                  <p className="goal-pending-error">{pending.error}</p>
                )}
                <div className="goal-pending-actions">
                  {["preparing", "ready"].includes(pending.phase) && (
                    <button
                      className="goal-button primary"
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          service.start(pending.category, onConversation),
                        )
                      }
                    >
                      {t("Continue {category} goal", {
                        category: t(pending.category),
                      })}
                    </button>
                  )}
                  {pending.session && (
                    <button
                      className="goal-button"
                      onClick={() => onOpenChat(pending.session!)}
                    >
                      {t("View goal conversation")}
                    </button>
                  )}
                </div>
              </aside>
            )}
          </div>
        )}
      </div>
      {category && (
        <Modal
          title={categoryDialogTitle(category)}
          className="goal-dialog goal-intro-dialog"
          onClose={() => {
            if (!busy) setCategory(undefined);
          }}
        >
          <p className="goal-dialog-text">
            {t(
              "First, we'll refine the goal together in chat. I'll ask you a few questions to clarify what you're after. Once it's set, I'll track your progress here.",
            )}
          </p>
          {alert}
          <button
            className="goal-primary"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              if (!client.signedIn()) {
                setCategory(undefined);
                onConnect();
                return;
              }
              if (category === "custom") {
                onDraft(macGoalStarter(category));
                setCategory(undefined);
                return;
              }
              void action(async () => {
                await service.start(category, onConversation);
                if (alive.current) setCategory(undefined);
              });
            }}
          >
            {busy ? (
              <span className="goal-spinner" aria-hidden="true" />
            ) : (
              <WandIcon aria-hidden="true" />
            )}
            {busy ? t("Starting…") : t("Let's do it")}
          </button>
        </Modal>
      )}
      {current && (
        <Modal
          title={current.title}
          className="goal-detail-dialog"
          onClose={() => {
            if (!busy && !rename) onSelect();
          }}
        >
          <div className="goal-detail-actions">
            <GoalMenu
              goal={current}
              busy={busy}
              canAdd={!current.parent_id}
              className="goal-options elevated"
              onComplete={() => complete(current)}
              onAdd={() => addSubgoal(current)}
              onRename={() => handlers.onRename(current)}
              onDelete={() => handlers.onDelete(current)}
            />
          </div>
          {current.parent_id && (
            <button
              className="goal-parent"
              onClick={() => onSelect(current.parent_id)}
            >
              {goals.find((goal) => goal.id === current.parent_id)?.title ??
                t("Parent goal")}
              <ChevronRightIcon aria-hidden="true" />
            </button>
          )}
          {current.status === "paused" && (
            <p className="goal-detail-status">{t("Paused")}</p>
          )}
          {current.description && (
            <div className="goal-detail-description">
              <Markdown text={current.description} />
            </div>
          )}
          {current.steps.length > 0 && (
            <section className="goal-plan" aria-label={t("Plan steps")}>
              <h3>{t("Plan")}</h3>
              {current.steps.map((step) => (
                <label key={step.id}>
                  <input
                    type="checkbox"
                    checked={step.done}
                    disabled={busy}
                    onChange={() =>
                      void action(() =>
                        client.updateGoal(
                          current.id,
                          {
                            steps: current.steps.map((item) =>
                              item.id === step.id
                                ? { ...item, done: !item.done }
                                : item,
                            ),
                          },
                          data!.revision,
                        ),
                      )
                    }
                  />
                  <span className={step.done ? "done" : ""}>{step.title}</span>
                </label>
              ))}
            </section>
          )}
          {goals.some((goal) => goal.parent_id === current.id) && (
            <section
              className="goal-detail-subgoals"
              aria-label={t("Subgoals")}
            >
              <h3>{t("Subgoals")}</h3>
              {goals.filter((goal) => goal.parent_id === current.id).map(row)}
            </section>
          )}
          {alert}
          <GoalActivity goal={current} data={data} />
          <button
            className="goal-talk"
            disabled={busy}
            onClick={() => {
              onSelect();
              if (current.session_id) void onConversation(current.session_id);
              else
                onDraft(
                  t('Discuss the goal "{title}"', { title: current.title }),
                  current,
                );
            }}
          >
            {t("Talk about this goal")}
          </button>
        </Modal>
      )}
      {selectedId && !current && !loading && !error && (
        <Modal
          title={t("Goal unavailable")}
          className="goal-dialog"
          onClose={() => onSelect()}
        >
          <p className="goal-dialog-text">
            {t(
              "This goal is no longer in personal memory. No data was changed.",
            )}
          </p>
        </Modal>
      )}
      {completed && (
        <Modal
          title={t("Completed goals")}
          className="goal-dialog goal-completed-dialog"
          onClose={() => setCompleted(false)}
        >
          {finished.length ? (
            <div className="goal-completed-groups">
              {completedGoalGroups(finished).map((group) => (
                <section key={group.key} aria-label={group.label}>
                  <h3>{group.label}</h3>
                  {group.goals.map((goal) => (
                    <CompletedGoalRow
                      key={goal.id}
                      goal={goal}
                      busy={busy}
                      handlers={handlers}
                    />
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <p className="goal-completed-empty">
              {t("No completed goals yet.")}
            </p>
          )}
        </Modal>
      )}
      {rename && (
        <RenameGoal
          client={client}
          initial={rename}
          onClose={() => setRename(undefined)}
          onEditorChange={onEditorChange}
          onSaved={async () => {
            setData(await service.snapshot());
          }}
        />
      )}
      {deleting && (
        <Modal
          title={t("Delete this goal?")}
          className="goal-dialog goal-delete-dialog"
          onClose={() => {
            if (!busy) setDeleting(undefined);
          }}
        >
          <p className="goal-dialog-text">
            {t(
              deleting.count > 2
                ? "“{title}” and its {count} subgoals will be removed from personal memory. This cannot be undone here. Conversation history is preserved."
                : deleting.count === 2
                  ? "“{title}” and its {count} subgoal will be removed from personal memory. This cannot be undone here. Conversation history is preserved."
                  : "“{title}” will be removed from personal memory. This cannot be undone here. Conversation history is preserved.",
              { title: deleting.goal.title, count: deleting.count - 1 },
            )}
          </p>
          {alert}
          <div className="goal-dialog-actions">
            <button
              className="goal-button"
              disabled={busy}
              onClick={() => setDeleting(undefined)}
            >
              {t("Cancel")}
            </button>
            <button
              className="goal-button destructive"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await service.remove(deleting.goal.id, deleting.revision);
                  setDeleting(undefined);
                  if (
                    selectedId &&
                    goalDescendants(goals, deleting.goal.id).has(selectedId)
                  )
                    onSelect();
                })
              }
            >
              {busy ? t("Deleting…") : t("Delete")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
