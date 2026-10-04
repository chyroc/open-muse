import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../../src/api";
import type { BackgroundClient } from "../../src/background-client";
import type { BackgroundPost } from "../../shared/background";
import type {
  InspirationItem,
  InspirationSnapshot,
} from "../../shared/inspiration";
import { zhCN } from "../../shared/locales/zh-CN";
import { FeedPage } from "../ui/FeedPage";

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

const local: InspirationItem = {
  id: "local",
  kind: "feed",
  session_id: "generation",
  event_id: "event",
  created_at: "2026-10-02T09:00:00",
  title: "Local post",
  body: "Made on this Mac.",
  emoji: "🌱",
  reason: "You asked.",
  category: "Learning",
  prompt: "Explore",
  sources: [],
  liked: false,
};
const scheduled = (id: string, at: string): BackgroundPost => ({
  id,
  sequence: 1,
  session_id: "background-session",
  event_id: `background-${id}`,
  created_at: Date.parse(at),
  title: `Scheduled ${id}`,
  body: "Prepared while away.",
  emoji: "☕",
  reason: "Your goals.",
  category: "Learning",
  prompt: "Discuss",
  sources: [],
});
function clientStub() {
  const state: InspirationSnapshot = {
    items: [local],
    runs: {},
    instructions: { content: "Keep it concise.", revision: "one" },
    instructionsDismissed: false,
  };
  return {
    identity: {
      value: { apiKey: `test-${crypto.randomUUID()}`, project: "test" },
    },
    signedIn: () => true,
    inspiration: vi.fn(async () => state),
    refreshInspiration: vi.fn(async () => state),
    generateInspiration: vi.fn(async () => state),
    likeInspiration: vi.fn(async () => {}),
  } as unknown as Client;
}
// The account service: the cached copy is read at once, the refresh fails
// (offline) or returns newer posts.
function serviceStub(refresh: () => Promise<BackgroundPost[]>) {
  return {
    configured: () => true,
    connected: () => true,
    accountConnected: () => true,
    restore: vi.fn(async () => {}),
    cachedFeed: vi.fn(async () => ({
      items: [scheduled("cached", "2026-10-01T09:00:00")],
      cursor: 1,
    })),
    refresh: vi.fn(async () => ({ items: await refresh() })),
  } as unknown as BackgroundClient;
}

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});
async function mount(service: BackgroundClient, discuss = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <FeedPage
        client={clientStub()}
        background={service}
        onDiscuss={discuss}
        onConnect={vi.fn()}
        onEditorChange={vi.fn()}
        split={false}
        onToggleChat={vi.fn()}
      />,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
const titles = () =>
  [...host.querySelectorAll("article h3")].map((h) => h.textContent);

describe("Mac feed with scheduled posts", () => {
  it.each(["en", "zh-CN"])(
    "shows cached scheduled posts offline next to local ones in %s",
    async (language) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
      const tr = (text: string) => (language === "zh-CN" ? zhCN[text] : text);
      const discuss = vi.fn();
      await mount(
        serviceStub(async () => {
          throw new Error("offline");
        }),
        discuss,
      );
      expect(titles()).toEqual(["Local post", "Scheduled cached"]);
      const [mine, away] = [...host.querySelectorAll("article")];
      expect(mine.querySelector(`[aria-label="${tr("Love")}"]`)).not.toBeNull();
      expect(away.querySelector(".feed-love")).toBeNull();
      expect(host.textContent).toContain(
        tr(
          "Generated with MA when you ask. Posts prepared on your account's schedule appear here too.",
        ),
      );
      const button = [...away.querySelectorAll("button")].find(
        (item) => item.textContent === tr("Discuss"),
      )!;
      await act(async () => button.click());
      expect(discuss).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "background:cached",
          title: "Scheduled cached",
        }),
      );
    },
  );
  it("orders refreshed posts by time with local ones", async () => {
    await mount(
      serviceStub(async () => [
        scheduled("newest", "2026-10-03T09:00:00"),
        scheduled("cached", "2026-10-01T09:00:00"),
      ]),
    );
    expect(titles()).toEqual([
      "Scheduled newest",
      "Local post",
      "Scheduled cached",
    ]);
  });
});
