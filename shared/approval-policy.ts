import type { AgentEvent } from "./types";

// Match only the protocol names of built-in tools; no prefixes, fuzzy matching,
// or MCP display names.
export function canAutoApprove(event: AgentEvent): boolean {
  return (
    event.type === "agent.tool_use" &&
    event.evaluated_permission === "ask" &&
    (event.name === "web_search" || event.name === "web_fetch")
  );
}
