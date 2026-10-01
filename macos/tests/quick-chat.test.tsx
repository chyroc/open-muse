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
  QUICK_MAX_HEIGHT,
  QUICK_MIN_HEIGHT,
  QuickChat,
  quickHeight,
} from "../ui/QuickChat";

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
});

function shell() {
  const postMessage = vi.fn();
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: { messageHandlers: { museWindow: { postMessage } } },
  });
  return postMessage;
}
async function fixture(signedIn: boolean) {
  const client = new Client({
    database: new LocalDatabase(`mac-quick-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("Quick chat must not reach the cloud in this test");
    }),
    vault: {
      read: async () =>
        signedIn
          ? JSON.stringify({
              kind: "api_key",
              apiKey: `quick-${crypto.randomUUID()}`,
              project: "test",
            })
          : "",
      write: async () => {},
    },
  });
  await client.restore();
  vi.spyOn(client, "config").mockResolvedValue({
    mode: signedIn ? "ark" : "demo",
  } as Awaited<ReturnType<Client["config"]>>);
  vi.spyOn(client, "conversationIndex").mockResolvedValue({ entries: {} });
  vi.spyOn(client, "companionIdentity").mockResolvedValue(defaultIdentity());
  return client;
}
async function mount(client: Client) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<QuickChat client={client} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
const composer = () => host!.querySelector<HTMLTextAreaElement>("textarea")!;
async function type(text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(composer(), text);
    composer().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Mac quick chat", () => {
  it("asks the shell for a bounded height", () => {
    expect(quickHeight(10)).toBe(QUICK_MIN_HEIGHT);
    expect(quickHeight(300.4)).toBe(300);
    expect(quickHeight(5000)).toBe(QUICK_MAX_HEIGHT);
  });
  it("sends into the main chat, opening it first when there is none", async () => {
    const post = shell();
    const client = await fixture(true);
    const open = vi
      .spyOn(client, "openConversation")
      .mockResolvedValue({ id: "main-session" } as Awaited<
        ReturnType<Client["openConversation"]>
      >);
    const send = vi.spyOn(client, "send").mockResolvedValue(undefined as never);
    await mount(client);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ name: "quick-size" }),
    );
    await type("Remind me to call Ana");
    await act(async () => {
      composer().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(open).toHaveBeenCalledWith("main", "Main chat");
    expect(send).toHaveBeenCalledWith("main-session", {
      type: "user.message",
      text: "Remind me to call Ana",
    });
    expect(composer().value).toBe("");
    expect(post).toHaveBeenCalledWith({ name: "quick-sent" });
  });
  it("keeps an unconfirmed message in the composer", async () => {
    shell();
    const client = await fixture(true);
    vi.spyOn(client, "conversationIndex").mockResolvedValue({
      mainId: "main-session",
      entries: {},
    });
    vi.spyOn(client, "send").mockRejectedValue(new Error("Network lost"));
    await mount(client);
    await type("Draft that must survive");
    await act(async () => {
      composer().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(composer().value).toBe("Draft that must survive");
    expect(host!.querySelector("[role=alert]")?.textContent).toBe(
      "Network lost",
    );
  });
  it("routes connection, expansion and Escape through the shell", async () => {
    const post = shell();
    const client = await fixture(false);
    const send = vi.spyOn(client, "send");
    await mount(client);
    expect(composer().disabled).toBe(true);
    const connect = [...host!.querySelectorAll("button")].find(
      (item) => item.textContent === "Connect to Ark MA",
    )!;
    await act(async () => connect.click());
    expect(post).toHaveBeenCalledWith({ name: "settings" });
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open in the main window"]',
        )!
        .click(),
    );
    expect(post).toHaveBeenCalledWith({ name: "workspace" });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(post).toHaveBeenCalledWith({ name: "quick-close" });
    expect(send).not.toHaveBeenCalled();
  });
  it("translates its copy and keeps the shell's shortcut contract", () => {
    const source = readFileSync("macos/ui/QuickChat.tsx", "utf8");
    for (const [, key] of source.matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    // Option-Space is the default until the person records another one.
    expect(swift).toContain("return (UInt32(kVK_Space), UInt32(optionKey))");
    expect(swift).toContain('URL(string: "muse://app/#/quick")');
    expect(swift).toContain("override var canBecomeKey: Bool { true }");
    // Only the quick chat web view may resize or close the card.
    expect(swift).toContain("if message.webView === quickWebView {");
    for (const file of ["en", "zh-Hans"])
      expect(
        readFileSync(`macos/${file}.lproj/Localizable.strings`, "utf8"),
      ).toContain('"Quick chat" =');
  });
});
