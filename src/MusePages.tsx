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
} from "lucide-react";
import type { Client } from "./api";
import type { Goal, LibraryItem, Session } from "../shared/types";
import { categories, templates } from "./content";
import { CategoryIcon, dateLabel, Markdown } from "./components";
import { exportText } from "./platform";

export const primaryNavigation = [
  { id: "home", path: "/", label: "聊天", icon: MessageCircle },
  { id: "feed", path: "/feed", label: "动态", icon: Rss },
  { id: "discover", path: "/discover", label: "灵感", icon: Lightbulb },
  { id: "goals", path: "/goals", label: "目标", icon: Target },
  { id: "library", path: "/library", label: "资料库", icon: Shapes },
] as const;

export function goalPrompt(goal: Goal) {
  return [
    `请帮我制定并逐步推进这个目标：${goal.title}`,
    goal.description,
    goal.steps.length
      ? `已有步骤（请保留完成状态）：\n${goal.steps.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`).join("\n")}`
      : "",
    "请先确认必要的信息，给出可执行步骤；需要对外操作时先请求批准。",
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
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
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
    <Sheet title="我的空间" onClose={onClose}>
      <nav className="more-links" aria-label="更多功能">
        <a href="#/tasks" onClick={onClose}>
          <History />
          所有对话
          <ChevronRight />
        </a>
        <a href="#/settings" onClick={onClose}>
          <Settings2 />
          设置与连接
          <ChevronRight />
        </a>
        <a href="#/studio" onClick={onClose}>
          <Blocks />
          MA 工作台
          <ChevronRight />
        </a>
      </nav>
      <h3 className="list-caption">最近的对话</h3>
      <div className="more-recents">
        {sessions.slice(0, 8).map((s) => (
          <a key={s.id} href={`#/task/${s.id}`} onClick={onClose}>
            <MessageCircle size={19} />
            <span>{s.title}</span>
          </a>
        ))}
      </div>
      {!sessions.length && <p className="muted">还没有对话。从一句话开始。</p>}
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
        <h1>有什么新想法？</h1>
        <p>聊聊你想做的事。</p>
      </div>
      <div className="welcome-input">
        {goal && (
          <div className="goal-context">
            <Target size={16} />
            <span>{goal.title}</span>
            <button
              className="icon-button"
              aria-label="取消关联目标"
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
            {sessions.length ? `查看 ${sessions.length} 个对话` : "对话历史"}
          </a>
          <span>AI 生成的内容可能不准确</span>
        </div>
      </div>
    </div>
  );
}

export function IdeasPage({
  onTemplate,
}: {
  onTemplate: (t: (typeof templates)[number]) => void;
}) {
  return (
    <section className="muse-page">
      <PageHeader title="灵感" description="从一个想法开始。" />
      <p className="list-caption">起步建议</p>
      <div className="idea-list">
        {templates.map((t) => (
          <button className="idea-row" key={t.id} onClick={() => onTemplate(t)}>
            <span className={`idea-symbol ${t.category}`}>
              <CategoryIcon category={t.category} size={23} />
            </span>
            <span>
              <strong>{t.title}</strong>
              <small>{t.detail}</small>
            </span>
            <Plus size={20} />
          </button>
        ))}
      </div>
      <p className="page-note">
        这些是预设建议。选择后可以编辑，再交给 Muse 执行。
      </p>
    </section>
  );
}

export function FeedPage({
  sessions,
  loading,
}: {
  sessions: Session[];
  loading: boolean;
}) {
  return (
    <section className="muse-page">
      <PageHeader title="动态" description="对话的最新进展，都在这里。" />
      {loading ? (
        <Loading />
      ) : !sessions.length ? (
        <Empty
          icon={<Rss />}
          title="还没有新动态"
          description="开始对话后，这里会显示实际任务状态。"
        />
      ) : (
        <div className="feed-list">
          {sessions.map((s) => (
            <a className="feed-card" key={s.id} href={`#/task/${s.id}`}>
              <div className="feed-card-meta">
                <span>
                  <CategoryIcon category={s.category} size={18} />
                  {categories[s.category]}
                </span>
                <time>{dateLabel(s.updated_at)}</time>
              </div>
              <h2>{s.title}</h2>
              <p>{s.preview || "打开对话，查看回复与工具执行记录。"}</p>
              <footer>
                <span
                  className={s.status === "running" ? "status-running" : ""}
                >
                  {s.status === "running" || s.status === "rescheduling"
                    ? "正在处理"
                    : s.status === "terminated"
                      ? "已停止"
                      : "查看对话"}
                </span>
                <ArrowRight size={19} />
              </footer>
            </a>
          ))}
        </div>
      )}
      <p className="page-note">
        显示当前空间的会话状态；尚未提供定时推送或主动推荐。
      </p>
    </section>
  );
}

