import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Keyboard,
  Lightbulb,
  MessagesSquare,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { formatLocale, t } from "../../shared/i18n";
import type { Goal } from "../../shared/types";
import { ChatIcon, FeedIcon, GoalsIcon, LibraryIcon } from "./Chrome";
import { navLabel } from "./labels";
import type { Page } from "./model";

// Search popover numbers: a fixed frame a quarter of the way down the window
// that zooms down into place, over a scrim that fades in more slowly.
export const quickSearch = {
  width: 512,
  top: "25vh",
  enterMs: 300,
  scrimMs: 1000,
  // Chats shown before anything is typed.
  recentLimit: 6,
  chatLimit: 8,
  goalLimit: 8,
};

export type PaletteItem = {
  id: string;
  kind: "command" | "chat" | "goal" | "message";
  title: string;
  // Matched at a lower weight than the title; a chat shows it as its snippet.
  detail?: string;
  // Milliseconds; chats show how long ago they changed.
  updatedAt?: number;
  rank: number;
  icon: ReactNode;
  run: () => void;
};

// How well `text` matches `query`: whole, prefix, word start, inside, or as
// scattered letters in order. Undefined when it does not match at all.
export function matchScore(text: string | undefined, query: string) {
  const value = text?.trim().toLocaleLowerCase();
  const term = query.trim().toLocaleLowerCase();
  if (!value || !term) return undefined;
  if (value === term) return 1;
  const at = value.indexOf(term);
  if (at === 0) return 0.92;
  if (at > 0) return value[at - 1] === " " ? 0.84 : 0.72;
  let found = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < value.length && found < term.length; i++)
    if (value[i] === term[found]) {
      if (first === -1) first = i;
      last = i;
      found++;
    }
  if (found !== term.length || first === -1) return undefined;
  const density = term.length / (last - first + 1);
  const offset = first / Math.max(value.length, 1);
  return Math.max(0.15, Math.min(0.65, density * 0.65 - offset * 0.2));
}

function rank(title: string, detail: string | undefined, query: string) {
  return Math.max(
    matchScore(title, query) ?? 0,
    (matchScore(detail, query) ?? 0) * 0.2,
  );
}

export function relativeTime(at: number, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{count}m ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{count}h ago", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("{count}d ago", { count: days });
  return new Date(at).toLocaleDateString(formatLocale(), {
    month: "short",
    day: "numeric",
  });
}

// Everything the search reaches. With nothing typed it lists the most recent
// chats; otherwise commands, chats and goals are ranked together and writing
// the text into the main chat comes last.
export function paletteItems(input: {
  query: string;
  chats: {
    id: string;
    title: string;
    preview?: string;
    updatedAt?: string;
    main?: boolean;
  }[];
  goals: Pick<Goal, "id" | "title" | "status">[];
  assistantName?: string;
  onPage: (page: Page) => void;
  onNewChat: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onChat: (id: string) => void;
  onGoal: (id: string) => void;
  onWrite: (text: string) => void;
}): PaletteItem[] {
  const term = input.query.trim();
  const chats = input.chats.map((chat) => {
    const time = chat.updatedAt ? Date.parse(chat.updatedAt) : NaN;
    return {
      id: `chat:${chat.id}`,
      kind: "chat" as const,
      title: chat.main ? t("Main chat") : chat.title,
      detail: chat.preview?.replace(/\s+/g, " ").trim() || undefined,
      updatedAt: Number.isFinite(time) ? time : undefined,
      rank: 0,
      icon: <ChatIcon />,
      run: () => input.onChat(chat.id),
    };
  });
  if (!term)
    return chats
      .filter((chat) => chat.updatedAt !== undefined)
      .sort(
        (a, b) => b.updatedAt! - a.updatedAt! || a.title.localeCompare(b.title),
      )
      .slice(0, quickSearch.recentLimit);
  const page = (
    id: Page,
    title: string,
    detail: string,
    icon: ReactNode,
  ): Omit<PaletteItem, "rank"> => ({
    id: `page:${id}`,
    kind: "command",
    title,
    detail,
    icon,
    run: () => input.onPage(id),
  });
  const commands: Omit<PaletteItem, "rank">[] = [
    page("chat", navLabel("chat"), t("Open chat"), <ChatIcon />),
    page("feed", t("Feed"), t("Catch up on what is new"), <FeedIcon />),
    page(
      "ideas",
      navLabel("ideas"),
      t("Find inspiration for what to create"),
      <Lightbulb />,
    ),
    page("goals", t("Goals"), t("Track plans and progress"), <GoalsIcon />),
    page(
      "library",
      navLabel("library"),
      t("Browse documents, media, and more"),
      <LibraryIcon />,
    ),
    {
      id: "new-chat",
      kind: "command",
      title: t("New side chat"),
      detail: t("Side chat"),
      icon: <Plus />,
      run: input.onNewChat,
    },
    {
      id: "settings",
      kind: "command",
      title: t("Settings"),
      icon: <Settings />,
      run: input.onSettings,
    },
    {
      id: "shortcuts",
      kind: "command",
      title: t("Keyboard shortcuts"),
      icon: <Keyboard />,
      run: input.onShortcuts,
    },
  ];
  const ranked = (items: Omit<PaletteItem, "rank">[], limit = Infinity) =>
    items
      .map((item) => ({ ...item, rank: rank(item.title, item.detail, term) }))
      .filter((item) => item.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);
  const name = input.assistantName?.trim();
  return [
    ...ranked(commands),
    ...ranked(chats, quickSearch.chatLimit),
    ...ranked(
      input.goals
        .filter((goal) => goal.status !== "completed")
        .map((goal) => ({
          id: `goal:${goal.id}`,
          kind: "goal" as const,
          title: goal.title,
          icon: <GoalsIcon />,
          run: () => input.onGoal(goal.id),
        })),
      quickSearch.goalLimit,
    ),
  ]
    .sort((a, b) => b.rank - a.rank)
    .concat({
      id: "write",
      kind: "message",
      title: term,
      detail: name
        ? t("Send message to {name}", { name })
        : t("Send in the main chat"),
      rank: 0,
      icon: <MessagesSquare />,
      run: () => input.onWrite(term),
    });
}

