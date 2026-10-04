import { systemLanguage, t } from "../shared/i18n";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  CircleDot,
  Building2,
  ChevronRight,
  Circle,
  DollarSign,
  EllipsisVertical,
  Heart,
  Laptop,
  LoaderCircle,
  MessageCircle,
  Palette,
  Pencil,
  Plus,
  SquareCheck,
  SquarePlus,
  Users,
} from "lucide-react";
import { goalCategories, type GoalCategory } from "../shared/goals";
import { isTransientFailure } from "../shared/network-error";
import type { Goal } from "../shared/types";
import type { Client } from "./api";
import { Markdown } from "./components";
import { PageHeader, Sheet } from "./MusePages";
import { useRefreshHandler } from "./PullToRefresh";
import { PopoverMenu } from "./PopoverMenu";
import "./goals.css";

// In Chinese, career goals are named 事业 here. The shared catalog
// keeps the desktop wording, and English reads the shared source string.
const careerInChinese = (id: GoalCategory) =>
  id === "career" && systemLanguage() === "zh-CN";
function categoryLabel(id: GoalCategory) {
  if (careerInChinese(id)) return t("Career, as a goal category");
  return t(goalCategories.find((item) => item.id === id)!.label);
}
function categoryTopic(id: GoalCategory) {
  if (careerInChinese(id)) return t("career, as a goal topic");
  return t(goalCategories.find((item) => item.id === id)!.topic);
}

const icons = {
  health: Heart,
  relationships: Users,
  finance: DollarSign,
  career: Building2,
  interests: Palette,
  productivity: Laptop,
  custom: Circle,
};

