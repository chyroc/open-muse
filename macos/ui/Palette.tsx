import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckSquare,
  Keyboard,
  MessageCircle,
  PenLine,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { t } from "../../shared/i18n";
import type { Goal } from "../../shared/types";
import { Modal } from "./Chrome";
import { navLabel } from "./labels";
import type { Page } from "./model";

// The same section names the rail uses.
const pageName = (page: Page) =>
  page === "feed" ? t("Feed") : page === "goals" ? t("Goals") : navLabel(page);

export type PaletteItem = {
  id: string;
  group: "commands" | "chats" | "goals" | "message";
  label: string;
  run: () => void;
};

// One list for everything the palette can reach: commands, chats and goals,
// plus writing the typed text into the main chat. Matching ignores case.
export function paletteItems(input: {
  query: string;
  chats: { id: string; title: string }[];
  goals: Pick<Goal, "id" | "title" | "status">[];
  onPage: (page: Page) => void;
  onNewChat: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onChat: (id: string) => void;
  onGoal: (id: string) => void;
  onWrite: (text: string) => void;
}): PaletteItem[] {
  const term = input.query.trim().toLocaleLowerCase();
  const matches = (label: string) =>
    !term || label.toLocaleLowerCase().includes(term);
  const pages: Page[] = ["chat", "feed", "ideas", "goals", "library"];
  const commands: PaletteItem[] = [
    ...pages.map((page) => ({
      id: `page:${page}`,
      group: "commands" as const,
      label: t("Go to {name}", { name: pageName(page) }),
      run: () => input.onPage(page),
    })),
    {
      id: "new-chat",
      group: "commands",
      label: t("New side chat"),
      run: input.onNewChat,
    },
    {
      id: "settings",
      group: "commands",
      label: t("Settings"),
      run: input.onSettings,
    },
    {
      id: "shortcuts",
      group: "commands",
      label: t("Keyboard shortcuts"),
      run: input.onShortcuts,
    },
  ];
  return [
    ...(term
      ? [
          {
            id: "write",
            group: "message" as const,
            label: t("Write “{text}” in the main chat", {
              text: input.query.trim().slice(0, 80),
            }),
            run: () => input.onWrite(input.query.trim()),
          },
        ]
      : []),
    ...commands.filter((item) => matches(item.label)),
    ...input.chats
      .filter((chat) => matches(chat.title))
      .slice(0, 30)
      .map((chat) => ({
        id: `chat:${chat.id}`,
        group: "chats" as const,
        label: chat.title,
        run: () => input.onChat(chat.id),
      })),
    ...input.goals
      .filter((goal) => goal.status !== "completed" && matches(goal.title))
      .slice(0, 20)
      .map((goal) => ({
        id: `goal:${goal.id}`,
        group: "goals" as const,
        label: goal.title,
        run: () => input.onGoal(goal.id),
      })),
  ];
}

const groupLabels: Record<PaletteItem["group"], string> = {
  message: "Message",
  commands: "Commands",
  chats: "Chats",
  goals: "Goals",
};

function icon(item: PaletteItem) {
  if (item.group === "message") return <PenLine size={17} />;
  if (item.group === "chats") return <MessageCircle size={17} />;
  if (item.group === "goals") return <CheckSquare size={17} />;
  if (item.id === "new-chat") return <Plus size={17} />;
  if (item.id === "settings") return <Settings size={17} />;
  if (item.id === "shortcuts") return <Keyboard size={17} />;
  return <ArrowRight size={17} />;
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
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const grouped = useMemo(() => {
    const groups: {
      group: PaletteItem["group"];
      rows: [PaletteItem, number][];
    }[] = [];
    items.forEach((item, index) => {
      const last = groups.at(-1);
      if (last?.group === item.group) last.rows.push([item, index]);
      else groups.push({ group: item.group, rows: [[item, index]] });
    });
    return groups;
  }, [items]);
  const choose = (item?: PaletteItem) => {
    if (!item) return;
    onClose();
    item.run();
  };
  return (
    <Modal title={t("Search")} className="command-palette" onClose={onClose}>
      <label className="search-field">
        <Search size={20} />
        <input
          autoFocus
          placeholder={t("Search chats, goals and commands")}
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
                (value) => (value + step + items.length) % (items.length || 1),
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(items[active]);
            }
          }}
        />
      </label>
      <div
        className="search-results"
        id="palette-results"
        role="listbox"
        ref={list}
      >
        {grouped.map(({ group, rows }) => (
          <section key={group} aria-label={t(groupLabels[group])}>
            <h3>{t(groupLabels[group])}</h3>
            {rows.map(([item, index]) => (
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
                {icon(item)}
                <span>{item.label}</span>
              </button>
            ))}
          </section>
        ))}
        {!items.length && (
          <p className="subtle">{loading ? t("Loading…") : t("No results")}</p>
        )}
      </div>
    </Modal>
  );
}
