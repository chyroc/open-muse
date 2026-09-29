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
          error: { message: "演示服务已重启，请重新发送消息。" },
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
      throw new ApiError(409, "任务正在执行，请等待完成或先停止。");
    const pending = pendingPermissions(this.store.data.events[id]);
    if (input.type === "user.tool_confirmation") {
      if (!pending.some((event) => event.id === input.tool_use_id))
        throw new ApiError(409, "这项操作已处理或不再等待确认。");
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
                  ? "已收到批准。**这是演示模式，没有发送真实邮件或执行外部操作。**\n\n真实接入后，此确认会交给方舟 Agent，按已配置的工具继续执行。"
                  : "已拒绝这次操作，没有执行。你可以继续补充要求，或者开始新的任务。",
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
    if (pending.length) throw new ApiError(409, "请先允许或拒绝待确认的操作。");
    const event = await this.emit(id, input);
    await this.emit(id, { type: "session.status_running" });
    const run = new AbortController();
    this.runs.set(id, run);
    this.schedule(id, run.signal, async () => {
      await this.emit(id, { type: "agent.thinking" });
      this.schedule(id, run.signal, async () => {
        const text = eventText(event);
        // Generic safety instructions such as “操作前请求批准” are not an
        // email intent. Only explicit email / approval-demo requests trigger it.
        if (/邮件|(?:体验|测试).{0,8}(?:批准|审批)/.test(text)) {
          const tool = await this.emit(id, {
            type: "agent.tool_use",
            name: "send_email",
            input: {
              to: "demo@example.com",
              subject: "演示邮件",
              body: "这是待确认操作的演示，不会发送真实邮件。",
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
              { type: "text", text: "演示：已准备内容结构，未调用外部工具。" },
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
            error: { message: "演示数据保存失败，请检查服务端磁盘。" },
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
    "> 演示内容：未调用模型、未联网检索。配置方舟后，回复将由真实 Agent 生成。\n\n";
  if (category === "life" || /旅行|周末|杭州|路线/.test(text))
    return (
      prefix +
      "## 把周末留给慢一点的生活\n\n建议先确定出发地、日期、人数和预算，再安排路线。这里是一份可调整的两日结构：\n\n| 时间 | 安排 | 留白 |\n| --- | --- | --- |\n| 第一天上午 | 城市漫步，找一家早餐店 | 不赶路 |\n| 第一天下午 | 一个博物馆或展览 | 留出咖啡时间 |\n| 第二天 | 近郊散步，傍晚返程 | 预留交通时间 |\n\n**下一步**：告诉我出发地和目的地，我可以继续细化。真实模式下可按 Agent 的工具配置查询资料；演示不会提供实时价格或完成预订。"
    );
  if (category === "writing")
    return (
      prefix +
      "## 先把想法写下来\n\n一份清楚的内容，可以从这三个部分开始：\n\n1. **要说什么**：用一句话说明核心观点。\n2. **为什么重要**：给出具体情境、事实或例子。\n3. **接下来做什么**：提出明确的下一步。\n\n你可以补充目标读者、发布平台和语气，我会沿着这些要求继续。"
    );
  if (category === "code")
    return (
      prefix +
      '## 从一个可验证的小版本开始\n\n1. 确定输入、输出和边界条件。\n2. 完成最小实现，再加入错误处理。\n3. 为成功、失败和边界情况补充测试。\n\n```typescript\ninterface Task {\n  id: string;\n  status: "idle" | "running" | "complete";\n}\n```\n\n这是演示示例，并未生成或运行真实项目。可以在真实接入后继续描述技术栈和具体需求。'
    );
  return (
    prefix +
    "## 我们可以这样开始\n\n我收到了你的需求。演示模式展示的是完整的交互流程：\n\n- 把目标保存为独立任务\n- 展示 Agent 状态与工具执行记录\n- 在同一会话里继续补充要求\n- 对需要权限的操作逐项确认\n\n**接下来**：在「设置」中查看方舟接入方式，配置服务端凭据后即可获得真实回复。也可以发送「帮我写一封邮件并请求批准」，体验确认流程。"
  );
}
