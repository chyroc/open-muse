import { uuid } from "../shared/crypto";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  History,
  Lightbulb,
  LoaderCircle,
  Menu,
  MessageCircle,
  Pause,
  Plus,
  Search,
  Settings2,
  Shapes,
  Target,
  X,
  Blocks,
  Rss,
  PanelsTopLeft,
  SquareCheckBig,
} from "lucide-react";
import type { Client } from "./api";
import type { Goal, LibraryItem, Session } from "../shared/types";
import { categories, templates } from "./content";
import { CategoryIcon, dateLabel, Markdown } from "./components";
import { exportText } from "./platform";

export const primaryNavigation = [
  { id: "home", path: "/", label: "Chat", icon: MessageCircle },
  { id: "feed", path: "/feed", label: "Feed", icon: PanelsTopLeft },
  { id: "discover", path: "/discover", label: "Ideas", icon: Lightbulb },
  { id: "goals", path: "/goals", label: "Goals", icon: SquareCheckBig },
  { id: "library", path: "/library", label: "Library", icon: Shapes },
] as const;

export function goalPrompt(goal: Goal) {
  return [
    `Please help me plan and work toward this goal step by step: ${goal.title}`,
    goal.description,
    goal.steps.length
      ? `Existing steps (please preserve completion status):\n${goal.steps.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`).join("\n")}`
      : "",
    "First confirm the necessary information and provide actionable steps. When an action affects external systems, ask for approval first.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <dialog
      className="muse-sheet"
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-body">
        <div className="sheet-grip" aria-hidden="true" />
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function MoreMenu({
  sessions,
  onClose,
}: {
  sessions: Session[];
  onClose: () => void;
}) {
  return (
    <Sheet title="My Space" onClose={onClose}>
      <nav className="more-links" aria-label="More">
        <a href="#/tasks" onClick={onClose}>
          <History />
          All conversations
          <ChevronRight />
        </a>
        <a href="#/settings" onClick={onClose}>
          <Settings2 />
          Settings &amp; connections
          <ChevronRight />
        </a>
        <a href="#/studio" onClick={onClose}>
          <Blocks />
          MA Studio
          <ChevronRight />
        </a>
      </nav>
      <h3 className="list-caption">Recent conversations</h3>
      <div className="more-recents">
        {sessions.slice(0, 8).map((s) => (
          <a key={s.id} href={`#/task/${s.id}`} onClick={onClose}>
            <MessageCircle size={19} />
            <span>{s.title}</span>
          </a>
        ))}
      </div>
      {!sessions.length && (
        <p className="muted">No conversations yet. Start with a sentence.</p>
      )}
    </Sheet>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="muse-page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function ChatWelcome({
  composer,
  sessions,
  onTemplate,
  goal,
  onClearGoal,
}: {
  composer: ReactNode;
  sessions: Session[];
  onTemplate: (t: (typeof templates)[number]) => void;
  goal?: Goal;
  onClearGoal: () => void;
}) {
  return (
    <div className="chat-welcome">
      <div className="welcome-space">
        <span className="welcome-wordmark">muse</span>
        <h1>What&apos;s on your mind?</h1>
        <p>Tell Muse what you want to do.</p>
      </div>
      <div className="welcome-input">
        {goal && (
          <div className="goal-context">
            <Target size={16} />
            <span>{goal.title}</span>
            <button
              className="icon-button"
              aria-label="Unlink goal"
              onClick={onClearGoal}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="prompt-chips">
          {templates.slice(0, 3).map((t) => (
            <button key={t.id} onClick={() => onTemplate(t)}>
              <CategoryIcon category={t.category} size={17} />
              {categories[t.category]}
            </button>
          ))}
        </div>
        {composer}
        <div className="welcome-footer">
          <a href="#/tasks">
            <History size={15} />
            {sessions.length
              ? `View ${sessions.length} conversations`
              : "Conversation history"}
          </a>
          <span>AI-generated content may be inaccurate</span>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      Loading…
    </div>
  );
}
function Empty({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="muse-empty">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
function ErrorNotice({ error, retry }: { error: string; retry?: () => void }) {
  return error ? (
    <div className="inline-error" role="alert">
      {error}
      {retry && <button onClick={retry}>Retry</button>}
    </div>
  ) : null;
}

export function GoalsPage({
  client,
  onStart,
}: {
  client: Client;
  onStart: (goal: Goal) => void;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [step, setStep] = useState("");
  const [filter, setFilter] = useState<"active" | "completed">("active");
  const current = goals.find((g) => g.id === selected);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setGoals((await client.goals()).data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function action(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function update(
    goal: Goal,
    input: Parameters<Client["updateGoal"]>[1],
  ) {
    const updated = await client.updateGoal(goal.id, input);
    setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
  }
  const visible = goals.filter((g) =>
    filter === "completed"
      ? g.status === "completed"
      : g.status !== "completed",
  );
  return (
    <section className="muse-page">
      <PageHeader
        title="Goals"
        description="Get things done, one step at a time."
        action={
          <button
            className="icon-button filled"
            aria-label="New goal"
            onClick={() => {
              setCreate(true);
              setError("");
            }}
          >
            <Plus size={24} />
          </button>
        }
      />
      <div className="muse-filters" role="group" aria-label="Goal status">
        {(["active", "completed"] as const).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === "active" ? "In progress" : "Completed"}
            <span>
              {
                goals.filter((g) =>
                  f === "completed"
                    ? g.status === "completed"
                    : g.status !== "completed",
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      {!create && !current && (
        <ErrorNotice error={error} retry={() => void reload()} />
      )}
      {loading ? (
        <Loading />
      ) : error && !goals.length ? null : !visible.length ? (
        <Empty
          icon={<Target size={30} />}
          title={
            filter === "completed"
              ? "No completed goals yet"
              : "Give your ideas a direction"
          }
          description={
            filter === "completed"
              ? "Completed goals will be kept here."
              : "Add a goal and let Muse build a plan for you."
          }
        />
      ) : (
        <div className="goal-list">
          {visible.map((g) => (
            <button
              className="goal-card"
              key={g.id}
              onClick={() => {
                setSelected(g.id);
                setStep("");
              }}
            >
              <span className="goal-symbol">
                {g.status === "completed" ? <CheckCircle2 /> : <Target />}
              </span>
              <span>
                <strong>{g.title}</strong>
                <small>
                  {g.status === "paused"
                    ? "Paused"
                    : g.status === "completed"
                      ? "Completed"
                      : g.steps.length
                        ? `${g.steps.filter((s) => s.done).length} / ${g.steps.length} steps done`
                        : "Waiting for a plan"}
                </small>
                {g.steps.length > 0 && (
                  <progress
                    value={g.steps.filter((s) => s.done).length}
                    max={g.steps.length}
                    aria-label={`${g.title} progress`}
                  />
                )}
              </span>
              <ChevronRight size={19} />
            </button>
          ))}
        </div>
      )}
      <p className="page-note">
        Goals and steps are saved on this device for the current Ark connection.
        Execution starts from a conversation and never runs on an automatic
        schedule.
      </p>
      {create && (
        <Sheet
          title="New goal"
          onClose={() => {
            if (!busy) setCreate(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const goal = await client.createGoal(title, description);
                setGoals((prev) => [goal, ...prev]);
                setCreate(false);
                setSelected(goal.id);
                setTitle("");
                setDescription("");
              });
            }}
          >
            <label className="field">
              What do you want to accomplish?
              <input
                autoFocus
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Plan a weekend trip"
              />
            </label>
            <label className="field">
              Additional details
              <textarea
                value={description}
                maxLength={8000}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Timing, preferences, or parts you want Muse to handle"
                rows={3}
              />
            </label>
            <ErrorNotice error={error} />
            <button
              className="button primary wide"
              disabled={busy || !title.trim()}
            >
              {busy ? "Saving…" : "Create goal"}
            </button>
          </form>
        </Sheet>
      )}
      {current && (
        <Sheet
          title={current.title}
          onClose={() => {
            if (!busy) setSelected(undefined);
          }}
        >
          {current.description && (
            <p className="goal-description">{current.description}</p>
          )}
          <div className="goal-status">
            <Target size={16} />
            {current.status === "completed"
              ? "Completed"
              : current.status === "paused"
                ? "Paused"
                : "In progress"}
          </div>
          <h3 className="list-caption">Plan steps</h3>
          <div className="goal-steps">
            {current.steps.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={s.done}
                  disabled={busy}
                  onChange={() =>
                    void action(() =>
                      update(current, {
                        steps: current.steps.map((item) =>
                          item.id === s.id
                            ? { ...item, done: !item.done }
                            : item,
                        ),
                      }),
                    )
                  }
                />
                <span className={s.done ? "done" : ""}>{s.title}</span>
              </label>
            ))}
          </div>
          <form
            className="add-step"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await update(current, {
                  steps: [
                    ...current.steps,
                    {
                      id: uuid(),
                      title: step.trim(),
                      done: false,
                    },
                  ],
                });
                setStep("");
              });
            }}
          >
            <input
              aria-label="New step"
              value={step}
              maxLength={160}
              placeholder="Add a step"
              onChange={(e) => setStep(e.target.value)}
            />
            <button
              className="icon-button"
              aria-label="Add step"
              disabled={busy || !step.trim() || current.steps.length >= 40}
            >
              <Plus size={22} />
            </button>
          </form>
          <ErrorNotice error={error} />
          <button
            className="button primary wide"
            disabled={busy}
            onClick={() => {
              if (current.session_id)
                location.hash = `/task/${current.session_id}`;
              else onStart(current);
              setSelected(undefined);
            }}
          >
            <MessageCircle size={18} />
            {current.session_id
              ? "Resume goal conversation"
              : "Have Muse plan this for me"}
          </button>
          <div className="goal-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action(() =>
                  update(current, {
                    status:
                      current.status === "completed" ? "active" : "completed",
                  }),
                )
              }
            >
              <Check size={16} />
              {current.status === "completed" ? "Reopen" : "Mark as completed"}
            </button>
            {current.status !== "completed" && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    update(current, {
                      status: current.status === "paused" ? "active" : "paused",
                    }),
                  )
                }
              >
                <Pause size={16} />
                {current.status === "paused" ? "Resume goal" : "Pause goal"}
              </button>
            )}
          </div>
          <p className="page-note">
            Pausing or completing only updates the goal record. To stop a
            running task, open the conversation and do it there.
          </p>
        </Sheet>
      )}
    </section>
  );
}

