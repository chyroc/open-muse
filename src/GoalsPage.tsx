import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  Check,
  ChevronRight,
  Circle,
  DollarSign,
  Heart,
  Laptop,
  LoaderCircle,
  MessageCircle,
  Palette,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { goalCategories, type GoalCategory } from "../shared/goals";
import type { Goal } from "../shared/types";
import type { Client } from "./api";
import { Markdown } from "./components";
import { PageHeader, Sheet } from "./MusePages";
import "./goals.css";

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
    <section className="goal-create-section" aria-label="Create a goal">
      <h2>
        <Plus size={25} strokeWidth={1.6} />
        Create a goal
      </h2>
      <p>
        Choose a category and tell me what you want to achieve. We’ll build a
        personal plan and refine it as you go.
      </p>
      <div className="goal-categories">
        {goalCategories.map((category) => {
          const Icon = icons[category.id];
          return (
            <button
              key={category.id}
              onClick={() => onChoose(category.id)}
              aria-label={`Create a ${category.topic || "new"} goal`}
            >
              <Icon size={25} strokeWidth={1.7} />
              <span>{category.label}</span>
              <Plus size={23} strokeWidth={1.6} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function GoalRow({
  goal,
  subtitle,
  onOpen,
}: {
  goal: Goal;
  subtitle: boolean;
  onOpen: () => void;
}) {
  const Icon = icons[goal.category ?? "custom"];
  return (
    <button
      className="tracked-goal-row"
      aria-label={`Open goal: ${goal.title}`}
      onClick={onOpen}
    >
      {goal.status === "completed" ? (
        <Check size={24} />
      ) : (
        <Icon size={24} strokeWidth={1.7} />
      )}
      <span>
        <strong>{goal.title}</strong>
        {subtitle && (
          <small>
            {goal.status === "paused"
              ? "Paused"
              : goal.description || "Open your plan"}
          </small>
        )}
      </span>
      <ChevronRight size={18} />
    </button>
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
  const renameRevision = useRef("");
  const alive = useRef(true),
    lock = useRef(false),
    reading = useRef(false);
  const current = goals.find((goal) => goal.id === selected);
  const reload = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const value = await client.goals();
      if (alive.current) {
        setGoals(value.data);
        setRevision(value.revision);
        setError("");
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      reading.current = false;
      if (alive.current) setLoading(false);
    }
  }, [client]);
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
  const errors = error ? (
    <div className="inline-error" role="alert">
      <p>{error}</p>
      <button disabled={busy} onClick={() => void reload()}>
        Refresh goals
      </button>
    </div>
  ) : null;
  return (
    <section className="muse-page goals-page">
      <PageHeader title="Goals" />
      <section className="goal-tracking" aria-label="Tracking">
        <h2>Tracking</h2>
        {loading ? (
          <p className="goal-loading" role="status">
            <LoaderCircle size={20} className="spin" />
            Loading goals…
          </p>
        ) : error && !goals.length ? null : activeGoals.length ? (
          <div>
            {activeGoals
              .filter(
                (goal) =>
                  !goal.parent_id ||
                  !activeGoals.some((parent) => parent.id === goal.parent_id),
              )
              .map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  subtitle={subtitles}
                  onOpen={() => show(goal)}
                />
              ))}
          </div>
        ) : (
          <p>Nothing is being tracked yet</p>
        )}
        {!current && errors}
      </section>
      <GoalCategories onChoose={setCategory} />
      {category && (
        <Sheet
          title={`Create ${category === "custom" ? "a goal" : `a ${goalCategories.find((item) => item.id === category)!.topic} goal`}`}
          onClose={() => setCategory(undefined)}
        >
          <div className="goal-chat-intro">
            <MessageCircle size={35} strokeWidth={1.4} />
            <p>
              First, we’ll work out your goal together in chat. I’ll ask a few
              questions to understand what you’re after.
            </p>
            <p>
              Once you agree on a plan, it appears here so we can keep track of
              your progress.
            </p>
            {client.signedIn() ? (
              <button
                className="goal-continue"
                onClick={() => {
                  onCategory(category);
                  setCategory(undefined);
                }}
              >
                Continue in chat
              </button>
            ) : (
              <a className="goal-continue" href="#/settings">
                Connect to start a goal
              </a>
            )}
            <small>
              Opening chat prepares a draft. Nothing is sent until you press
              Send.
            </small>
          </div>
        </Sheet>
      )}
      {optionsOpen && (
        <Sheet title="Goals options" onClose={onOptionsClose}>
          <div className="chat-action-list">
            <button
              onClick={() => {
                onOptionsClose();
                setCompleted(true);
              }}
            >
              Completed goals
              <ChevronRight size={19} />
            </button>
            <button
              onClick={() => {
                setSubtitles(!subtitles);
                onOptionsClose();
              }}
            >
              {subtitles ? "Hide subtitles" : "Show subtitles"}
            </button>
            <button
              onClick={() => {
                onOptionsClose();
                void reload();
              }}
            >
              <RefreshCw size={20} />
              Refresh goals
            </button>
          </div>
        </Sheet>
      )}
      {completed && !current && (
        <Sheet title="Completed goals" onClose={() => setCompleted(false)}>
          <div className="completed-goals">
            {goals.some((goal) => goal.status === "completed") ? (
              goals
                .filter((goal) => goal.status === "completed")
                .map((goal) => (
                  <GoalRow
                    key={goal.id}
                    goal={goal}
                    subtitle={subtitles}
                    onOpen={() => show(goal)}
                  />
                ))
            ) : (
              <p>No completed goals yet.</p>
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
                ? "Completed"
                : current.status === "paused"
                  ? "Paused"
                  : "Active"}
            </span>
            {current.description && <Markdown text={current.description} />}
            {current.steps.length > 0 && (
              <section className="goal-plan" aria-label="Plan steps">
                <h3>Plan</h3>
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
              <h3>Subgoals</h3>
              {goals
                .filter((goal) => goal.parent_id === current.id)
                .map((goal) => (
                  <GoalRow
                    key={goal.id}
                    goal={goal}
                    subtitle={subtitles}
                    onOpen={() => show(goal)}
                  />
                ))}
              {!goals.some((goal) => goal.parent_id === current.id) && (
                <p>No subgoals yet.</p>
              )}
              <button
                disabled={busy}
                onClick={() => {
                  onCategory(current.category ?? "custom", current);
                  setSelected(undefined);
                }}
              >
                <Plus size={19} />
                Add a subgoal
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
              Talk about this goal
            </button>
            <button
              className="goal-detail-action"
              disabled={busy}
              onClick={() => {
                renameRevision.current = revision;
                setRename(current.title);
              }}
            >
              Rename goal
            </button>
            {rename !== undefined && (
              <Sheet
                title="Rename goal"
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
                    Goal name
                    <input
                      aria-label="Goal name"
                      value={rename}
                      maxLength={160}
                      disabled={busy}
                      onChange={(event) => setRename(event.target.value)}
                    />
                  </label>
                  {errors}
                  <button disabled={busy || !rename.trim()}>Save name</button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRename(undefined)}
                  >
                    Cancel
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
                ? "Saving…"
                : current.status === "completed"
                  ? "Mark as active"
                  : "Mark as completed"}
            </button>
            {current.status === "paused" && (
              <button
                className="goal-detail-action"
                disabled={busy}
                onClick={() => void update(current, { status: "active" })}
              >
                Resume goal
              </button>
            )}
            <p className="goal-sync-note">
              Plans and reported progress are saved in personal MA memory.
              Changes do not stop running tools or create scheduled check-ins.
            </p>
          </div>
        </Sheet>
      )}
    </section>
  );
}
