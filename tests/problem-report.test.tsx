import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { recordFailure } from "../shared/diagnostic-log";
import {
  ProblemReport,
  problemReport,
  problemReportText,
} from "../src/ProblemReport";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Reporting a problem to the service", () => {
  it("sends only the platform, versions, and redacted failures", () => {
    vi.stubGlobal("localStorage", storage());
    recordFailure(
      {
        via: "service",
        request: "POST /v1/account/workspace",
        status: 422,
        code: "ark_rejected",
        detail: "POST /agents; HTTP 404; Request ID 20261011-req-0001",
      },
      Date.UTC(2026, 9, 11, 7, 0, 0),
    );
    const report = problemReport(
      "mac",
      "20261011-ec65daa (612) <b>",
      "macOS 26.0.1 (25A362)\n",
    );
    expect(report).toEqual({
      platform: "mac",
      app_version: "20261011-ec65daa (612) b",
      system: "macOS 26.0.1 (25A362)",
      failures: [
        expect.objectContaining({
          request: "POST /v1/account/workspace",
          status: 422,
          code: "ark_rejected",
        }),
      ],
    });
    expect(problemReportText(report)).toBe(
      [
        "Open Muse 20261011-ec65daa (612) b (mac)",
        "macOS 26.0.1 (25A362)",
        "Recent failed requests:",
        "2026-10-11T07:00:00Z service POST /v1/account/workspace HTTP 422 ark_rejected (POST /agents; HTTP 404; Request ID 20261011-req-0001)",
      ].join("\n"),
    );
    expect(
      problemReportText({ ...report, system: "", failures: [] }),
    ).toContain("Recent failed requests: none");
  });

  it("is offered only with a signed-in Open Muse account", () => {
    expect(
      renderToStaticMarkup(
        <ProblemReport platform="ios" version="1" system="iOS 27" />,
      ),
    ).toBe("");
  });
});
