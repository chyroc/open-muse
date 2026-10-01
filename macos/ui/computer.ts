import { t } from "../../shared/i18n";
import type { AgentEvent } from "../../shared/types";
import { macToolNames, type MacToolName } from "../../shared/mac-tools";
import type { CustomToolResult } from "../../src/api";

// Computer use: the agent's mac_* custom tools, run by the native shell on this
// Mac. Nothing runs unless the user turned it on here and approved the call.
export const MAC_TOOLS = macToolNames;
export const isMacTool = (name?: string): name is MacToolName =>
  MAC_TOOLS.includes(name as MacToolName);

export type BlockedApp = { id: string; name: string };
export type ComputerState = {
  enabled: boolean;
  accessibility: boolean;
  screen: boolean;
  keepAwake: boolean;
  blocked: BlockedApp[];
};
export const computerChanged = "muse-computer-changed";

type Bridge = { postMessage: (value: object) => Promise<unknown> };
function bridge(): Bridge | undefined {
  return (
    window as unknown as {
      webkit?: { messageHandlers?: { museComputer?: Bridge } };
    }
  ).webkit?.messageHandlers?.museComputer;
}
export const computerAvailable = () => Boolean(bridge());

export function parseComputerState(value: unknown): ComputerState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const blocked = Array.isArray(record.blocked)
    ? record.blocked.filter(
        (item): item is BlockedApp =>
          Boolean(item) &&
          typeof item.id === "string" &&
          typeof item.name === "string",
      )
    : [];
  return typeof record.enabled === "boolean" &&
    typeof record.accessibility === "boolean" &&
    typeof record.screen === "boolean"
    ? {
        enabled: record.enabled,
        accessibility: record.accessibility,
        screen: record.screen,
        keepAwake: record.keepAwake === true,
        blocked,
      }
    : undefined;
}
export async function readComputer() {
  const native = bridge();
  return native
    ? parseComputerState(await native.postMessage({ operation: "status" }))
    : undefined;
}
export async function enableComputer(value: boolean) {
  const native = bridge();
  return native
    ? parseComputerState(
        await native.postMessage({
          operation: "enable",
          value: value ? "true" : "false",
        }),
      )
    : undefined;
}
async function send(body: Record<string, string>) {
  const native = bridge();
  return native
    ? parseComputerState(await native.postMessage(body))
    : undefined;
}
export const setKeepAwake = (value: boolean) =>
  send({ operation: "keep-awake", value: value ? "true" : "false" });
// The shell asks which app to block with its own file panel.
export const blockApp = () => send({ operation: "block-app" });
export const unblockApp = (id: string) =>
  send({ operation: "unblock-app", id });
export async function requestPermission(kind: "accessibility" | "screen") {
  const native = bridge();
  return native
    ? parseComputerState(
        await native.postMessage({ operation: "request", kind }),
      )
    : undefined;
}

type NativeOutput = { ok: boolean; text: string; image: string };
function parseOutput(value: unknown): NativeOutput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.ok === "boolean" &&
    typeof record.text === "string" &&
    typeof record.image === "string"
    ? { ok: record.ok, text: record.text, image: record.image }
    : undefined;
}

const errorText = (message: string) =>
  JSON.stringify({ ok: false, error: message });

// Runs one call and always produces a result, so the session is never left
// waiting on a call this Mac received.
export async function runMacTool(event: AgentEvent): Promise<CustomToolResult> {
  const result = (ok: boolean, text: string, image = ""): CustomToolResult => ({
    custom_tool_use_id: event.id,
    is_error: !ok,
    content: [
      { type: "text", text: text.slice(0, 64000) },
      ...(image && /^[A-Za-z0-9+/]+={0,2}$/.test(image)
        ? [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/jpeg" as const,
                data: image,
              },
            },
          ]
        : []),
    ],
  });
  const native = bridge();
  if (!isMacTool(event.name))
    return result(false, errorText("This Mac does not provide that tool."));
  if (!native)
    return result(
      false,
      errorText("Computer use needs the Open Muse Mac app."),
    );
  try {
    const output = parseOutput(
      await native.postMessage({
        operation: "run",
        tool: event.name,
        input: JSON.stringify(event.input ?? {}),
      }),
    );
    if (!output)
      return result(false, errorText("The Mac returned an unreadable result."));
    return result(output.ok, output.text, output.image);
  } catch (failure) {
    return result(false, errorText((failure as Error).message));
  }
}

export function declinedResult(event: AgentEvent): CustomToolResult {
  return {
    custom_tool_use_id: event.id,
    is_error: true,
    content: [
      {
        type: "text",
        text: errorText(
          "The user declined this action on their Mac. Do not try another way to do it; ask what they would like instead.",
        ),
      },
    ],
  };
}

// What the call will do, in the user's words, for the approval card.
export function describeCall(event: AgentEvent) {
  const input = (event.input ?? {}) as Record<string, unknown>;
  const at =
    typeof input.x === "number" && typeof input.y === "number"
      ? `${Math.round(input.x)}, ${Math.round(input.y)}`
      : "";
  switch (event.name) {
    case "mac_screenshot":
      return t("Look at your screen");
    case "mac_apps":
      return t("List the open apps and windows");
    case "mac_open":
      return t("Open {target}", { target: String(input.target ?? "") });
    case "mac_action":
      switch (input.action) {
        case "click":
          return t("Click at {point}", { point: at });
        case "double_click":
          return t("Double-click at {point}", { point: at });
        case "right_click":
          return t("Right-click at {point}", { point: at });
        case "move":
          return t("Move the pointer to {point}", { point: at });
        case "drag":
          return t("Drag from {point}", { point: at });
        case "scroll":
          return t("Scroll");
        case "type":
          return t("Type “{text}”", {
            text: String(input.text ?? "").slice(0, 80),
          });
        case "key":
          return t("Press {keys}", { keys: String(input.keys ?? "") });
      }
  }
  return t("Use your Mac");
}
