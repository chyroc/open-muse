import { formatLocale, t } from "../../shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouteHeader } from "./routeHeader";
import {
  BriefcaseBusiness,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  DollarSign,
  Heart,
  Laptop,
  MessageCircle,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  Users,
  WandSparkles,
  PanelRight,
} from "lucide-react";
import type { Client } from "../../src/api";
import type { Goal } from "../../shared/types";
import { goalCategories, type GoalCategory } from "../../shared/goals";
import { Markdown } from "../../src/components";
import { Modal } from "./Chrome";
import {
  MacGoals,
  goalActivityLabel,
  goalDescendants,
  macGoalStarter,
  type MacGoalsSnapshot,
} from "./goals";

const categoryIcons = {
  health: Heart,
  relationships: Users,
  finance: DollarSign,
  career: BriefcaseBusiness,
  interests: Palette,
  productivity: Laptop,
  custom: CheckSquare,
};
function GoalMenu({
  goal,
  busy,
  canAdd,
  onComplete,
  onAdd,
  onRename,
  onDelete,
}: {
  goal: Goal;
  busy: boolean;
  canAdd: boolean;
  onComplete: () => void;
  onAdd: () => void;
  onRename: () => void;
  onDelete: () => void;
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
    <details className="goal-options" ref={menu}>
      <summary aria-label={t("Options for {title}", { title: goal.title })}>
        <MoreHorizontal size={18} />
      </summary>
      <div className="goal-menu">
        <button disabled={busy} onClick={() => choose(onComplete)}>
          <CheckSquare size={16} />
          {goal.status === "completed"
            ? t("Mark as not complete")
            : t("Complete")}
        </button>
        {canAdd && (
          <button disabled={busy} onClick={() => choose(onAdd)}>
            <Plus size={16} />
            {t("Add subgoal")}
          </button>
        )}
        <button disabled={busy} onClick={() => choose(onRename)}>
          <Pencil size={16} />
          {t("Rename")}
        </button>
        <hr />
        <button
          disabled={busy}
          className="danger"
          onClick={() => choose(onDelete)}
        >
          <Trash2 size={16} />
          {t("Delete")}
        </button>
      </div>
    </details>
  );
}

