import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { activityDay, activityTurns } from "../shared/activity";
import type { AgentEvent } from "../shared/types";
import { ActivityList } from "../src/ActivityList";

const text = (value: string) => [{ type: "text", text: value }];
const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 1, 8, minute)).toISOString();

const events: AgentEvent[] = [
  {
    id: "u1",
    type: "user.message",
    content: text("What's the weather?"),
    created_at: at(0),
  },
  {
    id: "a1",
    type: "agent.message",
    content: text("It's sunny."),
    created_at: at(1),
  },
  {
    id: "u2",
    type: "user.message",
    content: text("## Read my health data\nfor today"),
    created_at: at(2),
  },
  {
    id: "t2",
    type: "agent.custom_tool_use",
    name: "read_health",
    created_at: at(3),
  },
  {
    id: "a2",
    type: "agent.message",
    content: text("You walked 8,000 steps.\nNice work."),
    created_at: at(4),
  },
  {
    id: "u3",
    type: "user.message",
    content: text("<open-muse-checkin>"),
    app_initiation: "checkin",
    created_at: at(5),
  },
  { id: "t3", type: "agent.tool_use", name: "bash", created_at: at(6) },
  {
    id: "e3",
    type: "session.error",
    error: { message: "Tool failed" },
    created_at: at(7),
  },
] as AgentEvent[];

describe("Activity", () => {
  it("keeps only turns that used a tool, newest first, with their outcome", () => {
    const turns = activityTurns(events);
    expect(turns.map((turn) => turn.id)).toEqual(["u3", "u2"]);
    expect(turns[1]).toMatchObject({
      request: "Read my health data",
      reply: "You walked 8,000 steps.",
      tools: 1,
    });
    expect(turns[1].events.map((event) => event.id)).toEqual(["t2", "a2"]);
    expect(turns[0]).toMatchObject({
      request: "",
      initiation: "checkin",
      error: "Tool failed",
    });
  });
  it("groups by calendar day in local time", () => {
    const now = new Date(2026, 9, 2, 9, 0);
    expect(activityDay(new Date(2026, 9, 2, 0, 5).toISOString(), now)).toBe(
      "today",
    );
    expect(activityDay(new Date(2026, 9, 1, 23, 59).toISOString(), now)).toBe(
      "yesterday",
    );
    expect(activityDay(new Date(2026, 8, 28).toISOString(), now)).toBe("week");
    expect(activityDay(new Date(2026, 8, 20).toISOString(), now)).toBe(
      "earlier",
    );
  });
  it("names app-started turns instead of showing their raw marker", () => {
    const html = renderToStaticMarkup(
      <ActivityList events={events} running={false} />,
    );
    expect(html).toContain("Check-in");
    expect(html).not.toContain("open-muse-checkin");
    expect(html).toContain("Read my health data");
    expect(html).toContain("Tool failed");
  });
});

describe("Activity detail", () => {
  it("lists each tool call as a step with its target, narration and outcome", async () => {
    const { activityTurns, activitySteps, clockTime, plainText } =
      await import("../shared/activity");
    const events = [
      {
        id: "u",
        type: "user.message",
        created_at: "2026-10-03T00:12:00",
        content: [{ type: "text", text: "Compare earbuds" }],
      },
      {
        id: "m1",
        type: "agent.message",
        content: [{ type: "text", text: "Opening **Apple**." }],
      },
      { id: "mem", type: "agent.tool_use", name: "memory_read", input: {} },
      {
        id: "t1",
        type: "agent.tool_use",
        name: "web_fetch",
        input: { url: "https://www.apple.com.cn/airpods-pro/" },
      },
      { id: "r1", type: "agent.tool_result", tool_use_id: "t1", content: [] },
      {
        id: "t2",
        type: "agent.tool_use",
        name: "bash",
        input: { command: "ls /mnt/session/outputs" },
      },
      {
        id: "r2",
        type: "agent.tool_result",
        tool_use_id: "t2",
        is_error: true,
        content: [{ type: "text", text: "denied" }],
      },
      {
        id: "a",
        type: "agent.message",
        content: [{ type: "text", text: "Saved the **table**." }],
      },
    ] as never[];
    const [turn] = activityTurns(events);
    expect(turn.reply).toBe("Saved the table.");
    const steps = activitySteps(turn, false);
    expect(steps.map((step) => [step.label, step.target, step.state])).toEqual([
      ["Reading the web", "www.apple.com.cn", "done"],
      ["Running commands", "ls /mnt/session/outputs", "failed"],
    ]);
    expect(steps[0].note).toBe("Opening Apple.");
    expect(steps[1].note).toBe("");
    expect(steps[1].result).toBe("denied");
    expect(clockTime("2026-10-03T00:12:00")).toBe("12:12am");
    expect(clockTime("2026-10-03T13:47:00")).toBe("1:47pm");
    expect(plainText("## A [link](https://x) and `code`")).toBe(
      "A link and code",
    );
  });
});
