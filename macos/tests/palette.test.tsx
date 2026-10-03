import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import {
  CommandPalette,
  matchScore,
  paletteItems,
  relativeTime,
} from "../ui/Palette";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

const now = Date.parse("2026-10-03T12:00:00Z");

function items(query: string, handlers = {}) {
  return paletteItems({
    query,
    chats: [
      {
        id: "main",
        title: "Main",
        main: true,
        preview: "See you\n tomorrow",
        updatedAt: new Date(now - 50 * 60_000).toISOString(),
      },
      {
        id: "s1",
        title: "Trip to Kyoto",
        updatedAt: new Date(now - 3 * 3_600_000).toISOString(),
      },
      {
        id: "s2",
        title: "Tax questions",
        updatedAt: new Date(now).toISOString(),
      },
      { id: "s3", title: "Never opened" },
    ],
    goals: [
      { id: "g1", title: "Run a 10k", status: "active" },
      { id: "g2", title: "Read Kyoto guide", status: "completed" },
    ],
    assistantName: "Muse",
    onPage: vi.fn(),
    onNewChat: vi.fn(),
    onSettings: vi.fn(),
    onShortcuts: vi.fn(),
    onChat: vi.fn(),
    onGoal: vi.fn(),
    onWrite: vi.fn(),
    ...handlers,
  });
}

async function render(query: string, handlers = {}, onClose = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <CommandPalette
        query={query}
        onQuery={vi.fn()}
        loading={false}
        items={items(query, handlers)}
        onClose={onClose}
      />,
    ),
  );
  return host;
}

describe("Mac search", () => {
  it("lists the most recent chats before anything is typed", () => {
    const recent = items("");
    expect(recent.map((item) => item.title)).toEqual([
      "Tax questions",
      "Main chat",
      "Trip to Kyoto",
    ]);
    expect(recent.every((item) => item.kind === "chat")).toBe(true);
    expect(recent[1].detail).toBe("See you tomorrow");
  });
  it("ranks commands, chats and open goals, with writing last", () => {
    const kyoto = items("kyoto");
    expect(kyoto.map((item) => [item.kind, item.title])).toEqual([
      ["chat", "Trip to Kyoto"],
      ["message", "kyoto"],
    ]);
    expect(kyoto.at(-1)?.detail).toBe("Send message to Muse");
    expect(items("10K")[0]).toMatchObject({ kind: "goal", title: "Run a 10k" });
    expect(items("goals")[0]).toMatchObject({
      kind: "command",
      title: "Goals",
    });
    // Letters in order still match, below a real substring.
    expect(matchScore("Trip to Kyoto", "tky")).toBeGreaterThan(0);
    expect(matchScore("Trip to Kyoto", "kyo")!).toBeGreaterThan(
      matchScore("Trip to Kyoto", "tky")!,
    );
    expect(matchScore("Trip", "xyz")).toBeUndefined();
  });
  it("says how long ago a chat changed", () => {
    expect(relativeTime(now - 20_000, now)).toBe("just now");
    expect(relativeTime(now - 50 * 60_000, now)).toBe("50m ago");
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe("5h ago");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3d ago");
  });
  it("opens as a headerless popover with a recents section", async () => {
    vi.useFakeTimers({ now, toFake: ["Date"] });
    const view = await render("");
    vi.useRealTimers();
    expect(view.querySelector(".desktop-dialog")).toBeNull();
    expect(view.querySelector("dialog.quick-search h3")?.textContent).toBe(
      "Recents",
    );
    expect(view.querySelector("input")?.placeholder).toBe("Search");
    const main = view.querySelectorAll(".search-results [role=option]")[1];
    expect(main.querySelector(".search-detail")?.textContent).toBe(
      "See you tomorrow·50m ago",
    );
  });
  it("moves with the arrow keys and runs the active row on Return", async () => {
    const onChat = vi.fn();
    const onWrite = vi.fn();
    const onClose = vi.fn();
    const view = await render("ta", { onChat, onWrite }, onClose);
    const input = view.querySelector("input")!;
    const selected = () =>
      view.querySelector("[aria-selected=true] .search-title")?.textContent;
    expect(selected()).toBe("Tax questions");
    const key = (value: string) =>
      act(async () => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: value, bubbles: true }),
        );
      });
    await key("ArrowDown");
    expect(selected()).not.toBe("Tax questions");
    await key("ArrowUp");
    await key("Enter");
    expect(onClose).toHaveBeenCalled();
    expect(onChat).toHaveBeenCalledWith("s2");
    expect(onWrite).not.toHaveBeenCalled();
  });
  it("translates its copy", () => {
    for (const [, key] of readFileSync("macos/ui/Palette.tsx", "utf8").matchAll(
      /\bt\(\s*"([^"]+)"/g,
    ))
      expect(zhCN[key], key).toBeTruthy();
  });
});
