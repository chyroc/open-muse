import { describe, expect, it } from "vitest";
import {
  maxSummarizedSteps,
  parseSummary,
  summaryModel,
  summaryRequest,
} from "../shared/activity-summary";
import type { ActivityStep, ActivityTurn } from "../shared/activity";

const turn: ActivityTurn = {
  id: "u1",
  request: "Compare two earbuds and save a table",
  reply: "Done. The table is in your Library.",
  tools: 2,
  at: "2026-10-01T08:00:00Z",
  events: [],
};
const step = (id: string): ActivityStep => ({
  id,
  label: "Running commands",
  target: "browser https://example.com",
  note: "Opening the page",
  state: "done",
  input: "x".repeat(1000),
  result: "ok",
});

describe("activity summaries", () => {
  it("asks a small model for one label per step, with long fields clipped", () => {
    const body = summaryRequest(turn, [step("a"), step("b")], "zh-CN");
    expect(body.model).toBe(summaryModel);
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.messages[0].content).toContain("Simplified Chinese");
    expect(body.messages[0].content).toContain("exactly 2 step entries");
    const payload = JSON.parse(body.messages[1].content);
    expect(payload.steps).toHaveLength(2);
    expect(payload.steps[0].input.length).toBeLessThan(310);
    const many = Array.from({ length: 100 }, (_, i) => step(String(i)));
    expect(
      JSON.parse(summaryRequest(turn, many, "en").messages[1].content).steps,
    ).toHaveLength(maxSummarizedSteps);
  });

  it("keeps step labels only when they match the steps one to one", () => {
    const reply = JSON.stringify({
      title: "对比耳机",
      summary: "已保存对比表",
      steps: [
        { title: "打开页面", description: "打开了产品页。" },
        { title: "保存表格", description: "写入了对比表。" },
      ],
    });
    expect(parseSummary(reply, 2, "zh-CN")?.steps).toHaveLength(2);
    const mismatched = parseSummary(reply, 3, "zh-CN");
    expect(mismatched?.title).toBe("对比耳机");
    expect(mismatched?.steps).toEqual([]);
    expect(parseSummary("```json\n" + reply + "\n```", 2, "en")?.language).toBe(
      "en",
    );
  });

  it("rejects replies that are not usable labels", () => {
    expect(parseSummary("not json", 0, "en")).toBeUndefined();
    expect(
      parseSummary(JSON.stringify({ title: "" }), 0, "en"),
    ).toBeUndefined();
    expect(parseSummary(undefined, 0, "en")).toBeUndefined();
  });
});
