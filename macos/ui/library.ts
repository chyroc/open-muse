import { formatLocale, t } from "../../shared/i18n";
import { uuid } from "../../shared/crypto";
import type { LibraryItem } from "../../shared/types";
import type { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { goalOwner } from "./goals";

export type LibraryView =
  "all" | "documents" | "web" | "images" | "video" | "podcasts" | "files";
export type LibrarySort = "auto" | "date" | "name";
export type LibraryLayout = "grid" | "list";
export type LibraryPresentation = {
  pinned: string[];
  opened: Record<string, string>;
  sort: LibrarySort;
  layout: LibraryLayout;
};
export const emptyLibraryPresentation = (): LibraryPresentation => ({
  pinned: [],
  opened: {},
  sort: "auto",
  layout: "grid",
});
const database = new LocalDatabase();
export const libraryViews: {
  id: LibraryView;
  label: string;
  empty: string;
  create?: string;
  prompt?: string;
}[] = [
  {
    id: "all",
    label: "All creations",
    empty: "No artifacts yet",
    create: "Create an artifact",
    prompt: "I want to create ",
  },
  {
    id: "documents",
    label: "Documents",
    empty: "No documents yet",
    create: "Create a document",
    prompt: "I want to create a document about ",
  },
  {
    id: "web",
    label: "Web artifacts",
    empty: "No web artifacts yet",
    create: "Create an artifact",
    prompt: "I want to create ",
  },
  {
    id: "images",
    label: "Images",
    empty: "No images yet",
    create: "Create an image",
    prompt: "I want to create an image of ",
  },
  {
    id: "video",
    label: "Videos",
    empty: "No videos yet",
    create: "Create a video",
    prompt: "I want to create a video of ",
  },
  { id: "podcasts", label: "Podcasts", empty: "No podcasts yet" },
  { id: "files", label: "System files", empty: "No system files available" },
];
export function libraryPath(view: LibraryView) {
  if (view === "files" || view === "podcasts") return `/library/${view}`;
  if (view === "images" || view === "video")
    return `/library/media?view=${view}`;
  return `/library/artifacts${view === "all" ? "" : `?view=${view}`}`;
}
export function libraryGroups(
  rows: LibraryItem[],
  state: LibraryPresentation,
  view: LibraryView,
  query: string,
) {
  const term = query.trim().toLocaleLowerCase(formatLocale());
  // Saved replies are text documents, so only text categories and search list them.
  if (!term && view !== "all" && view !== "documents") return [];
  const matching = rows.filter(
    (item) =>
      !term ||
      `${item.title}\n${item.text}`
        .toLocaleLowerCase(formatLocale())
        .includes(term),
  );
  const created = (item: LibraryItem) => Date.parse(item.created_at) || 0;
  const byDate = (a: LibraryItem, b: LibraryItem) =>
    created(b) - created(a) || a.id.localeCompare(b.id);
  if (state.sort !== "auto")
    return [
      {
        title: "",
        items: matching.sort(
          state.sort === "date"
            ? byDate
            : (a, b) =>
                new Intl.Collator(formatLocale()).compare(a.title, b.title) ||
                byDate(a, b),
        ),
      },
    ];
  const pinned = matching
    .filter((item) => state.pinned.includes(item.id))
    .sort(byDate);
  const rest = matching.filter((item) => !state.pinned.includes(item.id));
  const recent = rest
    .filter((item) => Number.isFinite(Date.parse(state.opened[item.id])))
    .sort(
      (a, b) => Date.parse(state.opened[b.id]) - Date.parse(state.opened[a.id]),
    )
    .slice(0, 8);
  const recentIds = new Set(recent.map((item) => item.id));
  return [
    { title: "Pinned", items: pinned },
    { title: "Recent", items: recent },
    {
      title: "All artifacts",
      items: rest.filter((item) => !recentIds.has(item.id)).sort(byDate),
    },
  ].filter((group) => group.items.length);
}

// Presentation only ever gains entries on this Mac, so cap it instead of
// letting a long-lived account grow one unbounded local record.
const presentationLimit = 200;
function boundPresentation(state: LibraryPresentation) {
  if (state.pinned.length > presentationLimit)
    state.pinned = state.pinned.slice(-presentationLimit);
  const opened = Object.entries(state.opened);
  if (opened.length > presentationLimit)
    state.opened = Object.fromEntries(
      opened
        .sort((a, b) => (Date.parse(b[1]) || 0) - (Date.parse(a[1]) || 0))
        .slice(0, presentationLimit),
    );
  return state;
}

// Field comparison, not serialization order, decides whether a stored record is
// still the exact one the user reviewed before asking to remove it.
export function sameLibraryItem(a: LibraryItem, b: LibraryItem) {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.text === b.text &&
    a.session_id === b.session_id &&
    a.event_id === b.event_id &&
    a.created_at === b.created_at
  );
}

