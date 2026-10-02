import { describe, expect, it } from "vitest";
import { t } from "../shared/i18n";
import {
  healthMetricLabel,
  healthMetrics,
  healthQueryInput,
  healthRangeLabel,
  healthToolSpec,
  isHealthRequest,
  parseHealthRequest,
} from "../shared/health";
import type { AgentEvent } from "../shared/types";

const request = (input: unknown): AgentEvent => ({
  id: "call",
  type: "agent.custom_tool_use",
  name: "health_read",
  input,
});

describe("Apple Health requests", () => {
  it("declares one strict custom tool covering every metric", () => {
    expect(healthToolSpec.name).toBe("health_read");
    expect(healthToolSpec.input_schema.additionalProperties).toBe(false);
    expect(healthToolSpec.input_schema.properties.metric.enum).toEqual([
      ...healthMetrics,
    ]);
    expect(healthToolSpec.description).toContain(
      "once the person has connected Apple Health",
    );
  });

  it("validates ranges and picks a sensible granularity", () => {
    const today = parseHealthRequest(
      request({
        metric: "steps",
        start: "2026-10-01T00:00:00+08:00",
        end: "2026-10-02T00:00:00+08:00",
      }),
    );
    expect(today?.granularity).toBe("total");
    expect(today?.endMs! - today?.startMs!).toBe(86400000);
    const week = parseHealthRequest(
      request({
        metric: "sleep",
        start: "2026-09-24T00:00:00Z",
        end: "2026-10-01T00:00:00Z",
      }),
    );
    expect(week?.granularity).toBe("day");
    expect(
      parseHealthRequest(
        request({
          metric: "steps",
          start: "2026-10-01T00:00+08:00",
          end: "2026-10-01T12:00:00+0800",
        }),
      )?.endMs,
    ).toBe(Date.parse("2026-10-01T04:00:00Z"));
    for (const input of [
      {
        metric: "blood",
        start: "2026-10-01T00:00:00Z",
        end: "2026-10-02T00:00:00Z",
      },
      {
        metric: "steps",
        start: "2026-10-02T00:00:00Z",
        end: "2026-10-01T00:00:00Z",
      },
      {
        metric: "steps",
        start: "2025-01-01T00:00:00Z",
        end: "2026-10-01T00:00:00Z",
      },
      { metric: "steps", start: "2026-10-01", end: "2026-10-02" },
      {
        metric: "heart_rate",
        start: "2026-09-01T00:00:00Z",
        end: "2026-10-01T00:00:00Z",
        granularity: "hour",
      },
      {
        metric: "steps",
        start: "2026-10-01T00:00:00Z",
        end: "2026-10-02T00:00:00Z",
        extra: 1,
      },
      undefined,
    ])
      expect(healthQueryInput.safeParse(input).success).toBe(false);
  });

  it("recognizes only health_read custom tool calls", () => {
    expect(isHealthRequest(request({}))).toBe(true);
    expect(isHealthRequest({ ...request({}), name: "mac_screenshot" })).toBe(
      false,
    );
    expect(isHealthRequest({ ...request({}), type: "agent.tool_use" })).toBe(
      false,
    );
  });

  it("labels requests in English and Simplified Chinese", () => {
    const day = parseHealthRequest(
      request({
        metric: "workouts",
        start: new Date(2026, 9, 1).toISOString(),
        end: new Date(2026, 9, 2).toISOString(),
      }),
    )!;
    expect(healthRangeLabel(day, "en-US")).toBe("Oct 1");
    const span = parseHealthRequest(
      request({
        metric: "workouts",
        start: new Date(2026, 8, 24).toISOString(),
        end: new Date(2026, 9, 1).toISOString(),
      }),
    )!;
    expect(healthRangeLabel(span, "en-US")).toBe("Sep 24 – Sep 30");
    expect(healthMetricLabel("workouts")).toBe("Workouts");
    expect(t("Workouts", {}, "zh-CN")).toBe("体能训练");
    expect(t("Share Apple Health data?", {}, "zh-CN")).toBe(
      "共享 Apple 健康数据？",
    );
  });
});
