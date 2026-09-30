import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AgentEvent, Category, Session } from "../shared/types";
import { eventText, pendingPermissions } from "../shared/types";
import { ApiError } from "./ark";
import { Store } from "./store";

export class Demo {
  emitter = new EventEmitter();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private runs = new Map<string, AbortController>();
  constructor(
    private store: Store,
    private delay = 900,
  ) {
    this.emitter.setMaxListeners(100);
  }

  async init() {
    for (const session of this.store.data.sessions) {
      if (session.status === "running") {
        await this.emit(session.id, {
          type: "session.error",
          error: {
            message: "The demo server restarted; please resend your message.",
          },
        });
        await this.emit(session.id, {
          type: "session.status_idle",
          stop_reason: { type: "retries_exhausted" },
        });
      }
    }
    await this.store.save();
  }

  async create(title: string, category: Category): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      id: `demo-${randomUUID()}`,
      title,
      category,
      status: "idle",
      created_at: now,
      updated_at: now,
    };
    this.store.data.sessions.unshift(session);
    this.store.data.events[session.id] = [];
    await this.store.save();
    return session;
  }

  async emit(id: string, input: Partial<AgentEvent>) {
    const event: AgentEvent = {
      ...input,
      id: input.id ?? `evt-${randomUUID()}`,
      type: input.type!,
      processed_at: new Date().toISOString(),
    };
    this.store.data.events[id].push(event);
    const session = this.store.get(id)!;
    session.updated_at = event.processed_at!;
    if (event.type === "session.status_running") session.status = "running";
    if (event.type === "session.status_idle") session.status = "idle";
    if (event.type === "agent.message")
      session.preview = eventText(event).slice(0, 100);
    await this.store.save();
    this.emitter.emit(id, event);
    return event;
  }

  async send(id: string, input: Partial<AgentEvent>) {
    const session = this.store.get(id)!;
    if (input.type === "user.interrupt") {
      this.runs.get(id)?.abort();
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      const event = await this.emit(id, input);
      await this.emit(id, {
        type: "session.status_idle",
        stop_reason: { type: "end_turn" },
      });
      return { data: [event] };
    }
    if (session.status === "running")
      throw new ApiError(
        409,
        "Task is running; wait for it to finish or stop it first.",
      );
    const pending = pendingPermissions(this.store.data.events[id]);
    if (input.type === "user.tool_confirmation") {
      if (!pending.some((event) => event.id === input.tool_use_id))
        throw new ApiError(
          409,
          "This action was already handled or is no longer pending approval.",
        );
      const event = await this.emit(id, input);
      await this.emit(id, { type: "session.status_running" });
      const run = new AbortController();
      this.runs.set(id, run);
      this.schedule(id, run.signal, async () => {
        await this.emit(id, {
          type: "agent.message",
          content: [
            {
              type: "text",
              text:
                input.result === "allow"
                  ? "Approval received. **This is demo mode: no real email is sent and no external action is performed.**\n\nOnce connected for real, this confirmation goes to the Ark agent, which continues with the configured tools."
                  : "This action was denied and was not performed. You can add more details or start a new task.",
            },
          ],
        });
        if (!run.signal.aborted)
          await this.emit(id, {
            type: "session.status_idle",
            stop_reason: { type: "end_turn" },
          });
      });
      return { data: [event] };
    }
    if (pending.length)
      throw new ApiError(409, "Approve or deny the pending action first.");
    const event = await this.emit(id, input);
    await this.emit(id, { type: "session.status_running" });
    const run = new AbortController();
    this.runs.set(id, run);
    this.schedule(id, run.signal, async () => {
      await this.emit(id, { type: "agent.thinking" });
      this.schedule(id, run.signal, async () => {
        const text = eventText(event);
        // Generic safety instructions such as “ask for approval before acting”
        // are not an email intent. Only explicit email / approval-demo requests trigger it.
        if (/email|(?:try|test|demo).{0,80}approv/i.test(text)) {
          const tool = await this.emit(id, {
            type: "agent.tool_use",
            name: "send_email",
            input: {
              to: "demo@example.com",
              subject: "Demo email",
              body: "This is a demo of a pending-approval action; no real email will be sent.",
            },
            evaluated_permission: "ask",
          });
          if (!run.signal.aborted)
            await this.emit(id, {
              type: "session.status_idle",
              stop_reason: { type: "requires_action", event_ids: [tool.id] },
            });
        } else {
          const tool = await this.emit(id, {
            type: "agent.tool_use",
            name: "prepare_outline",
            input: { goal: text },
            evaluated_permission: "allow",
          });
          if (run.signal.aborted) return;
          await this.emit(id, {
            type: "agent.tool_result",
            tool_use_id: tool.id,
            content: [
              {
                type: "text",
                text: "Demo: content outline prepared; no external tools were called.",
              },
            ],
          });
          this.schedule(id, run.signal, async () => {
            await this.emit(id, {
              type: "agent.message",
              content: [
                { type: "text", text: demoAnswer(text, session.category) },
              ],
            });
            if (!run.signal.aborted)
              await this.emit(id, {
                type: "session.status_idle",
                stop_reason: { type: "end_turn" },
              });
          });
        }
      });
    });
    return { data: [event] };
  }

  private schedule(
    id: string,
    signal: AbortSignal,
    action: () => Promise<void>,
  ) {
    if (signal.aborted) return;
    const timer = setTimeout(() => {
      this.timers.delete(id);
      if (!signal.aborted)
        void action().catch(() => {
          this.emitter.emit(id, {
            id: randomUUID(),
            type: "session.error",
            error: {
              message: "Failed to save demo data; check the server disk.",
            },
          });
        });
    }, this.delay);
    timer.unref();
    this.timers.set(id, timer);
  }
  close() {
    for (const run of this.runs.values()) run.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.emitter.removeAllListeners();
  }
}

