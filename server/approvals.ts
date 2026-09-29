import { createHash } from "node:crypto";
import type { AgentEvent } from "../shared/types";
import type { Store } from "./store";

export function approvalKey(sessionId: string, toolId: string) {
  return createHash("sha256").update(`${sessionId}\0${toolId}`).digest("hex");
}

export function annotateApproval(
  store: Store,
  sessionId: string,
  event: AgentEvent,
): AgentEvent {
  const { approval_source: _untrusted, ...original } = event;
  if (event.type !== "user.tool_confirmation" || !event.tool_use_id)
    return original;
  const record =
    store.data.autoApprovals?.[approvalKey(sessionId, event.tool_use_id)];
  return record?.event.id === event.id && event.result === "allow"
    ? { ...original, approval_source: "automatic" }
    : original;
}
