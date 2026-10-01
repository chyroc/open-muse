import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { macTools } from "../../shared/mac-tools";
import { deviceTools } from "../../shared/workspace-spec";
import type { AgentEvent } from "../../shared/types";
import {
  CALENDAR_TOOL,
  describeCall,
  isMacTool,
  parseComputerState,
} from "../ui/computer";
import { ComputerRequests } from "../ui/ComputerRequests";
import { ConnectorsSettings } from "../ui/ConnectorsSettings";

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

const base = {
  enabled: false,
  accessibility: false,
  screen: false,
  keepAwake: false,
  blocked: [],
  fullDiskAccess: false,
  blockedFolders: [],
};
function shell(calendar: Record<string, unknown>, computer = false) {
  const state = { ...base, enabled: computer, calendar: { ...calendar } };
  const postMessage = vi.fn(async (body: Record<string, string>) => {
    if (body.operation === "calendar-enable")
      state.calendar.enabled = body.value === "true";
    if (body.operation === "calendar-request")
      state.calendar[body.kind] = "allowed";
    return structuredClone(state);
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
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
const call = (input: Record<string, unknown>, name = CALENDAR_TOOL) =>
  ({
    id: `call-${name}`,
    type: "agent.custom_tool_use",
    name,
    input,
  }) as AgentEvent;
const buttons = () =>
  [...host!.querySelectorAll("button")].map((item) => item.textContent);

describe("Mac Calendar and Reminders", () => {
  it("is a read-only device tool within the custom tool limit", () => {
    const tool = macTools.find((item) => item.name === CALENDAR_TOOL)!;
    expect(tool.input_schema.properties.kind.enum).toEqual([
      "events",
      "reminders",
    ]);
    expect(tool.description).toContain("Read-only");
    expect(isMacTool(CALENDAR_TOOL)).toBe(true);
    expect(deviceTools.length).toBeLessThanOrEqual(8);
  });

  it("says what each read covers on the approval card", () => {
    expect(describeCall(call({ kind: "reminders" }))).toBe(
      "Read your open reminders",
    );
    expect(describeCall(call({ kind: "events" }))).toBe(
      "Read your calendar for the coming week",
    );
    expect(
      describeCall(
        call({ kind: "events", from: "2026-10-01", to: "2026-10-08" }),
      ),
    ).toMatch(/^Read your calendar from \S+ \d+ to \S+ \d+$/);
  });

  it("reads the connector state and defaults it to off", () => {
    expect(parseComputerState(base)?.calendar).toEqual({
      enabled: false,
      events: "not-asked",
      reminders: "not-asked",
    });
    expect(
      parseComputerState({
        ...base,
        calendar: { enabled: true, events: "allowed", reminders: "nonsense" },
      })?.calendar,
    ).toEqual({ enabled: true, events: "allowed", reminders: "not-asked" });
  });

  it("asks for approval with its own switch, apart from computer use", async () => {
    shell({ enabled: false, events: "allowed", reminders: "allowed" });
    const onSettings = vi.fn();
    await mount(
      <ComputerRequests
        calls={[call({ kind: "events" })]}
        busy={false}
        onAnswer={vi.fn()}
        onSettings={onSettings}
      />,
    );
    expect(host!.textContent).toContain(
      "Calendar and Reminders are off on this Mac.",
    );
    await act(async () =>
      [...host!.querySelectorAll("button")]
        .find((item) => item.textContent === "Open Settings")!
        .click(),
    );
    expect(onSettings).toHaveBeenCalledWith("connectors");
    await act(async () => root!.unmount());
    // Turned on, a calendar read can be allowed even with computer use off.
    shell({ enabled: true, events: "allowed", reminders: "allowed" });
    await mount(
      <ComputerRequests
        calls={[call({ kind: "events" })]}
        busy={false}
        onAnswer={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    expect(buttons()).toEqual(["Decline", "Allow in this chat", "Allow once"]);
  });

  it("is turned on and granted from Connectors", async () => {
    const post = shell({
      enabled: false,
      events: "not-asked",
      reminders: "denied",
    });
    await mount(<ConnectorsSettings onSection={vi.fn()} />);
    const toggle = host!.querySelector<HTMLInputElement>(
      'input[role="switch"]',
    )!;
    expect(toggle.checked).toBe(false);
    await act(async () => toggle.click());
    expect(post).toHaveBeenCalledWith({
      operation: "calendar-enable",
      value: "true",
    });
    expect(buttons()).toContain("Open System Settings");
    await act(async () =>
      [...host!.querySelectorAll("button")]
        .find((item) => item.textContent === "Allow")!
        .click(),
    );
    expect(post).toHaveBeenCalledWith({
      operation: "calendar-request",
      kind: "events",
    });
    expect(host!.textContent).toContain("Allowed");
  });

  it("keeps the native reader read-only and its copy translated", () => {
    const swift = readFileSync("macos/LocalCalendar.swift", "utf8");
    expect(swift).toContain('static let tool = "mac_calendar"');
    expect(swift).toContain("requestFullAccessToEvents");
    expect(swift).toContain("requestFullAccessToReminders");
    for (const write of ["store.save", "store.remove", "store.commit"])
      expect(swift).not.toContain(write);
    const shellSource = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(shellSource).toContain('if body["tool"] == LocalCalendar.tool');
    expect(shellSource).toContain(
      "UserDefaults.standard.bool(forKey: calendarKey)",
    );
    const build = readFileSync("scripts/build-macos.mjs", "utf8");
    expect(build).toContain('"macos/LocalCalendar.swift"');
    expect(build).toContain('"EventKit"');
    for (const key of [
      "NSCalendarsFullAccessUsageDescription",
      "NSRemindersFullAccessUsageDescription",
    ]) {
      expect(readFileSync("macos/Info.plist", "utf8")).toContain(key);
      for (const language of ["en", "zh-Hans"])
        expect(
          readFileSync(`macos/${language}.lproj/InfoPlist.strings`, "utf8"),
        ).toContain(key);
    }
    for (const language of ["en", "zh-Hans"])
      expect(
        readFileSync(`macos/${language}.lproj/Localizable.strings`, "utf8"),
      ).toContain('"Calendar and Reminders are off on this Mac."');
    for (const file of [
      "macos/ui/computer.ts",
      "macos/ui/ComputerRequests.tsx",
      "macos/ui/ConnectorsSettings.tsx",
    ])
      for (const [, key] of readFileSync(file, "utf8").matchAll(
        /\bt\(\s*"([^"]+)"/g,
      ))
        expect(zhCN[key], key).toBeTruthy();
  });
});
