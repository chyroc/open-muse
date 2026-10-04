import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import { zhCN } from "../../shared/locales/zh-CN";
import type { AgentEvent } from "../../shared/types";
import { DesktopApp } from "../ui/DesktopApp";
import { shortcuts } from "../ui/Shortcuts";

const fixtureTask = vi.hoisted(() => ({ events: [] as AgentEvent[] }));
vi.mock("../../src/useTask", () => {
  const refresh = async () => {};
  return {
    useTask: (_client: unknown, id?: string) => ({
      events: id === "main" ? fixtureTask.events : [],
      session: id ? { id, status: "running" } : undefined,
      loading: false,
      error: "",
      connected: true,
      autoApprovalFailures: [],
      refresh,
    }),
  };
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  fixtureTask.events = [];
  location.hash = "";
  localStorage.clear();
});
async function mount() {
  const client = new Client({
    database: new LocalDatabase(`mac-shortcuts-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `shortcuts-${crypto.randomUUID()}`,
          project: "test",
        }),
      write: async () => {},
    },
  });
  await client.restore();
  vi.spyOn(client, "config").mockResolvedValue({
    mode: "ark",
  } as Awaited<ReturnType<Client["config"]>>);
  vi.spyOn(client, "sessions").mockResolvedValue({ data: [] });
  vi.spyOn(client, "conversationIndex").mockResolvedValue({
    mainId: "main",
    entries: {},
  });
  vi.spyOn(client, "companionIdentity").mockResolvedValue(defaultIdentity());
  vi.spyOn(client, "goals").mockResolvedValue({ data: [], revision: "r" });
  vi.spyOn(client, "startWelcome").mockResolvedValue({ phase: "skipped" });
  vi.spyOn(client, "startCheckIn").mockResolvedValue(undefined);
  vi.spyOn(client, "deliverUpcoming").mockResolvedValue(undefined);
  const send = vi.spyOn(client, "send").mockResolvedValue({ data: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<DesktopApp client={client} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  return send;
}
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

describe("Mac rail menu and shortcuts", () => {
  it("opens settings and the shortcut list from the rail menu", async () => {
    await mount();
    const trigger = host!.querySelector<HTMLButtonElement>(".rail-settings")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => trigger.click());
    const items = [...host!.querySelectorAll(".rail-menu button")];
    expect(items.map((item) => item.textContent)).toEqual([
      "Keyboard shortcuts⌘/",
      "Settings⌘,",
    ]);
    await act(async () => (items[0] as HTMLButtonElement).click());
    expect(host!.querySelector(".rail-menu")).toBeNull();
    expect(host!.querySelector(".shortcuts-dialog")?.textContent).toContain(
      "Search chats",
    );
  });
  it("answers Command-slash, Shift-Escape and Escape", async () => {
    fixtureTask.events = [
      {
        id: "u",
        type: "user.message",
        content: [{ type: "text", text: "Hi" }],
      },
      { id: "r", type: "session.status_running" },
    ];
    const send = await mount();
    await press("/", { metaKey: true });
    expect(host!.querySelector(".shortcuts-dialog")).toBeTruthy();
    // Escape closes the dialog first and stops nothing.
    await act(async () => {
      host!
        .querySelector("dialog")!
        .dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    await press("Escape");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("main", { type: "user.interrupt" });
    await press("Escape", { shiftKey: true });
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps the status panel closed until the companion opens it", async () => {
    await mount();
    expect(host!.querySelector(".status-panel")).toBeNull();
    const avatar = host!.querySelector<HTMLButtonElement>(".toolbar-avatar")!;
    expect(avatar.textContent).toContain("Muse");
    // This fixture's session is running, so the companion says it is working.
    expect(avatar.querySelector(".companion-state")?.textContent).toBe(
      "Working",
    );
    await act(async () => avatar.click());
    expect(host!.querySelector(".status-panel")).toBeTruthy();
    expect(host!.querySelector(".status-line.is-busy")).toBeTruthy();
    expect(host!.querySelector(".toolbar-avatar")).toBeNull();
    expect(localStorage.getItem("open-muse.status-panel.open")).toBe("true");
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!
        .click(),
    );
    expect(host!.querySelector(".toolbar-avatar")).toBeTruthy();
    expect(localStorage.getItem("open-muse.status-panel.open")).toBe("false");
  });
  it("opens side chats from the rail's edge by a click or a pull", async () => {
    await mount();
    const edge = () =>
      host!.querySelector<HTMLElement>(".rail-edge .panel-edge")!;
    const pointer = (type: string, x: number) =>
      act(async () => {
        edge().dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            isPrimary: true,
            clientX: x,
            clientY: 300,
          }),
        );
      });
    expect(host!.querySelector(".chat-drawer")).toBeNull();
    await act(async () =>
      host!
        .querySelector(".rail-edge")!
        .dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, clientY: 300 }),
        ),
    );
    expect(host!.querySelector(".rail-edge-hint")?.textContent).toBe(
      "Side chatsClick or drag to open",
    );
    await pointer("pointerdown", 78);
    await pointer("pointermove", 128);
    const pull = host!.querySelector<HTMLElement>(".chat-drawer-pull")!;
    expect(pull.style.width).toBe("50px");
    expect(host!.querySelector(".rail-edge-hint")).toBeNull();
    // Too short a pull springs back.
    await pointer("pointerup", 128);
    expect(host!.querySelector(".chat-drawer")).toBeNull();
    await pointer("pointerdown", 78);
    await pointer("pointermove", 160);
    await pointer("pointerup", 160);
    expect(host!.querySelector(".chat-drawer")).toBeTruthy();
    expect(host!.querySelector(".chat-drawer-pull")).toBeNull();
    expect(host!.querySelector(".rail-edge")).toBeNull();
  });
  it("translates every shortcut", () => {
    for (const { label } of shortcuts) expect(zhCN[label], label).toBeTruthy();
  });
});
