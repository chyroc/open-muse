import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { sideChatDrawerCopy } from "../ui/labels";
import {
  SideChatsPanel,
  clampWidth,
  compactTime,
  keepChatPanelVisible,
  setKeepChatPanelVisible,
  sideChatPanel,
  storeChatPanelWidth,
  storedChatPanelWidth,
} from "../ui/SideChats";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

const now = Date.parse("2026-10-03T12:00:00Z");

async function render(props: Partial<Parameters<typeof SideChatsPanel>[0]>) {
  const handlers = {
    onQuery: vi.fn(),
    onKeepVisible: vi.fn(),
    onWidth: vi.fn(),
    onClose: vi.fn(),
    onOpenMain: vi.fn(),
    onOpenChat: vi.fn(),
    onNewChat: vi.fn(),
    onUnarchive: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <SideChatsPanel
        chats={[]}
        archivedChats={[]}
        mainActive
        drafting={false}
        query=""
        keepVisible={false}
        width={sideChatPanel.width}
        {...handlers}
        {...props}
      />,
    ),
  );
  return { view: host, ...handlers };
}

const click = (element: Element | null | undefined) =>
  act(async () => {
    (element as HTMLElement).click();
  });

describe("Mac side chats panel", () => {
  it("shows only the empty state until there is a side chat", async () => {
    const { view, onNewChat } = await render({});
    expect(view.querySelector(".side-chats-section")).toBeNull();
    expect(view.querySelector(".side-chats-null h3")?.textContent).toBe(
      "Start a side chat",
    );
    await click(view.querySelector(".side-chats-null button"));
    expect(onNewChat).toHaveBeenCalled();
  });
  it("lists the main chat, then side chats newest first", async () => {
    const { view, onOpenChat, onOpenMain } = await render({
      chats: [
        { id: "a", title: "Older", updatedAt: now - 3_600_000 },
        { id: "b", title: "Newer", updatedAt: now - 60_000 },
      ],
      activeId: "b",
      mainActive: false,
    });
    const titles = [...view.querySelectorAll(".side-chat-title")].map(
      (item) => item.textContent,
    );
    expect(titles).toEqual(["Main chat", "Newer", "Older"]);
    expect(
      view.querySelector("[aria-current=page] .side-chat-title")?.textContent,
    ).toBe("Newer");
    expect(view.querySelector(".side-chats-null")).toBeNull();
    await click(view.querySelectorAll(".side-chat-row > button")[2]);
    expect(onOpenChat).toHaveBeenCalledWith("a");
    await click(view.querySelector(".side-chat-row > button"));
    expect(onOpenMain).toHaveBeenCalled();
  });
  it("collapses the side chats section and remembers it", async () => {
    const { view } = await render({ chats: [{ id: "a", title: "One" }] });
    const toggle = view.querySelector<HTMLElement>(
      ".side-chats-section-head h3 button",
    )!;
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      view.querySelector(".side-chats-collapse")?.getAttribute("data-expanded"),
    ).toBe("false");
    expect(localStorage.getItem("muse.nav-section.side-chats")).toBe("false");
  });
  it("pins the panel and shows archived chats from its options", async () => {
    const { view, onKeepVisible, onUnarchive, onQuery } = await render({
      archivedChats: [{ id: "x", title: "Old trip" }],
    });
    await click(view.querySelector("[aria-label='Side chat options']"));
    await click(view.querySelector("[role=menuitemcheckbox]"));
    expect(onKeepVisible).toHaveBeenCalledWith(true);
    await click(view.querySelector("[aria-label='Side chat options']"));
    await click(view.querySelector("[role=menuitem]"));
    expect(onQuery).toHaveBeenCalledWith("");
    expect(view.querySelector(".side-chats-search")).toBeNull();
    expect(view.querySelector(".side-chats-caption")?.textContent).toBe(
      "Archived chats",
    );
    await click(view.querySelector("[aria-label='Unarchive Old trip']"));
    expect(onUnarchive).toHaveBeenCalledWith("x");
    await click(view.querySelector("[aria-label='Back to chat list']"));
    expect(view.querySelector(".side-chats-search")).not.toBeNull();
  });
  it("filters by title while searching", async () => {
    const { view } = await render({
      chats: [
        { id: "a", title: "Trip to Kyoto" },
        { id: "b", title: "Taxes" },
      ],
      query: "kyo",
    });
    expect(
      [...view.querySelectorAll(".side-chat-title")].map((i) => i.textContent),
    ).toEqual(["Trip to Kyoto"]);
    await act(async () =>
      root!.render(
        <SideChatsPanel
          chats={[]}
          archivedChats={[]}
          mainActive
          drafting={false}
          query="zzz"
          keepVisible={false}
          width={240}
          onQuery={vi.fn()}
          onKeepVisible={vi.fn()}
          onWidth={vi.fn()}
          onClose={vi.fn()}
          onOpenMain={vi.fn()}
          onOpenChat={vi.fn()}
          onNewChat={vi.fn()}
          onUnarchive={vi.fn()}
        />,
      ),
    );
    expect(view.querySelector(".side-chats-none")?.textContent).toBe(
      "No results found",
    );
  });
  it("closes on a click of its edge and resizes on a drag", async () => {
    const { view, onClose, onWidth } = await render({});
    const edge = view.querySelector(".side-chats-edge")!;
    const pointer = (type: string, clientX: number) =>
      act(async () => {
        edge.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            isPrimary: true,
            pointerId: 1,
            clientX,
          }),
        );
      });
    await pointer("pointerdown", 318);
    await pointer("pointerup", 318);
    expect(onClose).toHaveBeenCalledTimes(1);
    await pointer("pointerdown", 318);
    await pointer("pointermove", 398);
    expect(onWidth).toHaveBeenLastCalledWith(320, false);
    await pointer("pointerup", 398);
    expect(onWidth).toHaveBeenLastCalledWith(320, true);
    expect(onClose).toHaveBeenCalledTimes(1);
    await pointer("pointerdown", 318);
    await pointer("pointermove", 200);
    await pointer("pointerup", 200);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("keeps its width and pin on this device", () => {
    expect(storedChatPanelWidth()).toBe(240);
    storeChatPanelWidth(999);
    expect(storedChatPanelWidth()).toBe(420);
    expect(clampWidth(100)).toBe(240);
    expect(keepChatPanelVisible()).toBe(false);
    setKeepChatPanelVisible(true);
    expect(keepChatPanelVisible()).toBe(true);
  });
  it("says compactly when a chat last changed", () => {
    expect(compactTime(now - 30_000, now)).toBe("just now");
    expect(compactTime(now - 5 * 60_000, now)).toBe("5m");
    expect(compactTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(compactTime(now - 3 * 86_400_000, now)).toMatch(/\S/);
  });
  it("uses the desktop wording in Chinese and translates its copy", () => {
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    expect(sideChatDrawerCopy()).toEqual({
      title: "发起旁聊",
      body: "旁聊是按主题整理对话的可选方式。",
      action: "新旁聊",
    });
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["en-US"]);
    expect(sideChatDrawerCopy().title).toBe("Start a side chat");
    for (const [, key] of readFileSync(
      "macos/ui/SideChats.tsx",
      "utf8",
    ).matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
  });
});
