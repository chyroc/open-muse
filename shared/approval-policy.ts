import type { AgentEvent } from "./types";

// 只匹配内置工具的协议名称；不使用前缀、模糊匹配或 MCP 显示名称。
export function canAutoApprove(event: AgentEvent): boolean {
  return (
    event.type === "agent.tool_use" &&
    event.evaluated_permission === "ask" &&
    (event.name === "web_search" || event.name === "web_fetch")
  );
}
