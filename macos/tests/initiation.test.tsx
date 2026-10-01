import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import { digest } from "../../shared/crypto";
import { zhCN } from "../../shared/locales/zh-CN";
import type { AgentEvent } from "../../shared/types";
import { messageParts } from "../ui/ChoiceContent";
import { chatMessages } from "../ui/model";
import { DesktopApp } from "../ui/DesktopApp";
import { SettingsWindow } from "../ui/SettingsWindow";

const fixtureTask = vi.hoisted(() => ({
  events: [] as AgentEvent[],
  status: "idle",
}));
vi.mock("../../src/useTask", () => {
  const refresh = async () => {};
  return {
    useTask: (_client: unknown, id?: string) => ({
      events: id === "main" ? fixtureTask.events : [],
      session: id ? { id, status: fixtureTask.status } : undefined,
      loading: false,
      error: "",
      connected: true,
      autoApprovalFailures: [],
      refresh,
    }),
  };
});

const text = (value: string) => [{ type: "text", text: value }];
const naming = [
  "Hi, I'm your companion. I can help get things done.",
  "```muse-choice",
  JSON.stringify({
    question: "What would you like to call me?",
    options: [
      { id: "kit", label: "Kit" },
      { id: "milo", label: "Milo" },
      { id: "muse", label: "Muse" },
    ],
  }),
  "```",
].join("\n");
const welcomeHistory: AgentEvent[] = [
  {
    id: "init",
    type: "user.message",
    content: text("<open-muse-welcome>…</open-muse-welcome>"),
    app_initiation: "welcome",
  },
  { id: "hello", type: "agent.message", content: text(naming) },
];

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  location.hash = "";
  fixtureTask.events = [];
  fixtureTask.status = "idle";
});
async function fixture() {
  const client = new Client({
    database: new LocalDatabase(`mac-initiation-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `initiation-${crypto.randomUUID()}`,
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
  return client;
}
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
}

describe("Mac persona and check-ins", () => {
  it("hides app-initiated prompts and splits the welcome greeting from its question", () => {
    const shown = chatMessages(welcomeHistory);
    expect(shown.map((event) => event.id)).toEqual(["hello"]);
    expect(
      messageParts(shown, welcomeHistory).map(({ part }) => part),
    ).toEqual(["intro", "choice"]);
    // An ordinary reply with a choice stays in one bubble.
    const ordinary: AgentEvent = {
      id: "later",
      type: "agent.message",
      content: text(naming),
    };
    expect(messageParts([ordinary], [ordinary]).map(({ part }) => part)).toEqual(
      ["all"],
    );
  });
  it("starts the welcome once, then considers a check-in", async () => {
    const client = await fixture();
    const welcome = vi
      .spyOn(client, "startWelcome")
      .mockResolvedValue({ phase: "skipped" });
    const checkIn = vi
      .spyOn(client, "startCheckIn")
      .mockResolvedValue(undefined);
    await mount(<DesktopApp client={client} />);
    expect(welcome).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledTimes(1);
    // Coming back to the window considers a check-in again, not the welcome.
    await act(async () => {
      window.document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(welcome).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledTimes(2);
  });
  it("never starts a check-in while the welcome is unresolved", async () => {
    const client = await fixture();
    vi.spyOn(client, "startWelcome").mockResolvedValue({
      phase: "preparing",
      language: "en",
    });
    const checkIn = vi.spyOn(client, "startCheckIn");
    await mount(<DesktopApp client={client} />);
    expect(checkIn).not.toHaveBeenCalled();
  });
  it("leaves side chats alone", async () => {
    const client = await fixture();
    const welcome = vi.spyOn(client, "startWelcome");
    const checkIn = vi.spyOn(client, "startCheckIn");
    location.hash = "#/chat/side-1";
    await mount(<DesktopApp client={client} />);
    expect(welcome).not.toHaveBeenCalled();
    expect(checkIn).not.toHaveBeenCalled();
  });
  it("answers the naming question with one press", async () => {
    fixtureTask.events = welcomeHistory;
    const client = await fixture();
    vi.spyOn(client, "startWelcome").mockResolvedValue({ phase: "skipped" });
    vi.spyOn(client, "startCheckIn").mockResolvedValue(undefined);
    const answer = vi
      .spyOn(client, "answerChoice")
      .mockResolvedValue(undefined as never);
    await mount(<DesktopApp client={client} />);
    expect(host!.textContent).not.toContain("open-muse-welcome");
    const bubbles = host!.querySelectorAll(".message-bubble");
    expect(bubbles[0].textContent).toContain("I can help get things done");
    expect(bubbles[1].textContent).toContain("What would you like to call me?");
    const milo = host!.querySelector<HTMLButtonElement>(
      '[aria-label="Choose Milo"]',
    )!;
    await act(async () => milo.click());
    expect(answer).toHaveBeenCalledWith(
      "main",
      "hello",
      "milo",
      digest(naming),
    );
  });
  it("offers a device-local check-in switch in settings", async () => {
    const client = await fixture();
    vi.spyOn(client, "checkInState").mockResolvedValue({
      enabled: true,
      records: [],
    });
    const set = vi.spyOn(client, "setCheckIn").mockResolvedValue(undefined as never);
    await mount(<SettingsWindow client={client} />);
    const row = [...host!.querySelectorAll("label")].find((item) =>
      item.textContent?.startsWith("Ask me something when I come back"),
    )!;
    const input = row.querySelector<HTMLInputElement>("input[role=switch]")!;
    expect(input.checked).toBe(true);
    await act(async () => input.click());
    expect(set).toHaveBeenCalledWith(false);
    expect(input.checked).toBe(false);
  });
  it("translates the Mac choice and check-in copy", () => {
    for (const file of ["macos/ui/ChoiceContent.tsx", "macos/ui/CheckInSwitch.tsx"])
      for (const [, key] of readFileSync(file, "utf8").matchAll(
        /\bt\(\s*"([^"]+)"/g,
      ))
        expect(zhCN[key], key).toBeTruthy();
  });
});
