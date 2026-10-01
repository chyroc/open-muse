import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { navLabel } from "../ui/labels";
import { refreshIdeasLabel, statusTabLabel, viewIdeaLabel } from "../ui/labels";

afterEach(() => vi.unstubAllGlobals());

// Keys this Mac build renamed in place. Each must have no consumer outside
// macos/, or another client would silently inherit the desktop wording.
const renamed = [
  "Open chats and side chats",
  "Search Library",
  "Save reply to library",
  "Library navigation",
  "Choose Library section",
  "Remove from Library",
  "Remove from Library?",
  "{count} removed from Library",
  "Connect to view your Library",
  "Loading Library…",
  "Opening Library…",
  "Library could not load",
  "The connection changed. Reopen Library before continuing.",
];
// Keys other clients share. Their wording must not move with the Mac rail.
const shared: Record<string, string> = {
  Chat: "对话",
  Ideas: "灵感",
  Library: "资料库",
  "Saved to Library": "已保存到资料库",
  "Refresh Library": "刷新资料库",
};

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : sources(file);
    return /\.tsx?$/.test(file) ? [file] : [];
  });
}

describe("Mac navigation labels", () => {
  it("reads as the desktop wording in Chinese and the source wording in English", () => {
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    expect([navLabel("chat"), navLabel("ideas"), navLabel("library")]).toEqual([
      "聊天",
      "点子",
      "资源库",
    ]);
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["en-US"]);
    // Never a disambiguation key such as "Chat tab".
    expect([navLabel("chat"), navLabel("ideas"), navLabel("library")]).toEqual([
      "Chat",
      "Ideas",
      "Library",
    ]);
    expect(refreshIdeasLabel()).toBe("Refresh ideas");
    expect(viewIdeaLabel("A title")).toBe("View idea: A title");
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    expect(refreshIdeasLabel()).toBe("刷新点子");
    expect(viewIdeaLabel("A title")).toBe("查看点子：A title");
    expect([statusTabLabel("activity"), statusTabLabel("approvals")]).toEqual([
      "动态",
      "批准",
    ]);
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["en-US"]);
    expect([statusTabLabel("activity"), statusTabLabel("approvals")]).toEqual([
      "Activity",
      "Approvals",
    ]);
  });
  it("keeps the renamed catalog entries Mac-only", () => {
    const outside = [
      ...sources("src"),
      ...sources("ios"),
      ...sources("shared"),
      ...sources("tests"),
    ].map((file) => [file, readFileSync(file, "utf8")] as const);
    for (const key of renamed) {
      expect(Object.hasOwn(zhCN, key), key).toBe(true);
      const consumers = outside
        .filter(([, text]) => text.includes(`t("${key}"`))
        .map(([file]) => file);
      expect(consumers, key).toEqual([]);
    }
  });
  it("leaves the wording the other clients depend on untouched", () => {
    // The main chat pill names the same section as the rail that opens it.
    expect(zhCN["Open chats and side chats"]).toContain("聊天");
    // The feature keeps one name across its own surfaces.
    for (const key of [
      "Opening ideas…",
      "Loading ideas",
      "No ideas yet.",
      "Featured ideas",
      "Idea dismissed",
      "More ideas",
      "Idea feedback",
    ])
      expect(zhCN[key], key).toContain("点子");
    for (const key of ["Open side-by-side chat", "Close side-by-side chat"])
      expect(zhCN[key], key).toContain("聊天");
    // The status panel and the identity cards follow the same rule.
    expect(zhCN.Upcoming).toBe("即将到来");
    expect(zhCN.MEMORY).toBe("记忆");
    expect(zhCN.SOUL).toBe("SOUL");
    expect(zhCN["Open chats and side chats"]).toBe("打开聊天和旁聊");
    for (const [key, value] of Object.entries(shared))
      expect(zhCN[key], key).toBe(value);
    for (const key of ["Chat tab", "Ideas tab", "Library tab"])
      expect(Object.hasOwn(zhCN, key), key).toBe(true);
  });
});