export function GoalCategories({
  onChoose,
}: {
  onChoose: (category: GoalCategory) => void;
}) {
  return (
    <section className="goal-create-section" aria-label={t("Create a goal")}>
      <h2>
        <Plus size={24} strokeWidth={1.6} />
        {t("Create a goal")}
      </h2>
      <p>
        {t(
          "Choose a category and tell me what you want to achieve. I’ll tailor a plan for you and keep improving it as you grow.",
        )}
      </p>
      <div className="goal-categories">
        {goalCategories.map((category) => {
          const Icon = icons[category.id];
          return (
            <button
              key={category.id}
              onClick={() => onChoose(category.id)}
              aria-label={
                careerInChinese(category.id)
                  ? t("Create a {category} goal", {
                      category: categoryTopic(category.id),
                    })
                  : t(`Create a ${category.topic || "new"} goal`)
              }
            >
              <Icon size={24} strokeWidth={1.7} />
              <span>{categoryLabel(category.id)}</span>
              <Plus size={20} strokeWidth={1.6} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// A rounded square that fills with the accent and a checkmark once done.
function GoalCheck({ done }: { done: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      {done ? (
        <>
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="4.5"
            fill="currentColor"
          />
          <path
            d="m8 12.2 2.7 2.7L16.2 9.3"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <rect
          x="2.75"
          y="2.75"
          width="18.5"
          height="18.5"
          rx="4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}

// A goal as a checklist row: the check box completes it, the text opens the
// plan, and the trailing button offers the row's options.
export function GoalRow({
  goal,
  subtitle,
  onOpen,
  onToggle,
  onMore,
  busy = false,
}: {
  goal: Goal;
  subtitle: boolean;
  onOpen: () => void;
  onToggle?: () => void;
  onMore?: (button: HTMLButtonElement) => void;
  busy?: boolean;
}) {
  const done = goal.status === "completed";
  const detail =
    goal.status === "paused" ? t("Paused") : goal.description.trim();
  return (
    <div className={`tracked-goal-row${done ? " done" : ""}`}>
      <button
        className="goal-check"
        role="checkbox"
        aria-checked={done}
        aria-label={t(
          done ? "Mark {title} not complete" : "Mark {title} complete",
          {
            title: goal.title,
          },
        )}
        disabled={busy || !onToggle}
        onClick={onToggle}
      >
        <GoalCheck done={done} />
      </button>
      <button
        className="goal-row-open"
        aria-label={t("Open goal: {title}", { title: goal.title })}
        onClick={onOpen}
      >
        <strong>{goal.title}</strong>
        {subtitle && detail && <small>{detail}</small>}
      </button>
      {onMore && (
        <button
          className="goal-row-more"
          aria-label={t("Goal options")}
          aria-haspopup="menu"
          disabled={busy}
          onClick={(event) => onMore(event.currentTarget)}
        >
          <EllipsisVertical size={20} />
        </button>
      )}
    </div>
  );
}

// The pulsing marker beside a goal section's title.
function GoalPulse() {
  return (
    <span className="goal-pulse" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export function GoalsPage({
  client,
  onStart,
  onCategory,
  optionsOpen,
  onOptionsClose,
}: {
  client: Client;
  onStart: (goal: Goal) => void;
  onCategory: (category: GoalCategory, parent?: Goal) => void;
  optionsOpen: boolean;
  onOptionsClose: () => void;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [revision, setRevision] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<GoalCategory>();
  const [selected, setSelected] = useState<string>();
  const [completed, setCompleted] = useState(false);
  const [subtitles, setSubtitles] = useState(true);
  const [rename, setRename] = useState<string>();
  const [rowMenu, setRowMenu] = useState<{
    goal: Goal;
    placement: CSSProperties;
  }>();
  const renameRevision = useRef("");
  const alive = useRef(true),
    lock = useRef(false),
    reading = useRef(false);
  const current = goals.find((goal) => goal.id === selected);
  const reload = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    // A connection failure is read again quietly on the next refresh; until
    // the first read, the page keeps loading rather than showing as empty.
    let quiet = false;
    try {
      const value = await client.goals();
      if (alive.current) {
        setGoals(value.data);
        setRevision(value.revision);
        setError("");
      }
    } catch (e) {
      quiet = isTransientFailure(e);
      if (alive.current && !quiet) setError((e as Error).message);
    } finally {
      reading.current = false;
      if (alive.current && !quiet) setLoading(false);
    }
  }, [client]);
  useRefreshHandler(reload);
  useEffect(() => {
    alive.current = true;
    void reload();
    const refresh = () => {
      if (!document.hidden) void reload();
    };
    document.addEventListener("visibilitychange", refresh);
    // Reads surface agent-authored plan changes; this is not background execution.
    const timer = setInterval(refresh, 15000);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);
  async function update(
    goal: Goal,
    patch: Parameters<Client["updateGoal"]>[1],
    expectedRevision = revision,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await client.updateGoal(goal.id, patch, expectedRevision);
      if (alive.current) {
        setRename(undefined);
        await reload();
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const activeGoals = goals.filter((goal) => goal.status !== "completed");
  const show = (goal: Goal) => {
    setSelected(goal.id);
    setRename(undefined);
    setError("");
  };
  const toggle = (goal: Goal) =>
    void update(goal, {
      status: goal.status === "completed" ? "active" : "completed",
    });
  // The row menu grows out of its button, downward unless the row sits low.
  const openRowMenu = (goal: Goal, button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    const right = window.innerWidth - rect.right;
    const below = rect.bottom + 4 + 220 < window.innerHeight;
    setRowMenu({
      goal,
      placement: below
        ? { top: rect.bottom + 4, right, transformOrigin: "100% 0" }
        : {
            top: "auto",
            bottom: window.innerHeight - rect.top + 4,
            right,
            transformOrigin: "100% 100%",
          },
    });
  };
  const row = (goal: Goal) => (
    <GoalRow
      key={goal.id}
      goal={goal}
      subtitle={subtitles}
      busy={busy}
      onOpen={() => show(goal)}
      onToggle={() => toggle(goal)}
      onMore={(button) => openRowMenu(goal, button)}
    />
  );
  const errors = error ? (
    <div className="inline-error" role="alert">
      <p>{error}</p>
      <button disabled={busy} onClick={() => void reload()}>
        {t("Refresh goals")}
      </button>
    </div>
  ) : null;
  return (
    <section className="muse-page goals-page">
      <PageHeader title={t("Goals")} />
      <section className="goal-tracking" aria-label={t("Tracking")}>
        <h2>
          <GoalPulse />
          {t("Tracking")}
        </h2>
        {loading ? (
          <p className="goal-loading" role="status">
            <LoaderCircle size={20} className="spin" />
            {t("Loading goals…")}
          </p>
        ) : error && !goals.length ? null : activeGoals.length ? (
          <div>
            {activeGoals
              .filter(
                (goal) =>
                  !goal.parent_id ||
                  !activeGoals.some((parent) => parent.id === goal.parent_id),
              )
              .map(row)}
          </div>
        ) : (
          <p>{t("Nothing is being tracked yet")}</p>
        )}
        {!current && errors}
      </section>
      <GoalCategories onChoose={setCategory} />
      {category && (
        <Sheet
          title={
            category === "custom"
              ? t("Create a goal")
              : t("Create a {category} goal", {
                  category: categoryTopic(category),
                })
          }
          onClose={() => setCategory(undefined)}
        >
          <div className="goal-chat-intro">
            <MessageCircle size={35} strokeWidth={1.4} />
            <p>
              {t(
                "First, we’ll work out your goal together in chat. I’ll ask a few questions to understand what you’re after.",
              )}
            </p>
            <p>
              {t(
                "Once you agree on a plan, it appears here so we can keep track of your progress.",
              )}
            </p>
            {client.signedIn() ? (
              <button
                className="goal-continue"
                onClick={() => {
                  onCategory(category);
                  setCategory(undefined);
                }}
              >
                {t("Continue in chat")}
              </button>
            ) : (
              <a className="goal-continue" href="#/settings">
                {t("Connect to start a goal")}
              </a>
            )}
            <small>
              {t(
                "Opening chat prepares a draft. Nothing is sent until you press Send.",
              )}
            </small>
          </div>
        </Sheet>
      )}
      {optionsOpen && (
        <PopoverMenu
          label={t("Goals options")}
          onClose={onOptionsClose}
          items={[
            {
              kind: "item",
              label: t("Show subtitles"),
              checked: subtitles,
              onSelect: () => setSubtitles(true),
            },
            {
              kind: "item",
              label: t("Hide subtitles"),
              checked: !subtitles,
              onSelect: () => setSubtitles(false),
            },
            { kind: "separator" },
            {
              kind: "item",
              label: t("Completed goals"),
              icon: <CircleDot size={21} aria-hidden="true" />,
              onSelect: () => setCompleted(true),
            },
          ]}
        />
      )}
      {rowMenu && (
        <PopoverMenu
          label={t("Goal options")}
          className="goal-row-menu"
          placement={rowMenu.placement}
          onClose={() => setRowMenu(undefined)}
          items={[
            {
              kind: "item",
              label: t(
                rowMenu.goal.status === "completed"
                  ? "Mark as not complete"
                  : "Mark as completed",
              ),
              icon: <SquareCheck size={21} aria-hidden="true" />,
              onSelect: () => toggle(rowMenu.goal),
            },
            ...(rowMenu.goal.parent_id
              ? []
              : [
                  {
                    kind: "item" as const,
                    label: t("Add a subgoal"),
                    icon: <SquarePlus size={21} aria-hidden="true" />,
                    onSelect: () =>
                      onCategory(
                        rowMenu.goal.category ?? "custom",
                        rowMenu.goal,
                      ),
                  },
                ]),
            {
              kind: "item",
              label: t("Rename goal"),
              icon: <Pencil size={21} aria-hidden="true" />,
              onSelect: () => {
                show(rowMenu.goal);
                renameRevision.current = revision;
                setRename(rowMenu.goal.title);
              },
            },
          ]}
        />
      )}
      {completed && !current && (
        <Sheet title={t("Completed goals")} onClose={() => setCompleted(false)}>
          <div className="completed-goals">
            {goals.some((goal) => goal.status === "completed") ? (
              goals.filter((goal) => goal.status === "completed").map(row)
            ) : (
              <p>{t("No completed goals yet.")}</p>
            )}
          </div>
        </Sheet>
      )}
      {current && (
        <Sheet
          title={current.title}
          onClose={() => {
            if (!busy) setSelected(undefined);
          }}
        >
          <div className="goal-detail">
            {current.parent_id && (
              <button
                className="goal-parent"
                onClick={() => {
                  const parent = goals.find(
                    (goal) => goal.id === current.parent_id,
                  );
                  if (parent) show(parent);
                }}
              >
                {goals.find((goal) => goal.id === current.parent_id)?.title}
                <ChevronRight size={16} />
              </button>
            )}
            <span className="goal-state">
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
                        void update(current, {
                          steps: current.steps.map((item) =>
                            item.id === step.id
                              ? { ...item, done: !item.done }
                              : item,
                          ),
                        })
                      }
                    />
                    <span className={step.done ? "done" : ""}>
                      {step.title}
                    </span>
                  </label>
                ))}
              </section>
            )}
            <section className="goal-subgoals">
              <h3>{t("Subgoals")}</h3>
              {goals.filter((goal) => goal.parent_id === current.id).map(row)}
              {!goals.some((goal) => goal.parent_id === current.id) && (
                <p>{t("No subgoals yet.")}</p>
              )}
              <button
                disabled={busy}
                onClick={() => {
                  onCategory(current.category ?? "custom", current);
                  setSelected(undefined);
                }}
              >
                <Plus size={19} />
                {t("Add a subgoal")}
              </button>
            </section>
            {errors}
            <button
              className="goal-continue"
              disabled={busy}
              onClick={() => {
                onStart(current);
                setSelected(undefined);
              }}
            >
              <MessageCircle size={20} />
              {t("Talk about this goal")}
            </button>
            <button
              className="goal-detail-action"
              disabled={busy}
              onClick={() => {
                renameRevision.current = revision;
                setRename(current.title);
              }}
            >
              {t("Rename goal")}
            </button>
            {rename !== undefined && (
              <Sheet
                title={t("Rename goal")}
                onClose={() => {
                  if (!busy) setRename(undefined);
                }}
              >
                <form
                  className="goal-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void update(
                      current,
                      { title: rename },
                      renameRevision.current,
                    );
                  }}
                >
                  <label>
                    {t("Goal name")}
                    <input
                      aria-label={t("Goal name")}
                      value={rename}
                      maxLength={160}
                      disabled={busy}
                      onChange={(event) => setRename(event.target.value)}
                    />
                  </label>
                  {errors}
                  <button disabled={busy || !rename.trim()}>
                    {t("Save name")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRename(undefined)}
                  >
                    {t("Cancel")}
                  </button>
                </form>
              </Sheet>
            )}
            <button
              className="goal-detail-action"
              disabled={busy}
              onClick={() =>
                void update(current, {
                  status:
                    current.status === "completed" ? "active" : "completed",
                })
              }
            >
              {busy
                ? t("Saving…")
                : current.status === "completed"
                  ? t("Mark as active")
                  : t("Mark as completed")}
            </button>
            {current.status === "paused" && (
              <button
                className="goal-detail-action"
                disabled={busy}
                onClick={() => void update(current, { status: "active" })}
              >
                {t("Resume goal")}
              </button>
            )}
            <p className="goal-sync-note">
              {t(
                "Plans and reported progress are saved in personal MA memory. Changes do not stop running tools or create scheduled check-ins.",
              )}
            </p>
          </div>
        </Sheet>
      )}
    </section>
  );
}
