import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { approvalHistory } from "../shared/approvals";
import { t } from "../shared/i18n";
import type { AgentEvent } from "../shared/types";
import { ApprovalHistory, timeAgo } from "../src/ApprovalHistory";
import { AvatarShareSheet } from "../src/AvatarShareSheet";

const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 1, 8, minute)).toISOString();

const events = [
  {
    id: "s1",
    type: "agent.tool_use",
    name: "web_search",
    input: { search_request_list: [{ query: "AirPods Pro price" }] },
    created_at: at(0),
  },
  {
    id: "c1",
    type: "user.tool_confirmation",
    tool_use_id: "s1",
    result: "allow",
    created_at: at(1),
  },
  {
    id: "b1",
    type: "agent.tool_use",
    name: "bash",
    input: { command: "rm -rf /tmp/cache\necho done" },
    created_at: at(2),
  },
  {
    id: "c2",
    type: "user.tool_confirmation",
    tool_use_id: "b1",
    result: "deny",
    created_at: at(3),
  },
  { id: "x1", type: "agent.tool_use", name: "web_fetch", created_at: at(4) },
] as AgentEvent[];

describe("approval history", () => {
  it("lists answered requests newest first with what was asked", () => {
    const records = approvalHistory(events);
    expect(
      records.map((record) => [record.title, record.detail, record.result]),
    ).toEqual([
      ["Use {tool}", "rm -rf /tmp/cache", "deny"],
      ["Search the web", "AirPods Pro price", "allow"],
    ]);
    expect(records[0].tool).toBe("bash");
    expect(records[0].input).toContain('"command"');
  });

  it("renders each record with its outcome and nothing when none were answered", () => {
    const html = renderToStaticMarkup(<ApprovalHistory events={events} />);
    expect(html).toContain("Review history");
    expect(html).toContain("Use bash");
    expect(html).toContain("Denied");
    expect(html).toContain("Allowed");
    expect(
      renderToStaticMarkup(<ApprovalHistory events={events.slice(0, 1)} />),
    ).toBe("");
  });

  it("says how long ago an answer was given", () => {
    const now = Date.parse(at(0)) + 9 * 3_600_000;
    expect(timeAgo(at(0), now)).toBe("9 hours ago");
    expect(timeAgo("not a time", now)).toBe("");
  });

  it("translates the new copy into Simplified Chinese", () => {
    expect(t("Review history", {}, "zh-CN")).toBe("审核记录");
    expect(t("Use {tool}", { tool: "bash" }, "zh-CN")).toBe("使用 bash");
    expect(t("Share my avatar", {}, "zh-CN")).toBe("分享我的虚拟形象");
    expect(
      t(
        "Hi, I’m {name}, a personal AI agent. Join Open Muse and create your own agent.",
        { name: "Willow" },
        "zh-CN",
      ),
    ).toContain("Willow");
  });
});

describe("avatar share sheet", () => {
  it("offers four card styles with the companion's greeting", () => {
    const html = renderToStaticMarkup(
      <AvatarShareSheet name="Willow" onClose={() => {}} />,
    );
    expect(html.match(/avatar-share-card /g)).toHaveLength(4);
    expect(html).toContain("Hi, I’m Willow, a personal AI agent.");
    expect(html).toContain("sms:&amp;body=");
  });
});
