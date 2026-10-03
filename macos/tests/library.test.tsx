import "fake-indexeddb/auto";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import type { LibraryItem } from "../../shared/types";
import { t } from "../../shared/i18n";
import { zhCN } from "../../shared/locales/zh-CN";
import { goalOwner } from "../ui/goals";
import {
  emptyLibraryPresentation,
  exportFileName,
  exportLibraryDocument,
  libraryGroups,
  libraryPath,
  libraryViews,
  MacLibrary,
} from "../ui/library";
import { LibraryPage } from "../ui/LibraryPage";
import { DesktopApp } from "../ui/DesktopApp";
import { parseRoute } from "../ui/model";

vi.mock("../../src/useTask", () => ({
  useTask: () => ({
    events: [],
    session: undefined,
    loading: false,
    error: "",
    connected: false,
    autoApprovalFailures: [],
    refresh: async () => {},
  }),
}));
const item = (
  id = "one",
  title = "Original user title",
  text = "# Real saved reply\n\nBody text",
): LibraryItem => ({
  id,
  title,
  text,
  session_id: "source-session",
  event_id: `event-${id}`,
  created_at: "2026-09-30T01:00:00Z",
});
async function fixture(
  rows: LibraryItem[] = [],
  db = new LocalDatabase(`mac-library-${crypto.randomUUID()}`),
) {
  const key = `test-library-${crypto.randomUUID()}`;
  const client = new Client({
    database: db,
    fetcher: vi.fn(async () => {
      throw new Error("Library must not contact the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({ kind: "api_key", apiKey: key, project: "test" }),
      write: async () => {},
    },
  });
  await client.restore();
  const owner = goalOwner(client);
  await db.set(`${owner}:library`, rows);
  return { client, db, owner, service: () => new MacLibrary(client, db) };
}

describe("Mac Library adapter", () => {
  it("reads the real Client saved-reply index and preserves original text", async () => {
    const f = await fixture([item()]);
    expect((await f.service().snapshot()).rows).toEqual([item()]);
    expect((await f.client.library()).data[0].text).toBe(item().text);
  });
  it("persists pin, recent and layout settings per account/project", async () => {
    const f = await fixture([item()]);
    await f.service().pin("one", true);
    await f.service().pin("one", true);
    await f.service().opened("one");
    await f.service().preferences({ layout: "list", sort: "name" });
    const state = (await f.service().snapshot()).presentation;
    expect(state.pinned).toEqual(["one"]);
    expect(state.opened.one).toBeTruthy();
    expect(state.layout).toBe("list");
    const other = await fixture([], f.db);
    expect((await other.service().snapshot()).presentation).toEqual(
      emptyLibraryPresentation(),
    );
    const stale = f.service();
    f.client.identity.value!.project = "changed";
    await expect(stale.pin("one", false)).rejects.toThrow("connection changed");
    await expect(stale.snapshot()).rejects.toThrow("connection changed");
  });
  it("removes only reviewed local records and merges Undo with concurrent saves", async () => {
    const f = await fixture([item(), item("two")]);
    const removed = await f.service().remove([item()]);
    expect(removed).toEqual([item()]);
    expect((await f.client.library()).data.map((row) => row.id)).toEqual([
      "two",
    ]);
    await f.db.update<LibraryItem[]>(`${f.owner}:library`, (rows) => [
      ...rows!,
      item("three"),
    ]);
    await f.service().restore(removed);
    await f.service().restore(removed);
    expect((await f.client.library()).data.map((row) => row.id).sort()).toEqual(
      ["one", "three", "two"],
    );
    await f.db.set(`${f.owner}:library`, [
      { ...item(), text: "Changed after review" },
    ]);
    expect(await f.service().remove([item()])).toEqual([]);
    expect((await f.client.library()).data[0].text).toBe(
      "Changed after review",
    );
  });
  it("matches a stored record by fields, not by serialization order", async () => {
    const f = await fixture();
    const reordered = Object.fromEntries(
      Object.entries(item()).reverse(),
    ) as LibraryItem;
    await f.db.set(`${f.owner}:library`, [reordered]);
    expect(await f.service().remove([item()])).toEqual([reordered]);
    expect((await f.client.library()).data).toEqual([]);
  });
  it("bounds local presentation growth and keeps the newest entries", async () => {
    const f = await fixture();
    const opened: Record<string, string> = {};
    for (let index = 0; index < 250; index++)
      opened[`old-${index}`] =
        `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00Z`;
    await f.db.set(`${f.owner}:macos-library:v1`, {
      ...emptyLibraryPresentation(),
      pinned: Array.from({ length: 250 }, (_, index) => `pin-${index}`),
      opened,
    });
    const state = await f.service().opened("newest");
    expect(state.pinned).toHaveLength(200);
    expect(state.pinned.at(-1)).toBe("pin-249");
    expect(Object.keys(state.opened)).toHaveLength(200);
    expect(state.opened.newest).toBeTruthy();
  });
  it("does not duplicate a reply resaved during Undo", async () => {
    const f = await fixture([item()]);
    const removed = await f.service().remove([item()]);
    await f.db.set(`${f.owner}:library`, [{ ...item(), id: "resaved" }]);
    await f.service().restore(removed);
    expect((await f.client.library()).data.map((row) => row.id)).toEqual([
      "resaved",
    ]);
  });
  it("sorts pinned/recent/rest without duplicates and searches actual text only", () => {
    const rows = [
      item(),
      { ...item("two", "Alpha"), created_at: "2026-09-29T01:00:00Z" },
      item("three", "Beta", "Unique body needle"),
    ];
    const state = {
      ...emptyLibraryPresentation(),
      pinned: ["one"],
      opened: { one: "2026-09-30T04:00:00Z", two: "2026-09-30T03:00:00Z" },
    };
    expect(
      libraryGroups(rows, state, "all", "").map((group) => [
        group.title,
        group.items.map((row) => row.id),
      ]),
    ).toEqual([
      ["Pinned", ["one"]],
      ["Recent", ["two"]],
      ["All artifacts", ["three"]],
    ]);
    expect(
      libraryGroups(
        rows,
        { ...state, sort: "name" },
        "documents",
        "",
      )[0].items.map((row) => row.id),
    ).toEqual(["two", "three", "one"]);
    expect(libraryGroups(rows, state, "images", "")).toEqual([]);
    expect(
      libraryGroups(rows, state, "web", "NEEDLE")
        .flatMap((group) => group.items)
        .map((row) => row.id),
    ).toEqual(["three"]);
  });
  it("keeps desktop category routes bounded and round-trippable", () => {
    for (const view of libraryViews)
      expect(parseRoute(`#${libraryPath(view.id)}`)).toEqual({
        page: "library",
        libraryView: view.id,
      });
    expect(parseRoute("#/library/artifacts?view=../../secret")).toEqual({
      page: "chat",
    });
    expect(parseRoute("#/library/files/private")).toEqual({ page: "chat" });
  });
  it("provides every dynamic category/sort translation", () => {
    for (const key of [
      ...libraryViews.flatMap((view) =>
        [view.label, view.empty, view.create, view.prompt].filter(Boolean),
      ),
      "Last opened",
      "Last created",
      "Title",
      "View as grid",
      "View as list",
      "Pinned",
      "Recent",
      "All artifacts",
    ] as string[])
      expect(Object.hasOwn(zhCN, key), key).toBe(true);
  });
});

describe("Mac Library native export", () => {
  it("sends original Markdown, sanitizes the name, and matches the exact callback", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museExport: { postMessage } } },
    });
    const promise = exportLibraryDocument(
      item("one", "User/name\nTitle"),
      new AbortController().signal,
    );
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      name: "User-name-Title.md",
      content: item().text,
    });
    const id = postMessage.mock.calls[0][0].id;
    window.dispatchEvent(
      new CustomEvent("muse-export-result", {
        detail: { id: "unrelated", success: true },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("muse-export-result", { detail: { id, success: true } }),
    );
    await expect(promise).resolves.toBe("Document saved");
  });
  it("suggests a bounded file name for hostile document titles", () => {
    expect(exportFileName("User/name\nTitle")).toBe("User-name-Title.md");
    expect(exportFileName("../../etc/passwd")).toBe("etc-passwd.md");
    expect(exportFileName("   ...   ")).toBe("document.md");
    expect(exportFileName("a".repeat(400))).toBe(`${"a".repeat(120)}.md`);
  });
  it("handles cancellation and abort without leaving an export listener", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museExport: { postMessage } } },
    });
    const signal = new AbortController();
    const promise = exportLibraryDocument(item(), signal.signal);
    const result = expect(promise).rejects.toThrow("unmounted");
    signal.abort(new Error("unmounted"));
    await result;
    const second = exportLibraryDocument(item(), new AbortController().signal);
    window.dispatchEvent(
      new CustomEvent("muse-export-result", {
        detail: { id: postMessage.mock.calls[1][0].id, cancelled: true },
      }),
    );
    await expect(second).resolves.toBe("Export canceled");
  });
  it("bounds the wait and rejects a missing bridge without browser downloads", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: undefined,
    });
    await expect(
      exportLibraryDocument(item(), new AbortController().signal),
    ).rejects.toThrow("unavailable");
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museExport: { postMessage: vi.fn() } } },
    });
    const result = expect(
      exportLibraryDocument(item(), new AbortController().signal),
    ).rejects.toThrow("not confirmed");
    await vi.advanceTimersByTimeAsync(120000);
    await result;
  });
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  vi.useRealTimers();
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  location.hash = "";
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
  vi.unstubAllGlobals();
});
async function mount(element: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await settle();
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
function button(label: string) {
  const result = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent === label ||
      button.getAttribute("aria-label") === label,
  );
  if (!result) throw new Error(`Missing Library button: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}
async function type(value: string, selector = "input") {
  await act(async () => {
    const input = host!.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(
      selector === "textarea"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function page(
  f: Awaited<ReturnType<typeof fixture>>,
  view: Parameters<typeof LibraryPage>[0]["view"] = "all",
  split = false,
) {
  const props = {
    client: f.client,
    identity: defaultIdentity(),
    view,
    split,
    onView: vi.fn(),
    onDraft: vi.fn(),
    onConnect: vi.fn(),
    onToggleChat: vi.fn(),
    onOpenChat: vi.fn(),
    onDocument: vi.fn(),
  };
  return { props, element: <LibraryPage {...props} /> };
}

describe("Mac Library desktop UI", () => {
  it("keeps the labelled create action on a desktop-width workspace", async () => {
    const f = await fixture([], new LocalDatabase());
    await mount(page(f, "documents").element);
    const create = host!.querySelector(".library-create");
    expect(create?.querySelector("span")?.textContent).toBe(
      "Create a document",
    );
    // A full-width 1152-point window leaves 834 points of workspace after the
    // 78-point rail and the 240-point sidebar. The label must survive there,
    // and the title truncates first, so the threshold stays well below it.
    const css = readFileSync("macos/ui/library.css", "utf8");
    const compact =
      /@container \(max-width: (\d+)px\)[^{]*\{\s*\.library-create/.exec(css);
    expect(Number(compact?.[1])).toBeLessThan(834 - 240);
    expect(css).toContain(".library-title-text");
  });
  it.each(["en", "zh-CN", "fr-FR"])(
    "follows system %s without translating saved content",
    async (language) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
      const f = await fixture(
        [item("one", "Settings 我的标题", "User original text")],
        new LocalDatabase(),
      );
      await mount(page(f).element);
      expect(host!.textContent).toContain("Settings 我的标题");
      expect(host!.textContent).toContain(
        language === "zh-CN" ? "所有生成内容" : "All creations",
      );
      await click(t("Open {title}", { title: "Settings 我的标题" }));
      expect(host!.textContent).toContain("User original text");
      expect(host!.querySelector(".library-preview-bar")).toBeTruthy();
    },
  );
  it("renders a 7-category sidebar and only seeds an unsent creation draft", async () => {
    const f = await fixture([], new LocalDatabase());
    const p = page(f, "documents");
    await mount(p.element);
    expect(host!.querySelectorAll(".library-sidebar a")).toHaveLength(7);
    await click("Create a document");
    expect(p.props.onDraft).toHaveBeenCalledWith(
      "I want to create a document about ",
    );
    expect((await f.client.library()).data).toEqual([]);
    expect(host!.textContent).toContain("No documents yet");
  });
  it("shows truthful unavailable media and real memory-document navigation", async () => {
    const f = await fixture([item()], new LocalDatabase());
    const p = page(f, "images");
    await mount(p.element);
    expect(host!.querySelectorAll(".library-card")).toHaveLength(0);
    expect(host!.textContent).toContain("not connected");
    await click("Create an image");
    expect(p.props.onDraft).toHaveBeenCalledWith(
      "I want to create an image of ",
    );
    await act(async () =>
      root!.render(<LibraryPage {...p.props} view="files" />),
    );
    await click("SOUL.md");
    expect(p.props.onDocument).toHaveBeenCalledWith("SOUL.md");
    expect(host!.textContent).toContain(
      "Sandbox file browsing is not connected",
    );
  });
  it("searches bodies, switches layout, pins, previews and opens the source", async () => {
    const f = await fixture(
      [item(), item("two", "Another", "Searchable secret-free needle")],
      new LocalDatabase(),
    );
    const p = page(f);
    await mount(p.element);
    await type("NEEDLE");
    expect(host!.querySelectorAll(".library-card")).toHaveLength(1);
    await type("");
    await click("Sort artifacts");
    await click("View as list");
    expect(host!.querySelector(".library-items.list")).toBeTruthy();
    await click("Options for Original user title");
    await click("Pin");
    expect(host!.textContent).toContain("Pinned");
    await click("Open Original user title");
    expect(host!.querySelector(".library-document")?.textContent).toContain(
      "Real saved reply",
    );
    await click("Open source conversation");
    expect(p.props.onOpenChat).toHaveBeenCalledWith("source-session");
    await click("Close document preview");
    expect(host!.querySelector(".library-preview-bar")).toBeNull();
  });
  it("replaces the category surface while searching and clears back to it", async () => {
    const f = await fixture(
      [item(), item("two", "Another", "Searchable secret-free needle")],
      new LocalDatabase(),
    );
    await mount(page(f, "documents").element);
    await type("zzzz-open-muse-readonly");
    expect(host!.querySelector(".library-header h1")?.textContent).toBe(
      "Search results",
    );
    expect(host!.textContent).toContain(
      "No results for “zzzz-open-muse-readonly”",
    );
    expect(() => button("Select")).toThrow();
    expect(() => button("Sort artifacts")).toThrow();
    expect(() => button("Create a document")).toThrow();
    expect(host!.querySelectorAll(".library-sidebar a")).toHaveLength(7);
    await click("Clear search");
    expect(host!.querySelector(".library-header h1")?.textContent).toBe(
      "Documents",
    );
    expect(host!.querySelectorAll(".library-card")).toHaveLength(2);
  });
  it("confirms bulk removal and offers a safe local Undo", async () => {
    const f = await fixture([item(), item("two")], new LocalDatabase());
    await mount(page(f).element);
    await click("Select");
    // Selection replaces the whole header instead of adding a second toolbar.
    expect(host!.textContent).toContain("0 selected");
    expect(host!.textContent).not.toContain("All creations");
    expect(() => button("Sort artifacts")).toThrow();
    expect(() => button("Create an artifact")).toThrow();
    expect(button("Remove").disabled).toBe(true);
    await click("Select all");
    expect(host!.textContent).toContain("2 selected");
    await click("Remove");
    expect(host!.querySelector("dialog")?.textContent).toContain(
      "cloud conversations are kept",
    );
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          "dialog .feed-dialog-actions button:last-child",
        )!
        .click(),
    );
    await settle();
    expect((await f.client.library()).data).toHaveLength(0);
    await click("Undo");
    expect((await f.client.library()).data).toHaveLength(2);
    expect(host!.querySelectorAll(".library-card")).toHaveLength(2);
  });
  it("reports a changed saved copy instead of offering an unsafe Undo", async () => {
    const f = await fixture([item()], new LocalDatabase());
    await mount(page(f).element);
    await click("Options for Original user title");
    await click("Remove from Library");
    await f.db.set(`${f.owner}:library`, [
      { ...item(), text: "Changed by another window" },
    ]);
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          "dialog .feed-dialog-actions button:last-child",
        )!
        .click(),
    );
    await settle();
    expect(host!.textContent).toContain("Nothing was removed");
    expect(() => button("Undo")).toThrow();
    expect((await f.client.library()).data).toHaveLength(1);
  });
  it("Escape or the exit control leaves the selection header", async () => {
    const f = await fixture([item()], new LocalDatabase());
    await mount(page(f).element);
    await click("Select");
    await act(async () =>
      host!
        .querySelector("input")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
        ),
    );
    expect(host!.querySelector(".library-exit-selection")).toBeTruthy();
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(host!.querySelector(".library-exit-selection")).toBeNull();
    await click("Select");
    await click("Exit selection");
    expect(host!.querySelector(".library-exit-selection")).toBeNull();
    expect(host!.textContent).toContain("All creations");
  });
  it("keeps split Library navigation accessible in the title menu", async () => {
    const f = await fixture([], new LocalDatabase());
    const p = page(f, "documents", true);
    await mount(p.element);
    expect(host!.querySelector(".library-sidebar")).toBeNull();
    await click("Choose Library section");
    expect(host!.querySelectorAll(".library-section-menu a")).toHaveLength(7);
    await act(async () =>
      host!
        .querySelector<HTMLAnchorElement>(
          'a[href="#/library/media?view=video"]',
        )!
        .click(),
    );
    expect(p.props.onView).toHaveBeenCalledWith("video");
  });
  it("fills the desktop split composer and guards existing drafts without cloud writes", async () => {
    const f = await fixture([], new LocalDatabase());
    const create = vi.spyOn(f.client, "create");
    const send = vi.spyOn(f.client, "send");
    vi.spyOn(f.client, "sessions").mockResolvedValue({ data: [] });
    vi.spyOn(f.client, "companionIdentity").mockResolvedValue(
      defaultIdentity(),
    );
    vi.spyOn(f.client, "goals").mockResolvedValue({
      data: [],
      revision: "fixture",
    });
    vi.spyOn(f.client, "conversationIndex").mockResolvedValue({
      mainId: "main",
      entries: {},
    });
    location.hash = "#/library/artifacts?view=documents";
    await mount(<DesktopApp client={f.client} />);
    await click("Create a document");
    expect(host!.querySelector(".desktop-shell.library-split")).toBeTruthy();
    expect(host!.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "I want to create a document about ",
    );
    await type("Existing draft", "textarea");
    await click("Create a document");
    expect(host!.querySelector("dialog")?.textContent).toContain(
      "creation prompt",
    );
    await click("Keep my draft");
    expect(host!.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "Existing draft",
    );
    await click("Create a document");
    await click("Replace draft");
    expect(host!.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "I want to create a document about ",
    );
    expect(create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    // Reselecting Library restores the sidebar and keeps the open category.
    await click("Library");
    expect(host!.querySelector(".desktop-shell.library-split")).toBeNull();
    expect(host!.querySelector(".library-sidebar")).toBeTruthy();
    expect(host!.querySelector(".library-header h1")?.textContent).toBe(
      "Documents",
    );
    expect(location.hash).toBe("#/library/artifacts?view=documents");
  });
});
