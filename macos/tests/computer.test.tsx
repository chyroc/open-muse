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
import {
  MAC_TOOLS,
  declinedResult,
  describeCall,
  runMacTool,
} from "../ui/computer";
import { ComputerSettings } from "../ui/ComputerSettings";
import { DesktopApp } from "../ui/DesktopApp";

const fixtureTask = vi.hoisted(() => ({ events: [] as AgentEvent[] }));
vi.mock("../../src/useTask", () => {
  const refresh = async () => {};
  return {
    useTask: (_client: unknown, id?: string) => ({
      events: id === "main" ? fixtureTask.events : [],
      session: id ? { id, status: "idle" } : undefined,
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
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
});

const call = (id: string, name: string, input: unknown): AgentEvent => ({
  id,
  type: "agent.custom_tool_use",
  name,
  input,
});
const waiting = (ids: string[]): AgentEvent => ({
  id: `idle-${ids.join("-")}`,
  type: "session.status_idle",
  stop_reason: { type: "requires_action", event_ids: ids },
});
function shell(enabled = true) {
  const postMessage = vi.fn(async (body: Record<string, string>) => {
    if (body.operation === "run")
      return {
        ok: true,
        text: '{"ok":true,"width":1366}',
        image: "QUJD",
      };
    return { enabled, accessibility: true, screen: false };
  });
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: { messageHandlers: { museComputer: { postMessage } } },
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
async function client() {
  const value = new Client({
    database: new LocalDatabase(`mac-computer-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `computer-${crypto.randomUUID()}`,
          project: "test",
        }),
      write: async () => {},
    },
  });
  await value.restore();
  vi.spyOn(value, "config").mockResolvedValue({
    mode: "ark",
  } as Awaited<ReturnType<Client["config"]>>);
  vi.spyOn(value, "sessions").mockResolvedValue({ data: [] });
  vi.spyOn(value, "conversationIndex").mockResolvedValue({
    mainId: "main",
    entries: {},
  });
  vi.spyOn(value, "companionIdentity").mockResolvedValue(defaultIdentity());
  vi.spyOn(value, "goals").mockResolvedValue({ data: [], revision: "r" });
  vi.spyOn(value, "startWelcome").mockResolvedValue({ phase: "skipped" });
  vi.spyOn(value, "startCheckIn").mockResolvedValue(undefined);
  return value;
}
const button = (label: string) =>
  [...host!.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  )!;

describe("Mac computer use", () => {
  it("describes each call in plain words", () => {
    expect(describeCall(call("a", "mac_screenshot", {}))).toBe(
      "Look at your screen",
    );
    expect(
      describeCall(
        call("b", "mac_action", { action: "click", x: 10.4, y: 20 }),
      ),
    ).toBe("Click at 10, 20");
    expect(
      describeCall(call("c", "mac_action", { action: "key", keys: "cmd+c" })),
    ).toBe("Press cmd+c");
    expect(describeCall(call("d", "mac_open", { target: "Safari" }))).toBe(
      "Open Safari",
    );
    expect(describeCall(call("e", "other_tool", {}))).toBe("Use your Mac");
  });
  it("always produces a result, and only sends valid images", async () => {
    const screenshot = call("s", "mac_screenshot", {});
    const outside = await runMacTool(screenshot);
    expect(outside.is_error).toBe(true);
    const post = shell();
    const ran = await runMacTool(screenshot);
    expect(post).toHaveBeenCalledWith({
      operation: "run",
      tool: "mac_screenshot",
      input: "{}",
    });
    expect(ran.is_error).toBe(false);
    expect(ran.content).toEqual([
      { type: "text", text: '{"ok":true,"width":1366}' },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
      },
    ]);
    const unknown = await runMacTool(call("u", "rm_rf", {}));
    expect(unknown.is_error).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(declinedResult(screenshot)).toMatchObject({
      custom_tool_use_id: "s",
      is_error: true,
    });
  });
  it("turns computer use on and asks macOS for the missing permission", async () => {
    const post = shell(false);
    await mount(<ComputerSettings />);
    const toggle = host!.querySelector<HTMLInputElement>("input[role=switch]")!;
    expect(toggle.checked).toBe(false);
    await act(async () => toggle.click());
    expect(post).toHaveBeenCalledWith({ operation: "enable", value: "true" });
    // Accessibility is granted; Screen Recording is not.
    expect(host!.textContent).toContain("Allowed");
    await act(async () => button("Open System Settings").click());
    expect(post).toHaveBeenCalledWith({ operation: "request", kind: "screen" });
  });
  it("keeps the screen awake and blocks apps from settings", async () => {
    let state = {
      enabled: true,
      accessibility: true,
      screen: true,
      keepAwake: false,
      blocked: [] as { id: string; name: string }[],
    };
    const postMessage = vi.fn(async (body: Record<string, string>) => {
      if (body.operation === "keep-awake")
        state = { ...state, keepAwake: body.value === "true" };
      if (body.operation === "block-app")
        state = {
          ...state,
          blocked: [{ id: "com.example.bank", name: "Bank" }],
        };
      if (body.operation === "unblock-app")
        state = {
          ...state,
          blocked: state.blocked.filter((app) => app.id !== body.id),
        };
      return state;
    });
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museComputer: { postMessage } } },
    });
    await mount(<ComputerSettings />);
    const awake = [...host!.querySelectorAll("label")]
      .find((item) => item.textContent?.startsWith("Keep screen awake"))!
      .querySelector<HTMLInputElement>("input")!;
    await act(async () => awake.click());
    expect(postMessage).toHaveBeenCalledWith({
      operation: "keep-awake",
      value: "true",
    });
    await act(async () => button("Add app").click());
    expect(host!.textContent).toContain("Bank");
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>('[aria-label="Unblock Bank"]')!
        .click(),
    );
    expect(postMessage).toHaveBeenCalledWith({
      operation: "unblock-app",
      id: "com.example.bank",
    });
    expect(host!.textContent).not.toContain("Bank");
  });
  it("runs a call only after approval and answers it once", async () => {
    const post = shell();
    fixtureTask.events = [
      call("shot", "mac_screenshot", {}),
      waiting(["shot"]),
    ];
    const value = await client();
    const answer = vi
      .spyOn(value, "answerCustomTools")
      .mockResolvedValue({ data: [] });
    await mount(<DesktopApp client={value} />);
    expect(host!.textContent).toContain("Your assistant wants to use this Mac");
    expect(host!.textContent).toContain("Look at your screen");
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "run" }),
    );
    await act(async () => button("Allow once").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer.mock.calls[0][0]).toBe("main");
    expect(answer.mock.calls[0][1][0]).toMatchObject({
      custom_tool_use_id: "shot",
      is_error: false,
    });
  });
  it("declines without touching the Mac", async () => {
    const post = shell();
    fixtureTask.events = [
      call("open", "mac_open", { target: "Terminal" }),
      waiting(["open"]),
    ];
    const value = await client();
    const answer = vi
      .spyOn(value, "answerCustomTools")
      .mockResolvedValue({ data: [] });
    await mount(<DesktopApp client={value} />);
    await act(async () => button("Decline").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(answer.mock.calls[0][1][0]).toMatchObject({
      custom_tool_use_id: "open",
      is_error: true,
    });
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "run" }),
    );
  });
  it("keeps running the rest of a chat that was allowed", async () => {
    const post = shell();
    fixtureTask.events = [call("one", "mac_apps", {}), waiting(["one"])];
    const value = await client();
    const answer = vi
      .spyOn(value, "answerCustomTools")
      .mockResolvedValue({ data: [] });
    await mount(<DesktopApp client={value} />);
    await act(async () => button("Allow in this chat").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    fixtureTask.events = [
      ...fixtureTask.events,
      { id: "r1", type: "user.custom_tool_result", custom_tool_use_id: "one" },
      call("two", "mac_action", { action: "click", x: 1, y: 2 }),
      waiting(["two"]),
    ];
    await act(async () => root!.render(<DesktopApp client={value} />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(answer).toHaveBeenCalledTimes(2);
    expect(answer.mock.calls[1][1][0].custom_tool_use_id).toBe("two");
    expect(
      post.mock.calls.filter(([body]) => body.operation === "run"),
    ).toHaveLength(2);
  });
  it("lets the person retry after a failed answer, without retrying itself", async () => {
    shell();
    fixtureTask.events = [
      call("shot", "mac_screenshot", {}),
      waiting(["shot"]),
    ];
    const value = await client();
    const answer = vi
      .spyOn(value, "answerCustomTools")
      .mockRejectedValueOnce(new Error("Network lost"))
      .mockResolvedValue({ data: [] });
    await mount(<DesktopApp client={value} />);
    await act(async () => button("Allow in this chat").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(answer).toHaveBeenCalledTimes(1);
    expect(host!.textContent).toContain("Network lost");
    expect(button("Allow once").disabled).toBe(false);
    await act(async () => button("Allow once").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(answer).toHaveBeenCalledTimes(2);
  });
  it("leaves another device's calls to that device", async () => {
    const post = shell();
    fixtureTask.events = [
      call("health", "health_read", {
        metric: "steps",
        start: "2026-10-01T00:00:00Z",
        end: "2026-10-01T12:00:00Z",
      }),
      waiting(["health"]),
    ];
    const value = await client();
    const answer = vi.spyOn(value, "answerCustomTools");
    await mount(<DesktopApp client={value} />);
    expect(host!.textContent).toContain("Waiting for your iPhone");
    expect(host!.querySelector(".computer-requests")).toBeNull();
    expect(answer).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "run" }),
    );
  });
  it("offers to open settings while computer use is off", async () => {
    shell(false);
    fixtureTask.events = [
      call("shot", "mac_screenshot", {}),
      waiting(["shot"]),
    ];
    await mount(<DesktopApp client={await client()} />);
    expect(host!.textContent).toContain("Computer use is off on this Mac");
    expect(button("Allow once")).toBeUndefined();
    expect(button("Open Settings")).toBeTruthy();
  });
  it("keeps the native tool list, permission checks and copy in step", () => {
    const swift = readFileSync("macos/Computer.swift", "utf8");
    // Calendar and location reads have their own executors; see
    // calendar.test.tsx and location.test.tsx.
    for (const tool of MAC_TOOLS.filter(
      (name) => name !== "mac_calendar" && name !== "mac_location",
    ))
      expect(swift).toContain(`"${tool}"`);
    expect(swift).toContain("AXIsProcessTrusted()");
    expect(swift).toContain("CGPreflightScreenCaptureAccess()");
    // Blocked folders are refused when a file is opened.
    expect(swift).toContain(
      "The person blocked this folder for their assistant.",
    );
    // Blocked apps are left out of screenshots, lists and actions.
    expect(swift).toContain("excludingApplications: hidden");
    expect(swift).toContain(
      "guard !isBlocked(NSWorkspace.shared.frontmostApplication)",
    );
    const shellSource = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(shellSource).toContain('name: "museComputer"');
    expect(shellSource).toContain("guard sender === webView else");
    for (const file of [
      "macos/ui/computer.ts",
      "macos/ui/ComputerSettings.tsx",
      "macos/ui/ComputerRequests.tsx",
    ])
      for (const [, key] of readFileSync(file, "utf8").matchAll(
        /\bt\(\s*"([^"]+)"/g,
      ))
        expect(zhCN[key], key).toBeTruthy();
  });
});