function GoalRow({
  goal,
  all,
  subtitles,
  busy,
  depth = 0,
  onSelect,
  onComplete,
  onAdd,
  onRename,
  onDelete,
}: {
  goal: Goal;
  all: Goal[];
  subtitles: boolean;
  busy: boolean;
  depth?: number;
  onSelect: (goal: Goal) => void;
  onComplete: (goal: Goal) => void;
  onAdd: (goal: Goal) => void;
  onRename: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = all.filter(
    (item) => item.parent_id === goal.id && item.status !== "completed",
  );
  const complete = goal.status === "completed";
  return (
    <div className="desktop-goal-tree">
      <div
        className={`desktop-goal-row ${complete ? "completed" : ""}`}
        style={{ marginLeft: depth * 32 }}
      >
        {children.length > 0 && !complete && (
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
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        )}
        <button
          className="goal-check"
          role="checkbox"
          aria-label={t(
            complete ? "Mark {title} not complete" : "Mark {title} complete",
            { title: goal.title },
          )}
          aria-checked={complete}
          disabled={busy}
          onClick={() => onComplete(goal)}
        >
          {complete ? <CheckSquare size={24} /> : <Square size={24} />}
        </button>
        <button
          className="goal-row-open"
          aria-label={t("Open goal: {title}", { title: goal.title })}
          onClick={() => onSelect(goal)}
        >
          <strong>{goal.title}</strong>
          {subtitles && (goal.description || goal.status === "paused") && (
            <span>
              {goal.status === "paused" ? t("Paused") : goal.description}
            </span>
          )}
        </button>
        <GoalMenu
          goal={goal}
          busy={busy}
          canAdd={depth === 0 && !goal.parent_id}
          onComplete={() => onComplete(goal)}
          onAdd={() => onAdd(goal)}
          onRename={() => onRename(goal)}
          onDelete={() => onDelete(goal)}
        />
      </div>
      {expanded &&
        !complete &&
        children.map((child) => (
          <GoalRow
            key={child.id}
            goal={child}
            all={all}
            subtitles={subtitles}
            busy={busy}
            depth={depth + 1}
            onSelect={onSelect}
            onComplete={onComplete}
            onAdd={onAdd}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
    </div>
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
      className="goal-rename-dialog"
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
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        {error && (
          <div className="feed-error" role="alert">
            {error}
            <button type="button" disabled={busy} onClick={() => void review()}>
              {t("Review cloud version")}
            </button>
          </div>
        )}
        {remote && (
          <aside className="feed-cloud-copy">
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
        <footer>
          <button
            type="button"
            className="pill-button"
            disabled={busy}
            onClick={close}
          >
            {t("Cancel")}
          </button>
          <button
            className="goal-primary"
            disabled={busy || !dirty || !draft.trim()}
          >
            {busy ? t("Saving…") : t("Save")}
          </button>
        </footer>
      </form>
      {confirm && (
        <Modal
          title={t("Discard name changes?")}
          onClose={() => setConfirm(false)}
        >
          <p>{t("The goal name has unsaved changes.")}</p>
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
  const [shown, setShown] = useState(8);
  const lock = useRef(false),
    alive = useRef(true),
    reading = useRef(false),
    sequence = useRef(0);
  const menu = useRef<HTMLDetailsElement>(null);
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
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current) menu.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, []);
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
  const current = goals.find((goal) => goal.id === selectedId);
  const activeGoals = goals.filter((goal) => goal.status !== "completed");
  const roots = activeGoals.filter(
    (goal) => !activeGoals.some((parent) => parent.id === goal.parent_id),
  );
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
  const requestRename = (goal: Goal) =>
    setRename({ goal, revision: data!.revision });
  const requestDelete = (goal: Goal) =>
    setDeleting({
      goal,
      revision: data!.revision,
      count: goalDescendants(goals, goal.id).size,
    });
  const row = (goal: Goal) => (
    <GoalRow
      key={goal.id}
      goal={goal}
      all={goals}
      subtitles={data?.subtitles ?? true}
      busy={busy}
      onSelect={(goal) => {
        setCompleted(false);
        onSelect(goal.id);
      }}
      onComplete={complete}
      onAdd={addSubgoal}
      onRename={requestRename}
      onDelete={requestDelete}
    />
  );
  const errors = error ? (
    <div className="feed-error" role="alert">
      {error}
      <button disabled={busy} onClick={() => void refresh()}>
        {t("Refresh goals")}
      </button>
    </div>
  ) : null;
  const chooseMenu = (fn: () => void) => {
    if (menu.current) menu.current.open = false;
    fn();
  };
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
        <PanelRight size={22} />
      </button>
      <div className="goals-column">
        <header className="goals-heading route-heading">
          <h1>{t("Goals")}</h1>
          {goals.length > 0 && (
            <details className="goals-header-options" ref={menu}>
              <summary aria-label={t("Goals options")}>
                <MoreHorizontal size={20} />
              </summary>
              <div className="goal-menu">
                <p>{t("Subtitles")}</p>
                <button
                  role="menuitemradio"
                  aria-checked={data?.subtitles ?? true}
                  disabled={busy}
                  onClick={() =>
                    chooseMenu(() => void action(() => service.subtitles(true)))
                  }
                >
                  <Check
                    size={16}
                    style={{
                      visibility: data?.subtitles ? "visible" : "hidden",
                    }}
                  />
                  {t("Show")}
                </button>
                <button
                  role="menuitemradio"
                  aria-checked={!data?.subtitles}
                  disabled={busy}
                  onClick={() =>
                    chooseMenu(
                      () => void action(() => service.subtitles(false)),
                    )
                  }
                >
                  <Check
                    size={16}
                    style={{
                      visibility: data?.subtitles ? "hidden" : "visible",
                    }}
                  />
                  {t("Hide")}
                </button>
                <hr />
                <button onClick={() => chooseMenu(() => setCompleted(true))}>
                  <CheckSquare size={16} />
                  {t("View completed goals")}
                </button>
              </div>
            </details>
          )}
        </header>
        {!roots.length && !loading && !error && (
          <p className="goals-description route-description">
            {t(
              "Pick a category and tell me what you're after, and I'll build a personalized plan that evolves with you.",
            )}
          </p>
        )}
        {errors}
        {loading && (
          <p className="feed-status" role="status">
            {t("Loading goals…")}
          </p>
        )}
        {roots.length > 0 && (
          <section className="goals-list" aria-label={t("Personal goals")}>
            <h2>
              <span className="goals-dot" />
              {t("Goals")}
            </h2>
            {roots.slice(0, shown).map(row)}
            {roots.length > shown && (
              <button
                className="goals-show-more"
                onClick={() => setShown((value) => value + 8)}
              >
                {t("Show {count} more", {
                  count: Math.min(8, roots.length - shown),
                })}
                <ChevronDown size={18} />
              </button>
            )}
          </section>
        )}
        <section className="goals-create" aria-label={t("Create a goal")}>
          <h2>{t("Create a goal")}</h2>
          <div role="group" aria-label={t("Goal categories")}>
            {goalCategories.map((category) => {
              const Icon = categoryIcons[category.id];
              return (
                <button
                  className="goal-category"
                  key={category.id}
                  disabled={busy}
                  onClick={() => setCategory(category.id)}
                >
                  <Icon size={24} strokeWidth={1.7} />
                  <span>{t(category.label)}</span>
                  <ChevronRight size={20} strokeWidth={1.5} />
                </button>
              );
            })}
          </div>
        </section>
        {pending && (
          <aside className="goal-pending" role="status">
            <p>
              {pending.phase === "creating" || pending.phase === "sending"
                ? t("Checking goal submission…")
                : t("Goal conversation ready to continue")}
            </p>
            {pending.error && <p>{pending.error}</p>}
            {["preparing", "ready"].includes(pending.phase) && (
              <button
                className="pill-button"
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
                className="feed-text-button"
                onClick={() => onOpenChat(pending.session!)}
              >
                {t("View goal conversation")}
              </button>
            )}
          </aside>
        )}
        <footer className="goals-footer">
          <button
            className="icon-button"
            aria-label={t("Refresh goals")}
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} />
          </button>
          <span>
            {t(
              "Plans and progress are stored in personal MA memory. Automatic monitoring is not connected to this goal workflow yet.",
            )}
          </span>
        </footer>
      </div>
      {category && (
        <Modal
          title={t(
            `Create ${category === "custom" ? "a new" : `${category === "interests" ? "an" : "a"} ${category}`} goal`,
          )}
          className="goal-intro-dialog"
          onClose={() => {
            if (!busy) setCategory(undefined);
          }}
        >
          <p>
            {t(
              "First, we'll refine the goal together in chat. I'll ask you a few questions to clarify what you're after. Once it's set, I'll track your progress here.",
            )}
          </p>
          {errors}
          <button
            className="goal-primary"
            disabled={busy}
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
            <WandSparkles size={18} />
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
              onComplete={() => complete(current)}
              onAdd={() => addSubgoal(current)}
              onRename={() => requestRename(current)}
              onDelete={() => requestDelete(current)}
            />
          </div>
          {current.parent_id && (
            <button
              className="goal-parent"
              onClick={() => onSelect(current.parent_id)}
            >
              <ChevronRight size={16} />
              {goals.find((goal) => goal.id === current.parent_id)?.title ??
                t("Parent goal")}
            </button>
          )}
          <span className={`goal-state ${current.status}`}>
            {current.status === "completed"
              ? t("Completed")
              : current.status === "paused"
                ? t("Paused")
                : t("Active")}
          </span>
          {current.description && <Markdown text={current.description} />}
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
          {errors}
          <section
            className="goal-timeline"
            aria-label={t("Goal activity timeline")}
          >
            <h3>{t("Activity")}</h3>
            {data?.activity[current.id]?.length ? (
              <ul>
                {[...data.activity[current.id]].reverse().map((activity) => (
                  <li key={activity.id}>
                    <CircleCheck size={18} />
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
            ) : (
              <p>{t("No activity yet.")}</p>
            )}
          </section>
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
            <MessageCircle size={18} />
            {t("Talk about this goal")}
          </button>
          <p className="goal-sync-note">
            {t(
              "Completing or deleting a plan does not stop running tools or erase conversation history.",
            )}
          </p>
        </Modal>
      )}
      {selectedId && !current && !loading && !error && (
        <Modal title={t("Goal unavailable")} onClose={() => onSelect()}>
          <p>
            {t(
              "This goal is no longer in personal memory. No data was changed.",
            )}
          </p>
        </Modal>
      )}
      {completed && (
        <Modal
          title={t("Completed goals")}
          className="goal-completed-dialog"
          onClose={() => setCompleted(false)}
        >
          {goals.some((goal) => goal.status === "completed") ? (
            goals.filter((goal) => goal.status === "completed").map(row)
          ) : (
            <p>{t("No completed goals yet.")}</p>
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
          className="goal-delete-dialog"
          onClose={() => {
            if (!busy) setDeleting(undefined);
          }}
        >
          <p>
            {t(
              deleting.count > 2
                ? "“{title}” and its {count} subgoals will be removed from personal memory. This cannot be undone here. Conversation history is preserved."
                : deleting.count === 2
                  ? "“{title}” and its {count} subgoal will be removed from personal memory. This cannot be undone here. Conversation history is preserved."
                  : "“{title}” will be removed from personal memory. This cannot be undone here. Conversation history is preserved.",
              { title: deleting.goal.title, count: deleting.count - 1 },
            )}
          </p>
          {errors}
          <div className="feed-dialog-actions">
            <button
              className="pill-button"
              disabled={busy}
              onClick={() => setDeleting(undefined)}
            >
              {t("Cancel")}
            </button>
            <button
              className="pill-button danger"
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
              {busy ? t("Deleting…") : t("Delete goal")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