function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      正在加载…
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
      {retry && <button onClick={retry}>重试</button>}
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
        title="目标"
        description="把想做的事，一步步完成。"
        action={
          <button
            className="icon-button filled"
            aria-label="新建目标"
            onClick={() => {
              setCreate(true);
              setError("");
            }}
          >
            <Plus size={24} />
          </button>
        }
      />
      <div className="muse-filters" role="group" aria-label="目标状态">
        {(["active", "completed"] as const).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === "active" ? "进行中" : "已完成"}
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
            filter === "completed" ? "还没有已完成的目标" : "让想法有个方向"
          }
          description={
            filter === "completed"
              ? "完成的目标会保留在这里。"
              : "添加一个目标，让 Muse 帮你制定计划。"
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
                    ? "已暂停"
                    : g.status === "completed"
                      ? "已完成"
                      : g.steps.length
                        ? `${g.steps.filter((s) => s.done).length} / ${g.steps.length} 步已完成`
                        : "等待制定计划"}
                </small>
                {g.steps.length > 0 && (
                  <progress
                    value={g.steps.filter((s) => s.done).length}
                    max={g.steps.length}
                    aria-label={`${g.title}进度`}
                  />
                )}
              </span>
              <ChevronRight size={19} />
            </button>
          ))}
        </div>
      )}
      <p className="page-note">
        目标和步骤保存在当前服务空间。执行由对话发起，不会自动定时运行。
      </p>
      {create && (
        <Sheet
          title="新建目标"
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
              想完成什么？
              <input
                autoFocus
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：规划一次周末旅行"
              />
            </label>
            <label className="field">
              补充说明
              <textarea
                value={description}
                maxLength={8000}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="时间、偏好，或希望 Muse 帮忙的部分"
                rows={3}
              />
            </label>
            <ErrorNotice error={error} />
            <button
              className="button primary wide"
              disabled={busy || !title.trim()}
            >
              {busy ? "正在保存…" : "创建目标"}
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
              ? "已完成"
              : current.status === "paused"
                ? "已暂停"
                : "进行中"}
          </div>
          <h3 className="list-caption">计划步骤</h3>
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
                      id: crypto.randomUUID(),
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
              aria-label="新步骤"
              value={step}
              maxLength={160}
              placeholder="添加一个步骤"
              onChange={(e) => setStep(e.target.value)}
            />
            <button
              className="icon-button"
              aria-label="添加步骤"
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
            {current.session_id ? "继续目标对话" : "让 Muse 帮我规划"}
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
              {current.status === "completed" ? "重新开启" : "标记完成"}
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
                {current.status === "paused" ? "恢复目标" : "暂停目标"}
              </button>
            )}
          </div>
          <p className="page-note">
            暂停或完成只更新目标记录。如需停止正在执行的任务，请进入对话操作。
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
      <PageHeader title="资料库" description="收藏有用的回复，随时回来查看。" />
      <label className="library-search">
        <Search size={19} />
        <input
          aria-label="搜索资料库"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索资料库"
        />
      </label>
      <div className="library-section">
        <FileText size={18} />
        <strong>已保存的回复</strong>
        <span>{items.length}</span>
      </div>
      <ErrorNotice error={error} retry={() => void reload()} />
      {loading ? (
        <Loading />
      ) : error && !items.length ? null : !visible.length ? (
        <Empty
          icon={<Shapes size={30} />}
          title={query ? "没有匹配的资料" : "留住值得收藏的内容"}
          description={
            query
              ? "试试其他关键词。"
              : "在对话回复下点击收藏，即可保存到这里。"
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
              查看来源对话
              <ArrowRight size={16} />
            </a>
            <button
              className="icon-button"
              aria-label="导出资料"
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
