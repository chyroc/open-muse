import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t } from "../shared/i18n";
import {
  iphoneDeclined,
  iphonePersonalTool,
  iphoneSource,
  isIphoneTool,
  parseIphoneRequest,
} from "../shared/iphone-tools";
import { approvalHistory } from "../shared/approvals";
import { toolLabel } from "../shared/companion-activity";
import { deviceTools } from "../shared/workspace-spec";
import type { AgentEvent } from "../shared/types";
import {
  PersonalRequestCard,
  describeIphoneRequest,
} from "../src/PersonalRequestCard";
import type { Client } from "../src/api";

const call = (input: unknown): AgentEvent => ({
  id: "call-1",
  type: "agent.custom_tool_use",
  name: iphonePersonalTool,
  input,
});

describe("Calendar, Reminders, and Contacts on iPhone", () => {
  it("is one read-only device tool, keeping the agent within its custom tool limit", () => {
    const tool = deviceTools.find((item) => item.name === iphonePersonalTool)!;
    expect(tool.description).toContain("Read-only");
    expect(tool.input_schema.properties.source.enum).toEqual([
      "calendar",
      "reminders",
      "contacts",
    ]);
    expect(deviceTools.length).toBeLessThanOrEqual(8);
    expect(isIphoneTool(iphonePersonalTool)).toBe(true);
    expect(isIphoneTool("mac_calendar")).toBe(false);
  });

  it("accepts only requests it can read", () => {
    expect(parseIphoneRequest(call({ source: "calendar" }))).toEqual({
      source: "calendar",
    });
    expect(
      iphoneSource(parseIphoneRequest(call({ source: "reminders" }))!),
    ).toBe("reminders");
    for (const input of [
      { source: "contacts" },
      { source: "contacts", query: "  " },
      { source: "photos" },
      { source: "calendar", extra: true },
      { source: "calendar", limit: 0 },
    ])
      expect(parseIphoneRequest(call(input))).toBeUndefined();
    expect(
      parseIphoneRequest({
        name: "mac_calendar",
        input: { source: "calendar" },
      }),
    ).toBeUndefined();
  });

  it("names what each request reads", () => {
    expect(describeIphoneRequest({ source: "contacts", query: "Ada" })).toBe(
      "Contacts matching “Ada”",
    );
    expect(describeIphoneRequest({ source: "reminders" })).toBe(
      "All open reminders",
    );
    expect(describeIphoneRequest({ source: "calendar" })).toBe(
      "Calendar events for 7 days from Today",
    );
    expect(
      describeIphoneRequest({
        source: "calendar",
        from: "2026-10-04T00:00:00+08:00",
        to: "2026-10-06T00:00:00+08:00",
      }),
    ).toMatch(/^Calendar events, Oct \d – Oct \d$/);
    expect(t("Share calendar events?", {}, "zh-CN")).toBe("共享日历日程？");
  });

  it("asks before sharing, and says it must happen on the iPhone elsewhere", () => {
    const html = renderToStaticMarkup(
      <PersonalRequestCard
        client={{} as Client}
        session="sesn_1"
        event={call({ source: "contacts", query: "Ada" })}
        name="Kit"
        onAnswered={() => {}}
      />,
    );
    expect(html).toContain("Share contact details?");
    expect(html).toContain("Contacts matching “Ada”");
    // Outside the iPhone app there is nothing to read with.
    expect(html).toContain(
      "Open Open Muse on your iPhone or Android phone to share it.",
    );
    expect(html).not.toContain(">Share<");
  });

  it("is recorded in approvals and named in activity", () => {
    const events: AgentEvent[] = [
      call({ source: "calendar" }),
      {
        id: "result-1",
        type: "user.custom_tool_result",
        custom_tool_use_id: "call-1",
        content: [{ type: "text", text: iphoneDeclined }],
      },
    ];
    const [record] = approvalHistory(events);
    expect(record).toMatchObject({ kind: "iphone", title: "Use your iPhone" });
    expect(toolLabel(events[0])).toBe("Using your iPhone");
  });
});
