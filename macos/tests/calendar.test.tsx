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
// Like the shell: turning a switch on asks macOS, which grants access it
// has not been asked for and keeps a refusal.
function shell(calendar: Record<string, unknown>, computer = false) {
  const state = { ...base, enabled: computer, calendar: { ...calendar } };
  const ask = (kind: "events" | "reminders") => {
    if (state.calendar[kind] === "not-asked") state.calendar[kind] = "allowed";
  };
  const postMessage = vi.fn(async (body: Record<string, string>) => {
    if (body.operation === "calendar-enable") {
      state.calendar.enabled = body.value === "true";
      if (body.value === "true") ask("events");
    }
    if (body.operation === "reminders-enable") {
      state.calendar.remindersEnabled = body.value === "true";
      if (body.value === "true") ask("reminders");
    }
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
      remindersEnabled: false,
      reminders: "not-asked",
    });
    // An older shell had one switch for both.
    expect(
      parseComputerState({
        ...base,
        calendar: { enabled: true, events: "allowed", reminders: "nonsense" },
      })?.calendar,
    ).toEqual({
      enabled: true,
      events: "allowed",
      remindersEnabled: true,
      reminders: "not-asked",
    });
    expect(
      parseComputerState({
        ...base,
        calendar: { enabled: true, remindersEnabled: false },
      })?.calendar.remindersEnabled,
    ).toBe(false);
  });

  it("offers to connect the calendar right on the request, then asks for approval", async () => {
    const post = shell({
      enabled: true,
      events: "allowed",
      remindersEnabled: false,
      reminders: "not-asked",
    });
    const onAnswer = vi.fn();
    await mount(
      <ComputerRequests
        calls={[call({ kind: "reminders" })]}
        busy={false}
        onAnswer={onAnswer}
        onSettings={vi.fn()}
      />,
    );
    // A reminders read needs the Reminders switch, not Calendar's.
    expect(host!.querySelector(".computer-connector")?.textContent).toContain(
      "Reminders",
    );
    expect(buttons()).toEqual(["Decline", "Connect"]);
    await act(async () =>
      [...host!.querySelectorAll("button")]
        .find((item) => item.textContent === "Connect")!
        .click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    // Turning it on is what asks macOS for access.
    expect(post).toHaveBeenCalledWith({
      operation: "reminders-enable",
      value: "true",
    });
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "calendar-enable" }),
    );
    // Connecting is not approval: the read still waits for the person.
    expect(onAnswer).not.toHaveBeenCalled();
    expect(buttons()).toEqual(["Decline", "Allow in this chat", "Allow once"]);
    await act(async () => root!.unmount());
    // Turned on, a calendar read can be allowed even with computer use off.
    shell({
      enabled: true,
      events: "allowed",
      remindersEnabled: false,
      reminders: "allowed",
    });
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

  it("turns Calendar and Reminders on separately from Connectors", async () => {
    const post = shell({
      enabled: false,
      events: "not-asked",
      remindersEnabled: false,
      reminders: "denied",
    });
    await mount(<ConnectorsSettings onSection={vi.fn()} />);
    const toggles = () => [
      ...host!.querySelectorAll<HTMLInputElement>('input[role="switch"]'),
    ];
    // Calendar, Reminders, then Location, each its own switch.
    expect(toggles()).toHaveLength(3);
    expect(toggles().map((item) => item.checked)).toEqual([
      false,
      false,
      false,
    ]);
    await act(async () => toggles()[0].click());
    expect(post).toHaveBeenCalledWith({
      operation: "calendar-enable",
      value: "true",
    });
    // Granted when turned on: no extra row saying so.
    expect(host!.textContent).not.toContain("Allowed");
    expect(buttons()).not.toContain("Open System Settings");
    // Reminders macOS refused: its row says so and leads to System Settings.
    await act(async () => toggles()[1].click());
    expect(post).toHaveBeenCalledWith({
      operation: "reminders-enable",
      value: "true",
    });
    expect(host!.textContent).toContain(
      "macOS has not allowed Open Muse to use this.",
    );
    await act(async () =>
      [...host!.querySelectorAll("button")]
        .find((item) => item.textContent === "Open System Settings")!
        .click(),
    );
    expect(post).toHaveBeenCalledWith({
      operation: "calendar-request",
      kind: "reminders",
    });
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
    // Each read follows its own switch.
    expect(shellSource).toContain(
      "UserDefaults.standard.bool(forKey: reminders ? remindersKey : calendarKey)",
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
      ).toContain('"Reminders are off on this Mac."');
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