// Saved replies are actual MA text documents, not executable apps or media.
// Presentation is Mac-only; removal edits the shared local saved-reply index,
// never cloud events. Undo merges with concurrent saves without overwriting them.
export class MacLibrary {
  private owner: string;
  private key: string;
  constructor(
    private client: Client,
    private db = database,
  ) {
    this.owner = goalOwner(client);
    this.key = `${this.owner}:macos-library:v1`;
  }
  private assertScope() {
    if (goalOwner(this.client) !== this.owner)
      throw new Error(
        t("The connection changed. Reopen Library before continuing."),
      );
  }
  async snapshot() {
    this.assertScope();
    const [rows, state] = await Promise.all([
      this.client.library(),
      this.db.get<LibraryPresentation>(this.key),
    ]);
    this.assertScope();
    return {
      rows: rows.data,
      presentation: state ?? emptyLibraryPresentation(),
    };
  }
  private async update(change: (state: LibraryPresentation) => void) {
    this.assertScope();
    const result = await this.db.update<LibraryPresentation>(
      this.key,
      (old) => {
        this.assertScope();
        const state = old ?? emptyLibraryPresentation();
        change(state);
        return boundPresentation(state);
      },
    );
    this.assertScope();
    return result;
  }
  preferences(change: { sort?: LibrarySort; layout?: LibraryLayout }) {
    return this.update((state) => Object.assign(state, change));
  }
  pin(id: string, pinned: boolean) {
    return this.update((state) => {
      state.pinned = state.pinned.filter((value) => value !== id);
      if (pinned) state.pinned.push(id);
    });
  }
  opened(id: string) {
    return this.update((state) => {
      state.opened[id] = new Date().toISOString();
    });
  }
  async remove(items: LibraryItem[]) {
    this.assertScope();
    const removed: LibraryItem[] = [];
    // The saved-reply index is the same local record Client.library() reads.
    await this.db.update<LibraryItem[]>(`${this.owner}:library`, (old) => {
      this.assertScope();
      removed.length = 0;
      return (old ?? []).filter((item) => {
        const remove = items.some((expected) =>
          sameLibraryItem(expected, item),
        );
        if (remove) removed.push(item);
        return !remove;
      });
    });
    this.assertScope();
    return removed;
  }
  async restore(items: LibraryItem[]) {
    this.assertScope();
    await this.db.update<LibraryItem[]>(`${this.owner}:library`, (old) => {
      this.assertScope();
      const rows = old ?? [];
      for (const item of items)
        if (
          !rows.some(
            (row) =>
              row.id === item.id ||
              (row.session_id === item.session_id &&
                row.event_id === item.event_id),
          )
        )
          rows.push(item);
      return rows;
    });
    this.assertScope();
  }
}

// Separators, reserved characters and control characters never reach the native
// save panel, and a title made only of dots cannot suggest a hidden file.
export function exportFileName(title: string) {
  const name = title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 120)
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return `${name || "document"}.md`;
}

// Native text-only save, with bounded listeners and unmount cancellation.
// No PDF/binary export or sharing capability is implied by this bridge.
export function exportLibraryDocument(item: LibraryItem, signal: AbortSignal) {
  return exportTextFile(exportFileName(item.title), item.text, signal);
}

// Offers to save any text under a suggested file name, through the same
// native save panel.
export function exportTextFile(
  name: string,
  content: string,
  signal: AbortSignal,
) {
  if (signal.aborted)
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  const bridge = (
    window as unknown as {
      webkit?: {
        messageHandlers?: {
          museExport?: { postMessage: (value: object) => void };
        };
      };
    }
  ).webkit?.messageHandlers?.museExport;
  if (!bridge)
    return Promise.reject(
      new Error(
        t("Native document export is unavailable. Reopen the Mac app."),
      ),
    );
  return new Promise<string>((resolve, reject) => {
    const id = uuid();
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("muse-export-result", listener);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const listener = (event: Event) => {
      const result = (event as CustomEvent).detail;
      if (!result || result.id !== id) return;
      cleanup();
      if (result.success) resolve(t("Document saved"));
      else if (result.cancelled) resolve(t("Export canceled"));
      else reject(new Error(t("Save failed. Please check file permissions.")));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          t(
            "The save dialog has not confirmed a result. Check it before exporting again.",
          ),
        ),
      );
    }, 120000);
    signal.addEventListener("abort", abort, { once: true });
    window.addEventListener("muse-export-result", listener);
    try {
      bridge.postMessage({ id, name, content });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

const codeExtensions: Record<string, string> = {
  python: "py",
  py: "py",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  json: "json",
  html: "html",
  css: "css",
  go: "go",
  rust: "rs",
  swift: "swift",
  java: "java",
  kotlin: "kt",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  sql: "sql",
  yaml: "yml",
  yml: "yml",
  markdown: "md",
  md: "md",
  ruby: "rb",
  php: "php",
};
// The file name a code block suggests, from its language.
export const codeFileName = (language?: string) =>
  `code.${codeExtensions[language?.toLowerCase() ?? ""] ?? "txt"}`;
