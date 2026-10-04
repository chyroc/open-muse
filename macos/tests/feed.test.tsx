import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../../src/api";
import {
  defaultFeedInstructions,
  type InspirationItem,
  type InspirationSnapshot,
} from "../../shared/inspiration";
import { zhCN } from "../../shared/locales/zh-CN";
import { LocalDatabase } from "../../src/direct/storage";
import {
  feedPosts,
  feedPresentationStore,
  emptyFeedPresentation,
  postAge,
  postMoment,
} from "../ui/feed";
import { FeedInstructions } from "../ui/FeedInstructions";
import { FeedPage } from "../ui/FeedPage";
import { DesktopApp } from "../ui/DesktopApp";
import { defaultIdentity } from "../../src/direct/identity";

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
const post = (
  id = "one",
  created_at = "2026-09-30T09:00:00",
): InspirationItem => ({
  id,
  kind: "feed",
  session_id: "generation",
  event_id: "event",
  created_at,
  title: `Post ${id}`,
  body: "A **useful** discovery.",
  emoji: "🌱",
  reason: "You asked about gardens.",
  category: "Learning",
  prompt: "Explore the discovery",
  sources: [{ title: "Source", url: "https://example.com/source" }],
  liked: false,
});
const snapshot = (): InspirationSnapshot => ({
  items: [post(), post("two")],
  runs: {},
  instructions: { content: "Keep it concise.", revision: "revision-one" },
  instructionsDismissed: false,
});
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  location.hash = "";
});
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function button(text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent === text || button.getAttribute("aria-label") === text,
  )!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function edit(text: string) {
  const input = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function clientStub() {
  const state = snapshot();
  return {
    identity: {
      value: { apiKey: `test-${crypto.randomUUID()}`, project: "test-project" },
    },
    signedIn: () => true,
    inspiration: vi.fn(async () => state),
    refreshInspiration: vi.fn(async () => state),
    generateInspiration: vi.fn(async () => state),
    likeInspiration: vi.fn(async (_id: string, _liked: boolean) => {}),
    saveFeedInstructions: vi.fn(async (content: string, _revision: string) => ({
      content,
      revision: "revision-two",
    })),
    config: vi.fn(async () => ({ mode: "ark" })),
    sessions: vi.fn(async () => ({ data: [] })),
    conversationIndex: vi.fn(async () => ({ entries: {}, mainId: undefined })),
    companionIdentity: vi.fn(async () => defaultIdentity()),
    openConversation: vi.fn(async () => ({ id: "main-test" })),
    send: vi.fn(async () => {}),
  };
}
const asClient = (client: ReturnType<typeof clientStub>) =>
  client as unknown as Client;

describe("Mac feed presentation", () => {
  it("lists feed posts newest first without mutating cloud content", () => {
    const items = [
      post("old", "2026-09-29T20:00:00"),
      post("a", "2026-09-30T09:00:00"),
      post("b", "2026-09-30T10:00:00"),
      { ...post("idea"), kind: "ideas" as const },
    ];
    const state = emptyFeedPresentation();
    expect(feedPosts(items, state).map((item) => item.id)).toEqual([
      "b",
      "a",
      "old",
    ]);
    expect(items[1].id).toBe("a");
    expect(
      feedPosts(items, { ...state, hidden: ["b"] }).map((item) => item.id),
    ).toEqual(["a", "old"]);
    expect(feedPosts([post("invalid", "invalid")], state)).toHaveLength(1);
  });
  it("labels a post's age and full moment in both languages", () => {
    const now = Date.parse("2026-10-04T12:00:00");
    expect(postAge(now - 30_000, now)).toBe("just now");
    expect(postAge(now - 9 * 3_600_000, now)).toBe("9h ago");
    expect(postAge(now - 4 * 86_400_000, now)).toBe("4d ago");
    expect(postMoment(Date.parse("2026-10-03T09:05:00"), now)).toMatch(
      /^Saturday, Oct 3 at 9:05\sAM$/,
    );
    expect(postMoment(Date.parse("2025-10-03T09:05:00"), now)).toContain(
      "2025",
    );
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    try {
      expect(postAge(now - 9 * 3_600_000, now)).toBe("9小时前");
      expect(postAge(now - 4 * 86_400_000, now)).toBe("4天前");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("persists moves/removals only within the current account and project", async () => {
    const db = new LocalDatabase(`feed-test-${crypto.randomUUID()}`);
    const one = clientStub();
    const first = feedPresentationStore(asClient(one), db);
    await first.update((state) => ({ ...state, hidden: ["one"] }));
    expect(
      (await feedPresentationStore(asClient(one), db).read()).hidden,
    ).toEqual(["one"]);
    one.identity.value = { ...one.identity.value, project: "other" };
    expect(
      (await feedPresentationStore(asClient(one), db).read()).hidden,
    ).toEqual([]);
    expect(
      (await feedPresentationStore(asClient(clientStub()), db).read()).hidden,
    ).toEqual([]);
  });
  it("opens with reads only, quotes on Discuss, and explains a real post", async () => {
    const client = clientStub();
    const discuss = vi.fn();
    await mount(
      <FeedPage
        client={asClient(client)}
        onDiscuss={discuss}
        onConnect={vi.fn()}
        onEditorChange={vi.fn()}
        split={false}
        onToggleChat={vi.fn()}
      />,
    );
    await settle();
    expect(host.textContent).toContain("Post one");
    expect(client.generateInspiration).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    await click("Discuss");
    expect(discuss).toHaveBeenCalledWith(post());
    await click("Post options");
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    await click("Why I created this");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(host.textContent).toContain("You asked about gardens.");
    expect(
      host.querySelector('a[href="https://example.com/source"]'),
    ).not.toBeNull();
  });
  it("requires a separate generation action and never silently resubmits it", async () => {
    const client = clientStub();
    client.generateInspiration.mockRejectedValueOnce(
      new Error("Submission unconfirmed"),
    );
    await mount(
      <FeedPage
        client={asClient(client)}
        onDiscuss={vi.fn()}
        onConnect={vi.fn()}
        onEditorChange={vi.fn()}
        split={false}
        onToggleChat={vi.fn()}
      />,
    );
    await settle();
    await click("Generate now");
    await settle();
    expect(client.generateInspiration).toHaveBeenCalledExactlyOnceWith("feed");
    expect(host.textContent).toContain("Submission unconfirmed");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await settle();
    expect(client.generateInspiration).toHaveBeenCalledTimes(1);
  });
  it("keeps the built-in prompt on a card and shows the setup state", async () => {
    const client = clientStub();
    const empty: InspirationSnapshot = {
      ...snapshot(),
      items: [],
      instructions: { content: defaultFeedInstructions, revision: "default" },
    };
    client.refreshInspiration.mockResolvedValue(empty);
    client.inspiration.mockResolvedValue(empty);
    await mount(
      <FeedPage
        client={asClient(client)}
        onDiscuss={vi.fn()}
        onConnect={vi.fn()}
        onEditorChange={vi.fn()}
        split={false}
        onToggleChat={vi.fn()}
      />,
    );
    await settle();
    expect(host.textContent).toContain("Your feed prompt");
    expect(host.textContent).toContain(defaultFeedInstructions);
    expect(host.textContent).toContain("Getting your feed ready");
    expect(button("Edit feed instructions")).toBeUndefined();
    expect(button("Generate now")).toBeUndefined();
    await click("Generate");
    await settle();
    expect(client.generateInspiration).toHaveBeenCalledExactlyOnceWith("feed");
  });
  it("offers Generate now in the setup state once the prompt is edited", async () => {
    const client = clientStub();
    const empty: InspirationSnapshot = { ...snapshot(), items: [] };
    client.refreshInspiration.mockResolvedValue(empty);
    await mount(
      <FeedPage
        client={asClient(client)}
        onDiscuss={vi.fn()}
        onConnect={vi.fn()}
        onEditorChange={vi.fn()}
        split={false}
        onToggleChat={vi.fn()}
      />,
    );
    await settle();
    expect(host.textContent).not.toContain("Your feed prompt");
    expect(button("Edit feed instructions")).toBeDefined();
    expect(host.textContent).toContain("Getting your feed ready");
    expect(button("Generate now")).toBeDefined();
  });
  it("removes a post on this Mac from its menu and supports Undo", async () => {
    const client = clientStub();
    await mount(
      <FeedPage
        client={asClient(client)}
        onDiscuss={vi.fn()}
        onConnect={vi.fn()}
        onEditorChange={vi.fn()}
        split={false}
        onToggleChat={vi.fn()}
      />,
    );
    await settle();
    expect(host.querySelectorAll("article")).toHaveLength(2);
    await click("Post options");
    await click("Delete");
    await settle();
    expect(host.querySelectorAll("article")).toHaveLength(1);
    expect(host.textContent).toContain("Post removed from this Mac.");
    await click("Undo");
    await settle();
    expect(host.querySelectorAll("article")).toHaveLength(2);
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe("Mac feed instructions", () => {
  it("shows the built-in default in Chinese without counting it as an edit", async () => {
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    try {
      const client = clientStub();
      await mount(
        <FeedInstructions
          client={asClient(client)}
          initial={{ content: defaultFeedInstructions, revision: "default" }}
          onSaved={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      const field = host.querySelector("textarea")!;
      expect(field.value).toBe(zhCN[defaultFeedInstructions]);
      const save = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === zhCN.Save,
      )!;
      expect(save.disabled).toBe(true);
      expect(client.saveFeedInstructions).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("retains conflicts, reviews without replacement, and guards native close", async () => {
    const client = clientStub();
    const close = vi.fn();
    client.saveFeedInstructions.mockRejectedValueOnce(
      new Error("Revision conflict"),
    );
    await mount(
      <FeedInstructions
        client={asClient(client)}
        initial={snapshot().instructions}
        onSaved={vi.fn()}
        onClose={close}
      />,
    );
    await edit("My draft");
    await click("Save");
    expect(client.saveFeedInstructions).toHaveBeenCalledExactlyOnceWith(
      "My draft",
      "revision-one",
    );
    await click("Review cloud version");
    expect(host.querySelector("textarea")!.value).toBe("My draft");
    expect(
      (window as unknown as Record<string, unknown>)
        .__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__,
    ).toBe(true);
    await click("Cancel");
    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Discard changes?");
  });
  it("deduplicates Command-S and ignores native discard while saving", async () => {
    const client = clientStub();
    const close = vi.fn();
    let finish!: (value: { content: string; revision: string }) => void;
    client.saveFeedInstructions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await mount(
      <FeedInstructions
        client={asClient(client)}
        initial={snapshot().instructions}
        onSaved={vi.fn()}
        onClose={close}
      />,
    );
    await edit("My draft");
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", metaKey: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", metaKey: true }),
      );
      window.dispatchEvent(new Event("muse-discard-document"));
    });
    expect(client.saveFeedInstructions).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(
      (window as unknown as Record<string, unknown>)
        .__OPEN_MUSE_DOCUMENT_SAVING__,
    ).toBe(true);
    await act(async () =>
      finish({ content: "My draft", revision: "revision-two" }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("Feed and main-chat integration", () => {
  it("opens a quoted split chat without a write and sends only on explicit submit", async () => {
    location.hash = "/feed";
    const client = clientStub();
    await mount(<DesktopApp client={asClient(client)} />);
    await settle();
    await click("Discuss");
    expect(host.querySelector(".feed-quote")?.textContent).toContain(
      "Post one",
    );
    expect(client.openConversation).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    await edit("What does this mean?");
    await click("Send");
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.send.mock.calls[0]).toEqual([
      "main-test",
      {
        type: "user.message",
        text: expect.stringContaining("My message:\nWhat does this mean?"),
      },
    ]);
    expect(location.hash).toBe("#/feed");
    expect(host.querySelector(".feed-quote")).toBeNull();
  });
  it("blocks navigation and account commands while instructions are open", async () => {
    location.hash = "/feed";
    await mount(<DesktopApp client={asClient(clientStub())} />);
    await settle();
    await click("Edit feed instructions");
    await edit("Keep this draft");
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("muse-command", { detail: "settings" }),
      ),
    );
    expect(host.textContent).toContain("Your draft is preserved");
    await act(async () => {
      location.hash = "/ideas";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(host.querySelector("textarea")!.value).toBe("Keep this draft");
    expect(location.hash).toBe("#/feed");
  });
});
