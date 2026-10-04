import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import { zhCN } from "../../shared/locales/zh-CN";
import {
  readShortcut,
  resetShortcut,
  saveShortcut,
  shortcutSet,
} from "../ui/shortcut";
import { DictationSettings } from "../ui/DictationSettings";
import { QuickChat } from "../ui/QuickChat";
import { vaultAccount } from "./account";

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

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
  localStorage.removeItem("muse.dictation");
});

type Handlers = Record<string, { postMessage: (body: never) => unknown }>;
function bridges(handlers: Handlers) {
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: { messageHandlers: handlers },
  });
}
const allowed = {
  microphone: "allowed",
  speech: "allowed",
  onDevice: true,
  running: false,
};
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
const button = (label: string) =>
  [...host!.querySelectorAll("button")].find(
    (item) =>
      item.textContent === label || item.getAttribute("aria-label") === label,
  )!;
const shellEvent = (name: string, detail: unknown) =>
  act(async () => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("Mac dictation shortcuts", () => {
  it("names the shortcut on each request, except Quick Chat", async () => {
    const postMessage = vi.fn(async (_body: Record<string, string>) => ({
      code: -1,
      modifiers: 0,
      registered: false,
    }));
    bridges({ museShortcut: { postMessage } });
    const unset = await readShortcut("dictationHold");
    expect(shortcutSet(unset)).toBe(false);
    await saveShortcut(49, 4096, "dictationToggle");
    await resetShortcut("dictationHold");
    await readShortcut();
    expect(postMessage.mock.calls.map(([body]) => body)).toEqual([
      { operation: "read", id: "dictationHold" },
      {
        operation: "write",
        code: "49",
        modifiers: "4096",
        id: "dictationToggle",
      },
      { operation: "reset", id: "dictationHold" },
      { operation: "read" },
    ]);
  });

  it("records push to talk and hands-free in Dictation settings", async () => {
    const stored: Record<string, { code: number; modifiers: number }> = {};
    const shortcut = vi.fn(async (body: Record<string, string>) => {
      const id = body.id ?? "quickChat";
      if (body.operation === "write")
        stored[id] = {
          code: Number(body.code),
          modifiers: Number(body.modifiers),
        };
      if (body.operation === "reset") delete stored[id];
      const keys = stored[id];
      return keys
        ? { ...keys, registered: true }
        : { code: -1, modifiers: 0, registered: false };
    });
    bridges({
      museShortcut: { postMessage: shortcut },
      museDictation: { postMessage: async () => ({ ...allowed }) },
    });
    await mount(<DictationSettings />);
    expect(host!.textContent).toContain("Push to talk");
    expect(host!.textContent).toContain("Hands-free mode");
    const field = button("Change the Push to talk shortcut");
    expect(field.textContent).toBe("Record shortcut");
    await act(async () => field.click());
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(shortcut).toHaveBeenCalledWith({
      operation: "write",
      code: "49",
      modifiers: "4096",
      id: "dictationHold",
    });
    expect(button("Change the Push to talk shortcut").textContent).toBe(
      "⌃Space",
    );
    await act(async () => button("Remove").click());
    expect(shortcut).toHaveBeenLastCalledWith({
      operation: "reset",
      id: "dictationHold",
    });
    expect(button("Change the Push to talk shortcut").textContent).toBe(
      "Record shortcut",
    );
  });

  it("listens in Quick Chat while the shortcut is held, then sends", async () => {
    localStorage.setItem(
      "muse.dictation",
      JSON.stringify({ autoSend: true, cues: false }),
    );
    const windowPosts: object[] = [];
    const dictation = vi.fn(async (body: Record<string, string>) => ({
      ...allowed,
      running: body.operation === "start",
    }));
    bridges({
      museWindow: { postMessage: (body: object) => windowPosts.push(body) },
      museDictation: { postMessage: dictation },
    });
    const client = new Client({
      database: new LocalDatabase(`mac-quick-dictate-${crypto.randomUUID()}`),
      fetcher: vi.fn(async () => {
        throw new Error("This test must not reach the cloud");
      }),
      account: vaultAccount(async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `quick-${crypto.randomUUID()}`,
          project: "test",
        }),
      ),
    });
    await client.restore();
    vi.spyOn(client, "config").mockResolvedValue({
      mode: "ark",
    } as Awaited<ReturnType<Client["config"]>>);
    vi.spyOn(client, "conversationIndex").mockResolvedValue({
      mainId: "main",
      entries: {},
    });
    vi.spyOn(client, "companionIdentity").mockResolvedValue(defaultIdentity());
    const send = vi.spyOn(client, "send").mockResolvedValue(undefined as never);
    await mount(<QuickChat client={client} />);
    // The card tells the shell it can take a pending shortcut.
    expect(windowPosts).toContainEqual({ name: "quick-ready" });
    await shellEvent("muse-quick-dictate", "start");
    expect(dictation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "start" }),
    );
    expect(button("Stop dictation").getAttribute("aria-pressed")).toBe("true");
    await shellEvent("muse-dictation", { text: "Book a table", final: false });
    expect(host!.querySelector("textarea")!.value).toBe("Book a table");
    await shellEvent("muse-quick-dictate", "stop");
    expect(dictation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "stop", cancel: "false" }),
    );
    await shellEvent("muse-dictation", { ended: true });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(send).toHaveBeenCalledWith("main", {
      type: "user.message",
      text: "Book a table",
    });
  });

  it("stops a push to talk released before listening started", async () => {
    let finishStart: () => void = () => {};
    const dictation = vi.fn(async (body: Record<string, string>) => {
      if (body.operation === "start")
        await new Promise<void>((resolve) => (finishStart = resolve));
      return { ...allowed, running: body.operation === "start" };
    });
    bridges({
      museWindow: { postMessage: () => {} },
      museDictation: { postMessage: dictation },
    });
    const client = new Client({
      database: new LocalDatabase(`mac-quick-race-${crypto.randomUUID()}`),
      fetcher: vi.fn(async () => {
        throw new Error("This test must not reach the cloud");
      }),
    });
    await client.restore();
    await mount(<QuickChat client={client} />);
    await shellEvent("muse-quick-dictate", "start");
    await shellEvent("muse-quick-dictate", "stop");
    expect(
      dictation.mock.calls.filter(([body]) => body.operation === "stop"),
    ).toHaveLength(0);
    await act(async () => {
      finishStart();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(dictation).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: "stop", cancel: "false" }),
    );
  });

  it("translates its copy and keeps the native hot key contract", () => {
    for (const file of [
      "macos/ui/DictationSettings.tsx",
      "macos/ui/ShortcutSettings.tsx",
      "macos/ui/QuickChat.tsx",
      "macos/ui/useDictation.ts",
    ])
      for (const [, key] of readFileSync(file, "utf8").matchAll(
        /\bt\(\s*"([^"]+)"/g,
      ))
        expect(zhCN[key], key).toBeTruthy();
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    // Releases are delivered too, so push to talk stops when the key goes up.
    expect(swift).toContain("UInt32(kEventHotKeyReleased)");
    expect(swift).toContain('"dictationHold": HotKey(id: 2');
    expect(swift).toContain('"dictationToggle": HotKey(id: 3');
    expect(swift).toContain("muse-quick-dictate");
    expect(swift).toContain('case "quick-ready":');
    for (const language of ["en", "zh-Hans"])
      expect(
        readFileSync(`macos/${language}.lproj/Localizable.strings`, "utf8"),
      ).toContain('"Another Open Muse shortcut already uses these keys."');
  });
});
