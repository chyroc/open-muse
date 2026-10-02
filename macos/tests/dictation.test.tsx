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
    if (body.operation === "device") state.device = body.device;
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
  vi.spyOn(client, "openConversation").mockResolvedValue({
    id: "main",
  } as Awaited<ReturnType<Client["openConversation"]>>);
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
      cues: "true",
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
  it("sends the dictated message when automatic send is on", async () => {
    localStorage.setItem(
      "muse.dictation",
      JSON.stringify({ autoSend: true, cues: false }),
    );
    const post = shell({
      microphone: "allowed",
      speech: "allowed",
      onDevice: true,
      running: false,
    });
    const send = await workspace();
    send.mockResolvedValue({ data: [] });
    await act(async () => mic().click());
    expect(post).toHaveBeenCalledWith({
      operation: "start",
      language: "en-US",
      cues: "false",
    });
    await speak({ text: "call mom at six", final: true });
    await speak({ ended: true });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(send).toHaveBeenCalledWith(
      "main",
      expect.objectContaining({ text: "call mom at six" }),
    );
    localStorage.removeItem("muse.dictation");
  });
  it("does not send when dictation ends with an error", async () => {
    localStorage.setItem("muse.dictation", JSON.stringify({ autoSend: true }));
    shell({
      microphone: "allowed",
      speech: "allowed",
      onDevice: true,
      running: false,
    });
    const send = await workspace();
    await act(async () => mic().click());
    await speak({ text: "half a sentence", final: false });
    await speak({ ended: true, error: "Dictation stopped." });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(send).not.toHaveBeenCalled();
    expect(field().value).toBe("half a sentence");
    localStorage.removeItem("muse.dictation");
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
  it("leads with its permissions and waits for both", async () => {
    const post = shell({
      microphone: "allowed",
      speech: "not-asked",
      onDevice: false,
      running: false,
    });
    await mount(<DictationSettings />);
    expect(host!.textContent).toContain("Microphone granted");
    expect(
      [...host!.querySelectorAll(".settings-link")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Turn off in System Settings", "Open System Settings"]);
    // Speech recognition has not been asked yet, so the controls wait.
    expect(
      host!
        .querySelector(".permission-settings-controls")!
        .getAttribute("data-disabled"),
    ).toBe("true");
    const switches = () => [
      ...host!.querySelectorAll<HTMLInputElement>("input[role=switch]"),
    ];
    expect(switches().every((item) => item.disabled)).toBe(true);
    expect(host!.textContent).toContain("macOS sends dictated audio to Apple");
    // The first press asks macOS instead of opening System Settings.
    await act(async () =>
      [
        ...host!.querySelectorAll<HTMLButtonElement>(".settings-link"),
      ][1].click(),
    );
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "request" }),
    );
    expect(switches().map((item) => item.checked)).toEqual([false, true]);
    expect(switches().every((item) => !item.disabled)).toBe(true);
    await act(async () => switches()[0].click());
    expect(JSON.parse(localStorage.getItem("muse.dictation")!)).toEqual({
      autoSend: true,
      cues: true,
    });
    localStorage.removeItem("muse.dictation");
  });
  it("picks a microphone and follows the system input by default", async () => {
    const post = shell({
      microphone: "allowed",
      speech: "allowed",
      onDevice: true,
      running: false,
      device: "gone-usb",
      devices: [
        { id: "BuiltInMicrophoneDevice", name: "MacBook Pro Microphone" },
        { id: "usb-1", name: "Desk Mic" },
      ],
    });
    await mount(<DictationSettings />);
    const select = host!.querySelector<HTMLSelectElement>("select")!;
    // A saved microphone that is not connected shows as the system input.
    expect(select.value).toBe("");
    expect([...select.options].map((item) => item.textContent)).toEqual([
      "System default",
      "MacBook Pro Microphone",
      "Desk Mic",
    ]);
    await act(async () => {
      select.value = "usb-1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(post).toHaveBeenLastCalledWith({
      operation: "device",
      language: "en-US",
      device: "usb-1",
    });
    expect(select.value).toBe("usb-1");
  });
  it("reads only well-formed microphones from the shell", () => {
    const base = {
      microphone: "allowed",
      speech: "allowed",
      onDevice: true,
      running: false,
    };
    expect(parseDictationState(base)).toMatchObject({
      device: "",
      devices: [],
    });
    expect(
      parseDictationState({
        ...base,
        device: 4,
        devices: [{ id: "a", name: "A" }, { id: "", name: "B" }, "c", null],
      }),
    ).toMatchObject({ device: "", devices: [{ id: "a", name: "A" }] });
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
    expect(swift).toContain("kAudioOutputUnitProperty_CurrentDevice");
    const shellSource = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(shellSource).toContain('case "device":');
    expect(readFileSync("scripts/build-macos.mjs", "utf8")).toContain(
      '"CoreAudio"',
    );
    const plist = readFileSync("macos/Info.plist", "utf8");
    expect(plist).toContain("NSMicrophoneUsageDescription");
    expect(plist).toContain("NSSpeechRecognitionUsageDescription");
    for (const file of ["en", "zh-Hans"])
      expect(
        readFileSync(`macos/${file}.lproj/InfoPlist.strings`, "utf8"),
      ).toContain("NSMicrophoneUsageDescription");
  });
});
