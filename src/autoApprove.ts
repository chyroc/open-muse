import { canAutoApprove } from "../shared/approval-policy";
import { pendingPermissions, type AgentEvent } from "../shared/types";
import type { Client } from "./api";

// Each observation overwrites current state; re-check before the queue executes; a failed instance is not retried automatically.
export class AutoApprover {
  private events: AgentEvent[] = [];
  private attempted = new Set<string>();
  private active = false;

  constructor(
    private client: Pick<Client, "send">,
    private sessionId: string,
    private signal: AbortSignal,
    private onEvents: (events: AgentEvent[]) => void,
    private onFailure: (toolId: string) => void,
  ) {}

  observe(events: AgentEvent[]) {
    this.events = events;
    void this.drain();
  }

  private async drain() {
    if (this.active || this.signal.aborted) return;
    this.active = true;
    try {
      while (!this.signal.aborted) {
        const tool = pendingPermissions(this.events).find(
          (event) => canAutoApprove(event) && !this.attempted.has(event.id),
        );
        if (!tool) break;
        this.attempted.add(tool.id);
        try {
          const result = await this.client.send(
            this.sessionId,
            {
              type: "user.tool_confirmation",
              tool_use_id: tool.id,
              result: "allow",
              automatic: true,
            },
            this.signal,
          );
          if (!this.signal.aborted) this.onEvents(result.data);
        } catch {
          if (!this.signal.aborted) this.onFailure(tool.id);
        }
      }
    } finally {
      this.active = false;
    }
  }
}
