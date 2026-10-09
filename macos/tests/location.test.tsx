import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { macTools } from "../../shared/mac-tools";
import { deviceTools } from "../../shared/workspace-spec";
import type { AgentEvent } from "../../shared/types";
import {
  describeCall,
  isMacTool,
  LOCATION_TOOL,
  macSwitch,
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
  enabled: true,
  accessibility: true,
  screen: true,
  keepAwake: false,
  blocked: [],
  fullDiskAccess: false,
  blockedFolders: [],
  calendar: { enabled: false, events: "not-asked", reminders: "not-asked" },
};
function shell(location: { enabled: boolean; permission: string }) {
  const state = { ...base, location: { ...location } };
  const postMessage = vi.fn(async (body: Record<string, string>) => {
    if (body.operation === "location-enable")
      state.location.enabled = body.value === "true";
    if (body.operation === "location-request")
      state.location.permission = "allowed";
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
const call = (name: string, input = {}) =>
  ({
    id: `call-${name}`,
    type: "agent.custom_tool_use",
    name,
    input,
  }) as AgentEvent;

describe("Mac location", () => {
  it("is an approximate device tool within the custom tool limit", () => {
    const tool = macTools.find((item) => item.name === LOCATION_TOOL)!;
    expect(tool.description).toContain("approximate");
    expect(tool.input_schema.properties).toEqual({});
    expect(isMacTool(LOCATION_TOOL)).toBe(true);
    expect(macSwitch(LOCATION_TOOL)).toBe("location");
    expect(macSwitch("mac_calendar")).toBe("calendar");
    expect(macSwitch("mac_screenshot")).toBe("computer");
    expect(deviceTools.length).toBeLessThanOrEqual(8);
    expect(describeCall(call(LOCATION_TOOL))).toBe(
      "Find this Mac's approximate location",
    );
  });

  it("reads the connector state and defaults it to off", () => {
    expect(parseComputerState(base)?.location).toEqual({
      enabled: false,
      permission: "not-asked",
    });
    expect(
      parseComputerState({
        ...base,
        location: { enabled: true, permission: "denied" },
      })?.location,
    ).toEqual({ enabled: true, permission: "denied" });
  });

  it("asks for its own switch even when computer use is on", async () => {
    const post = shell({ enabled: false, permission: "allowed" });
    await mount(
      <ComputerRequests
        calls={[call("mac_screenshot"), call(LOCATION_TOOL)]}
        busy={false}
        onAnswer={vi.fn()}
        onSettings={vi.fn()}
      />,
    );
    expect(host!.querySelector(".computer-connector")?.textContent).toContain(
      "Location",
    );
    expect(host!.textContent).not.toContain("Allow once");
    await act(async () =>
      [...host!.querySelectorAll("button")]
        .find((item) => item.textContent === "Connect")!
        .click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(post).toHaveBeenCalledWith({
      operation: "location-enable",
      value: "true",
    });
    // Already allowed by macOS, so it is not asked again.
    expect(post).not.toHaveBeenCalledWith({ operation: "location-request" });
    expect(host!.textContent).toContain("Allow once");
  });

  it("is turned on and granted from Connectors", async () => {
    const post = shell({ enabled: false, permission: "not-asked" });
    await mount(<ConnectorsSettings onSection={vi.fn()} />);
    const switches = [
      ...host!.querySelectorAll<HTMLInputElement>('input[role="switch"]'),
    ];
    // Calendar and Reminders first, then Location.
    expect(switches).toHaveLength(2);
    await act(async () => switches[1].click());
    expect(post).toHaveBeenCalledWith({
      operation: "location-enable",
      value: "true",
    });
    await act(async () =>
      [...host!.querySelectorAll("button")]
        .find((item) => item.textContent === "Allow")!
        .click(),
    );
    expect(post).toHaveBeenCalledWith({ operation: "location-request" });
    expect(host!.textContent).toContain("Allowed");
  });

  it("keeps the native lookup approximate and its copy translated", () => {
    const swift = readFileSync("macos/LocalLocation.swift", "utf8");
    expect(swift).toContain('static let tool = "mac_location"');
    expect(swift).toContain("kCLLocationAccuracyKilometer");
    expect(swift).toContain('"latitude": (fix.latitude * 100).rounded() / 100');
    const shellSource = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(shellSource).toContain('if body["tool"] == LocalLocation.tool');
    expect(shellSource).toContain(
      "UserDefaults.standard.bool(forKey: locationKey)",
    );
    const build = readFileSync("scripts/build-macos.mjs", "utf8");
    expect(build).toContain('"macos/LocalLocation.swift"');
    expect(build).toContain('"CoreLocation"');
    for (const key of [
      "NSLocationUsageDescription",
      "NSLocationWhenInUseUsageDescription",
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
      ).toContain('"Location is off on this Mac."');
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