function demoAnswer(text: string, category: Category) {
  const prefix =
    "> Demo content: no model calls and no online retrieval. Once Ark is configured, replies are generated by the real agent.\n\n";
  if (
    category === "life" ||
    /travel|weekend|hangzhou|itinerary|route/i.test(text)
  )
    return (
      prefix +
      "## Keep the weekend for a slower pace\n\nStart by deciding the origin, dates, group size, and budget, then plan the route. Here is an adjustable two-day structure:\n\n| Time | Plan | Margin |\n| --- | --- | --- |\n| Day one morning | A walk around the city; find a breakfast spot | No rushing |\n| Day one afternoon | One museum or exhibition | Leave time for coffee |\n| Day two | A stroll on the outskirts; head back in the evening | Buffer for travel |\n\n**Next step**: tell me the origin and destination and I can refine this. In real mode the agent's configured tools can look things up; the demo does not provide live prices or complete bookings."
    );
  if (category === "writing")
    return (
      prefix +
      "## Write the idea down first\n\nA clear piece of writing can start from these three parts:\n\n1. **What to say**: state the core point in one sentence.\n2. **Why it matters**: give a concrete situation, fact, or example.\n3. **What comes next**: propose a clear next action.\n\nYou can add the target readers, publishing platform, and tone, and I will continue from those requirements."
    );
  if (category === "code")
    return (
      prefix +
      '## Start with a small, verifiable version\n\n1. Define the inputs, outputs, and edge cases.\n2. Build the minimum implementation, then add error handling.\n3. Add tests for success, failure, and boundary cases.\n\n```typescript\ninterface Task {\n  id: string;\n  status: "idle" | "running" | "complete";\n}\n```\n\nThis is a demo sample; no real project was generated or run. Once connected for real, you can keep describing the tech stack and specific requirements.'
    );
  return (
    prefix +
    "## Here is how we can start\n\nI received your request. Demo mode shows the full interaction flow:\n\n- Save the goal as a standalone task\n- Show the agent status and the tool execution record\n- Keep adding requirements within the same session\n- Confirm each action that needs permission one by one\n\n**Next step**: see how to connect Ark under **Settings**; once the server credentials are configured you will get real replies. You can also send “help me write an email and ask for approval” to try the confirmation flow."
  );
}
