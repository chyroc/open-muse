import { describe, expect, it } from "vitest";
import { t } from "../shared/i18n";
import { pendingCustomTools, type AgentEvent } from "../shared/types";

describe("Waiting for the Mac", () => {
  const blocked = (ids: string[]): AgentEvent => ({
    id: "idle",
    type: "session.status_idle",
    stop_reason: { type: "requires_action", event_ids: ids },
  });

  it("finds mac_ calls the session is blocked on until the Mac answers", () => {
    const call: AgentEvent = {
      id: "call",
      type: "agent.custom_tool_use",
      name: "mac_screenshot",
    };
    const other: AgentEvent = {
      id: "other",
      type: "agent.custom_tool_use",
      name: "lookup",
    };
    const mac = (events: AgentEvent[]) =>
      pendingCustomTools(events).filter((event) =>
        event.name?.startsWith("mac_"),
      );
    expect(mac([call, other, blocked(["call", "other"])])).toEqual([call]);
    expect(
      mac([
        call,
        blocked(["call"]),
        {
          id: "r",
          type: "user.custom_tool_result",
          custom_tool_use_id: "call",
        },
      ]),
    ).toEqual([]);
    expect(mac([call])).toEqual([]);
  });

  it("translates the waiting state", () => {
    expect(t("Waiting for your Mac", {}, "zh-CN")).toBe("等待你的 Mac");
    expect(
      t("Waiting for Open Muse on your Mac to finish this step", {}, "zh-CN"),
    ).toBe("等待你 Mac 上的 Open Muse 完成这一步");
  });
});
