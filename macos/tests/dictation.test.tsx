import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import { zhCN } from "../../shared/locales/zh-CN";
import { DesktopApp } from "../ui/DesktopApp";
import { DictationSettings } from "../ui/DictationSettings";
import { joinDictation, parseDictationState } from "../ui/dictation";

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

function shell(state: Record<string, unknown>) {
  const postMessage = vi.fn(async (body: Record<string, string>) => {
    if (body.operation === "start") state.running = true;
    if (body.operation === "stop") state.running = false;
    if (body.operation === "request") {
      state.microphone = "allowed";
      state.speech = "allowed";
    }
    return { ...state };
  });
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: { messageHandlers: { museDictation: { postMessage } } },
  });
  return postMessage;
}
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
}
async function workspace() {
  const client = new Client({
    database: new LocalDatabase(`mac-dictation-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `dictation-${crypto.randomUUID()}`,
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
  const send = vi.spyOn(client, "send");
  await mount(<DesktopApp client={client} />);
  return send;
}
const speak = (detail: object) =>
  act(async () => {
    window.dispatchEvent(new CustomEvent("muse-dictation", { detail }));
  });
const field = () => host!.querySelector<HTMLTextAreaElement>("textarea")!;
const mic = () => host!.querySelector<HTMLButtonElement>("button.dictate")!;

describe("Mac dictation", () => {
  it("joins dictated text to the draft, without spaces between CJK", () => {
    expect(joinDictation("", "hello")).toBe("hello");
    expect(joinDictation("Note:", "buy milk")).toBe("Note: buy milk");
    expect(joinDictation("Note: ", "buy milk")).toBe("Note: buy milk");
    expect(joinDictation("提醒我", "买牛奶")).toBe("提醒我买牛奶");
    expect(parseDictationState({ microphone: "on" })).toBeUndefined();
  });
  it("asks once for access, streams text into the draft and sends nothing", async () => {
    const post = shell({
      microphone: "not-asked",
      speech: "not-asked",
      onDevice: true,
      running: false,
    });
    const send = await workspace();
    await act(async () => mic().click());
    expect(post).toHaveBeenCalledWith({
      operation: "request",
      language: "en-US",
    });
    expect(post).toHaveBeenCalledWith({
      operation: "start",
      language: "en-US",
    });
    expect(mic().getAttribute("aria-pressed")).toBe("true");
    await speak({ text: "remind me", final: false });
    expect(field().value).toBe("remind me");
    await speak({ text: "remind me to stretch", final: true });
    expect(field().value).toBe("remind me to stretch");
    await speak({ ended: true });
    expect(mic().getAttribute("aria-pressed")).toBe("false");
    expect(send).not.toHaveBeenCalled();
  });
  it("stops with the microphone button or Escape", async () => {
    const post = shell({
      microphone: "allowed",
      speech: "allowed",
      onDevice: false,
      running: false,
    });
    await workspace();
    await act(async () => mic().click());
    await act(async () => mic().click());
    expect(post).toHaveBeenCalledWith({ operation: "stop", cancel: "false" });
    await speak({ ended: true });
    await act(async () => mic().click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(
      post.mock.calls.filter(([body]) => body.operation === "stop"),
    ).toHaveLength(2);
  });
  it("explains denied access instead of listening", async () => {
    const post = shell({
      microphone: "denied",
      speech: "allowed",
      onDevice: true,
      running: false,
    });
    await workspace();
    await act(async () => mic().click());
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "start" }),
    );
    expect(host!.textContent).toContain("Allow the microphone");
  });
  it("shows permissions and where speech is recognized", async () => {
    shell({
      microphone: "allowed",
      speech: "not-asked",
      onDevice: false,
      running: false,
    });
    await mount(<DictationSettings />);
    expect(host!.textContent).toContain("Allowed");
    expect(host!.textContent).toContain("By Apple's speech service");
    expect(
      [...host!.querySelectorAll("button")].map((item) => item.textContent),
    ).toEqual(["Allow"]);
  });
  it("translates its copy and keeps the native contract", () => {
    for (const file of [
      "macos/ui/DictationSettings.tsx",
      "macos/ui/dictation.ts",
    ])
      for (const [, key] of readFileSync(file, "utf8").matchAll(
        /\bt\(\s*"([^"]+)"/g,
      ))
        expect(zhCN[key], key).toBeTruthy();
    const swift = readFileSync("macos/Dictation.swift", "utf8");
    expect(swift).toContain("requiresOnDeviceRecognition = true");
    const plist = readFileSync("macos/Info.plist", "utf8");
    expect(plist).toContain("NSMicrophoneUsageDescription");
    expect(plist).toContain("NSSpeechRecognitionUsageDescription");
    for (const file of ["en", "zh-Hans"])
      expect(
        readFileSync(`macos/${file}.lproj/InfoPlist.strings`, "utf8"),
      ).toContain("NSMicrophoneUsageDescription");
  });
});
