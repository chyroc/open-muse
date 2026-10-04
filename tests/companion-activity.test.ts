import { describe, expect, it } from "vitest";
import { companionActivity } from "../shared/companion-activity";
import { t } from "../shared/i18n";
import type { AgentEvent } from "../shared/types";

const event = (
  type: string,
  extra: Partial<AgentEvent> & Record<string, unknown> = {},
) => ({ id: `${type}-${Math.random()}`, type, ...extra }) as AgentEvent;
const idle = { running: false, approval: false, mac: false };
const running = { ...idle, running: true };

describe("Companion activity", () => {
  it("says it is planning while answering a goal category's message", () => {
    const planning = [
      event("user.message", {
        content: [{ type: "text", text: "我想设定一个health目标" }],
      }),
      event("agent.thinking"),
    ];
    expect(companionActivity(planning, running)).toEqual({
      label: "💪 Start planning",
      working: true,
    });
    expect(t("💪 Start planning", {}, "zh-CN")).toBe("💪 开始规划");
    // Idle again once the reply is done, and other turns read as before.
    expect(companionActivity(planning, idle)).toBeUndefined();
    expect(
      companionActivity(
        [
          event("user.message", {
            content: [{ type: "text", text: "hello" }],
          }),
          event("agent.thinking"),
        ],
        running,
      )?.label,
    ).toBe("Thinking");
  });
  it("is quiet while idle and says when the connection dropped", () => {
    expect(companionActivity([], idle)).toBeUndefined();
    expect(companionActivity([], { ...idle, interrupted: true })).toEqual({
      label: "Connection interrupted",
    });
    expect(companionActivity([], { ...idle, connecting: true })).toEqual({
      label: "Connecting",
    });
    // A running turn or a dropped connection says more than "connecting".
    expect(
      companionActivity([], { ...idle, connecting: true, interrupted: true })
        ?.label,
    ).toBe("Connection interrupted");
    expect(companionActivity([], { ...running, connecting: true })?.label).toBe(
      "Working hard",
    );
    expect(t("Connecting", {}, "zh-CN")).toBe("正在连接");
  });
  it("asks for review in the accent color without the working pose", () => {
    expect(companionActivity([], { ...running, approval: true })).toEqual({
      label: "Review needed",
      attention: true,
    });
    expect(companionActivity([], { ...idle, health: "ask" })?.attention).toBe(
      true,
    );
    expect(companionActivity([], { ...idle, health: "auto" })).toEqual({
      label: "Reading Health",
      working: true,
    });
    expect(t("Review needed", {}, "zh-CN")).toBe("需要审核");
  });
  it("names the tool still running in the current turn", () => {
    const search = event("agent.tool_use", { name: "web_search" });
    const browser = event("agent.tool_use", {
      name: "bash",
      input: { command: "/opt/open-muse/python shot.py --cdp" },
    });
    const turn = [event("user.message"), search];
    expect(companionActivity(turn, running)?.label).toBe("Searching the web");
    expect(
      companionActivity(
        [
          ...turn,
          event("agent.tool_result", { tool_use_id: search.id }),
          browser,
        ],
        running,
      )?.label,
    ).toBe("Using the browser");
    expect(
      companionActivity(
        [...turn, event("agent.tool_result", { tool_use_id: search.id })],
        running,
      ),
    ).toEqual({ label: "Working hard", working: true });
    expect(
      companionActivity([...turn, event("agent.thinking")], running)?.label,
    ).toBe("Thinking");
  });
  it("shows a command's own short description as the status", () => {
    const step = (description: string) =>
      companionActivity(
        [
          event("user.message"),
          event("agent.tool_use", {
            name: "bash",
            input: { command: "python make.py", description },
          }),
        ],
        running,
      )?.label;
    expect(step("📄 生成文档")).toBe("📄 生成文档");
    expect(step("  📍  搜索\n攻略 ")).toBe("📍 搜索 攻略");
    // A long one is cut to a short line.
    expect(step("Print the itinerary HTML page to a PDF file")).toBe(
      "Print the itinera…",
    );
    // Without one, the kind of command still names it.
    expect(step("")).toBe("Running commands");
  });
  it("ignores tools from earlier turns", () => {
    const old = event("agent.tool_use", { name: "web_fetch" });
    expect(
      companionActivity(
        [event("user.message"), old, event("user.message")],
        running,
      )?.label,
    ).toBe("Working hard");
    expect(t("Working hard", {}, "zh-CN")).toBe("努力工作中");
  });
});