export function LibraryPage({ client }: { client: Client }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LibraryItem>();
  const [exporting, setExporting] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await client.library()).data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const visible = items.filter((item) =>
    `${item.title}\n${item.text}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="muse-page">
      <PageHeader
        title="Library"
        description="Save useful replies and come back to them anytime."
      />
      <label className="library-search">
        <Search size={19} />
        <input
          aria-label="Search Library"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Library"
        />
      </label>
      <div className="library-section">
        <FileText size={18} />
        <strong>Saved replies</strong>
        <span>{items.length}</span>
      </div>
      <ErrorNotice error={error} retry={() => void reload()} />
      {loading ? (
        <Loading />
      ) : error && !items.length ? null : !visible.length ? (
        <Empty
          icon={<Shapes size={30} />}
          title={query ? "No matching items" : "Keep content worth saving"}
          description={
            query
              ? "Try other keywords."
              : "Tap Save on a conversation reply to keep it here."
          }
        />
      ) : (
        <div className="library-grid">
          {visible.map((item) => (
            <button
              className="library-card"
              key={item.id}
              onClick={() => setSelected(item)}
            >
              <div className="document-preview">
                <FileText size={22} />
                <p>{item.text.replace(/[#*>`]/g, "").slice(0, 220)}</p>
              </div>
              <strong>{item.title}</strong>
              <small>{dateLabel(item.created_at)}</small>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <Sheet title={selected.title} onClose={() => setSelected(undefined)}>
          <Markdown text={selected.text} />
          <div className="library-detail-actions">
            <a
              className="button secondary"
              href={`#/task/${selected.session_id}`}
              onClick={() => setSelected(undefined)}
            >
              View source conversation
              <ArrowRight size={16} />
            </a>
            <button
              className="icon-button"
              aria-label="Export item"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportText(`${selected.title}.md`, selected.text);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setExporting(false);
                }
              }}
            >
              <ArrowDownToLine size={21} />
            </button>
          </div>
          <ErrorNotice error={error} />
        </Sheet>
      )}
    </section>
  );
}
