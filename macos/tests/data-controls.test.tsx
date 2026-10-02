import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import { zhCN } from "../../shared/locales/zh-CN";
import type { AgentEvent } from "../../shared/types";
import { agentDataMarkdown, memoryImportDraft } from "../ui/dataExport";
import { DataControls } from "../ui/DataControls";
import { DesktopApp } from "../ui/DesktopApp";

vi.mock("../../src/useTask", () => {
  const refresh = async () => {};
  return {
    useTask: () => ({
      events: [],
      session: undefined,
      loading: false,
      error: "",
      connected: false,
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
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
});
const text = (id: string, type: string, value: string, extra = {}) =>
  ({
    id,
    type,
    content: [{ type: "text", text: value }],
    ...extra,
  }) as AgentEvent;
async function signedIn() {
  const client = new Client({
    database: new LocalDatabase(`mac-data-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `data-${crypto.randomUUID()}`,
          project: "test",
        }),
      write: async () => {},
    },
  });
  await client.restore();
  vi.spyOn(client, "companionIdentity").mockResolvedValue(defaultIdentity());
  vi.spyOn(client, "goals").mockResolvedValue({
    data: [
      {
        id: "g",
        title: "Run a 10k",
        description: "",
        status: "active",
        steps: [],
        created_at: "",
        updated_at: "",
      },
    ],
    revision: "r",
  });
  vi.spyOn(client, "upcoming").mockRejectedValue(new Error("unreadable"));
  vi.spyOn(client, "sessions").mockResolvedValue({
    data: [{ id: "main", title: "x" }],
  } as Awaited<ReturnType<Client["sessions"]>>);
  vi.spyOn(client, "conversationIndex").mockResolvedValue({
    mainId: "main",
    entries: {},
  });
  vi.spyOn(client, "events").mockResolvedValue([
    text("w", "user.message", "<open-muse-welcome>", {
      app_initiation: "welcome",
    }),
    text("u", "user.message", "Plan my week"),
    text("a", "agent.message", "Here is your plan"),
  ] as never);
  return client;
}

describe("Mac data controls", () => {
  it("gathers memory, goals and conversations without app prompts", async () => {
    const markdown = await agentDataMarkdown(await signedIn(), "Muse");
    expect(markdown).toContain("### MEMORY.md");
    expect(markdown).toContain("- Run a 10k (active)");
    expect(markdown).toContain("### Main chat");
    expect(markdown).toContain("**Me:** Plan my week");
    expect(markdown).toContain("**Muse:** Here is your plan");
    expect(markdown).not.toContain("open-muse-welcome");
  });
  it("hands an imported memory to the main chat as a draft", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museWindow: { postMessage } } },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(<DataControls client={await signedIn()} />),
    );
    const importButton = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "Import memory",
    )!;
    await act(async () => importButton.click());
    const area = host.querySelector<HTMLTextAreaElement>("dialog textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(area, "Lives in Shanghai. Likes running.");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const draft = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "Draft in main chat",
    )!;
    await act(async () => draft.click());
    expect(postMessage).toHaveBeenCalledWith({
      name: "draft",
      value: memoryImportDraft("Lives in Shanghai. Likes running."),
    });
    expect(host.querySelector("dialog")).toBeNull();
  });
  it("puts a handed-over draft in the main composer without sending it", async () => {
    const client = await signedIn();
    vi.spyOn(client, "config").mockResolvedValue({
      mode: "ark",
    } as Awaited<ReturnType<Client["config"]>>);
    vi.spyOn(client, "startWelcome").mockResolvedValue({ phase: "skipped" });
    vi.spyOn(client, "startCheckIn").mockResolvedValue(undefined);
    vi.spyOn(client, "deliverUpcoming").mockResolvedValue(undefined);
    const send = vi.spyOn(client, "send");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<DesktopApp client={client} />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("muse-draft", { detail: "Remember: I like tea" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector("textarea")!.value).toBe("Remember: I like tea");
    expect(send).not.toHaveBeenCalled();
  });
  it("resets this Mac only after confirming, then hands over to the shell", async () => {
    const client = await signedIn();
    const reset = vi.spyOn(client, "resetDevice").mockResolvedValue();
    const postMessage = vi.fn(async () => true);
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { musePresence: { postMessage } } },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<DataControls client={client} />));
    const button = (label: string) =>
      [...document.querySelectorAll("button")].find(
        (item) => item.textContent === label,
      )!;
    await act(async () => button("Reset this device").click());
    expect(document.body.textContent).toContain(
      "Permissions you gave Open Muse in macOS System Settings stay there.",
    );
    await act(async () => button("Cancel").click());
    expect(reset).not.toHaveBeenCalled();
    await act(async () => button("Reset this device").click());
    const confirm = [...document.querySelectorAll(".pill-button.danger")];
    await act(async () => (confirm.at(-1) as HTMLButtonElement).click());
    expect(reset).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith({ operation: "reset" });
  });
  it("keeps the shell untouched when the page could not reset", async () => {
    const client = await signedIn();
    vi.spyOn(client, "resetDevice").mockRejectedValue(
      new Error("Some data on this device could not be removed."),
    );
    const postMessage = vi.fn(async () => true);
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { musePresence: { postMessage } } },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<DataControls client={client} />));
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((item) => item.textContent === "Reset this device")!
        .click(),
    );
    await act(async () =>
      (
        [...document.querySelectorAll(".pill-button.danger")].at(
          -1,
        ) as HTMLButtonElement
      ).click(),
    );
    expect(postMessage).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Some data on this device could not be removed.",
    );
  });
  it("translates its copy and keeps the native contract", () => {
    for (const file of ["macos/ui/DataControls.tsx", "macos/ui/dataExport.ts"])
      for (const [, key] of readFileSync(file, "utf8").matchAll(
        /\bt\(\s*"([^"]+)"/g,
      ))
        expect(zhCN[key], key).toBeTruthy();
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain(
      'body?["name"] == "draft", message.webView === settingsWebView',
    );
    // Only Settings resets, and the shell clears what it keeps for this Mac.
    expect(swift).toContain(
      'guard sender === settingsWebView else { replyHandler(nil, "Only Settings resets this Mac")',
    );
    expect(swift).toContain("removePersistentDomain(forName: domain)");
    expect(swift).toContain(
      "removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)",
    );
    expect(swift).toContain("try? SMAppService.mainApp.unregister()");
  });
});
