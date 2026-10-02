import type { AgentEvent } from "./types";

// A device can choose to be asked before every website. The choice only ever
// makes the policy stricter: without it, web search and page reads may run.
export const webAccessKey = "open-muse.webAccess";
export type WebAccess = "some" | "always";

export function webAccessDefault(): WebAccess {
  try {
    return globalThis.localStorage?.getItem(webAccessKey) === "always"
      ? "always"
      : "some";
  } catch {
    return "some";
  }
}

export function setWebAccessDefault(value: WebAccess) {
  try {
    if (value === "always")
      globalThis.localStorage?.setItem(webAccessKey, value);
    else globalThis.localStorage?.removeItem(webAccessKey);
  } catch {
    // Unwritable storage keeps the current choice.
  }
}

// Match only the protocol names of built-in tools; no prefixes, fuzzy matching,
// or MCP display names.
export function canAutoApprove(
  event: AgentEvent,
  webAccess: WebAccess = webAccessDefault(),
): boolean {
  return (
    webAccess === "some" &&
    event.type === "agent.tool_use" &&
    event.evaluated_permission === "ask" &&
    (event.name === "web_search" || event.name === "web_fetch")
  );
}