function subtitle(item: PaletteItem, now: number) {
  if (item.kind === "command") return t("Command");
  if (item.kind === "goal") return t("Goal");
  const time =
    item.kind === "chat" && item.updatedAt !== undefined
      ? relativeTime(item.updatedAt, now)
      : undefined;
  if (!item.detail && !time) return undefined;
  return (
    <>
      {item.detail && <span className="search-snippet">{item.detail}</span>}
      {item.detail && time && <span aria-hidden="true">·</span>}
      {time && <span>{time}</span>}
    </>
  );
}

export function CommandPalette({
  query,
  onQuery,
  items,
  loading,
  onClose,
}: {
  query: string;
  onQuery: (value: string) => void;
  items: PaletteItem[];
  loading: boolean;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const now = Date.now();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal?.();
    input.current?.focus();
    return () => {
      dialog.current?.close?.();
      previous?.focus();
    };
  }, []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const choose = (item?: PaletteItem) => {
    if (!item) return;
    onClose();
    item.run();
  };
  const recents = !query.trim() && items.length > 0;
  const rows = items.map((item, index) => {
    const detail = subtitle(item, now);
    return (
      <button
        key={item.id}
        id={`palette-${item.id}`}
        role="option"
        data-index={index}
        aria-selected={index === active}
        className={index === active ? "active" : ""}
        onMouseMove={() => setActive(index)}
        onClick={() => choose(item)}
      >
        <span className="search-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span className="search-text">
          <span className="search-title" title={item.title}>
            {item.title}
          </span>
          {detail && <span className="search-detail">{detail}</span>}
        </span>
      </button>
    );
  });
  return (
    <dialog
      ref={dialog}
      className="quick-search"
      aria-label={t("Search")}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <div className="quick-search-frame">
        <div className="quick-search-field">
          <span className="quick-search-glyph" aria-hidden="true">
            <Search size={16} />
          </span>
          <input
            ref={input}
            placeholder={t("Search")}
            aria-label={t("Search all chats")}
            aria-controls="palette-results"
            aria-activedescendant={
              items[active] ? `palette-${items[active].id}` : undefined
            }
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive(
                  (value) =>
                    (value + step + items.length) % (items.length || 1),
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(items[active]);
              }
            }}
          />
          {query && (
            <button
              className="quick-search-clear"
              aria-label={t("Clear search")}
              onClick={() => {
                onQuery("");
                input.current?.focus();
              }}
            >
              <span className="quick-search-clear-dot">
                <X size={9} strokeWidth={3} />
              </span>
            </button>
          )}
        </div>
        <div
          className="search-results"
          id="palette-results"
          role="listbox"
          aria-label={recents ? t("Recents") : t("Search")}
          ref={list}
        >
          {recents && <h3>{t("Recents")}</h3>}
          {rows}
          {!items.length && (
            <p className="search-empty">
              {loading ? t("Searching…") : t("No results found")}
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
