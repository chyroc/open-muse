import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionCard, searchPreview } from "../src/PermissionCard";
import type { AgentEvent } from "../shared/types";

const event = (input: unknown, name = "web_search"): AgentEvent => ({
  id: "tool-test",
  type: "agent.tool_use",
  name,
  input,
});
const render = (value: AgentEvent, busy = false) =>
  renderToStaticMarkup(
    <PermissionCard event={value} busy={busy} onConfirm={() => {}} />,
  );

describe("Tool approval display", () => {
  it("recognizes the search parameters from the screenshot, preserving order and raw queries", () => {
    expect(
      searchPreview(
        event({
          max_results: 8,
          search_request_list: [
            { query: "Shenzhen North to Shantou" },
            { query: "Nan'ao Island transport" },
          ],
        }),
      ),
    ).toEqual({
      queries: ["Shenzhen North to Shantou", "Nan'ao Island transport"],
      maxResults: 8,
      extra: false,
    });
    expect(
      searchPreview(event({ query: "single search query" }))?.queries,
    ).toEqual(["single search query"]);
  });
  it.each([
    null,
    "query",
    {},
    { query: " " },
    { search_request_list: [] },
    { search_request_list: [{ query: "good" }, { query: 5 }] },
  ])("invalid input provides no misleading search summary: %j", (input) => {
    expect(searchPreview(event(input))).toBeNull();
    expect(render(event(input))).toContain(
      'class="permission-details" open=""',
    );
  });
  it("unknown fields and invalid result limits require reviewing the full parameters", () => {
    for (const input of [
      { query: "test", private_option: "extra" },
      { search_request_list: [{ query: "test", domain: "example.org" }] },
      { query: "test", max_results: -1 },
      { query: "test", max_results: "8" },
    ]) {
      expect(searchPreview(event(input))?.extra).toBe(true);
      expect(render(event(input))).toContain(
        "includes additional options, please review",
      );
      expect(render(event(input))).toContain(
        'class="permission-details" open=""',
      );
    }
  });
  it("does not assume an unknown tool is a search, and never hides raw parameters", () => {
    const value = event(
      { command: "echo test", path: "/tmp/test" },
      "custom.web_search",
    );
    expect(searchPreview(value)).toBeNull();
    const html = render(value);
    expect(html).toContain("Allow this tool to run?");
    expect(html).toContain("echo test");
    expect(html).toContain('class="permission-details" open=""');
  });
  it("collapses search JSON by default; the long list is expandable and loses no parameters", () => {
    const queries = Array.from({ length: 6 }, (_, i) => ({
      query: `Full search query ${i}`,
    }));
    const html = render(event({ search_request_list: queries }));
    expect(html).toContain("View the other 3 searches");
    expect(html).toContain('class="permission-details"');
    expect(html).not.toContain('class="permission-details" open');
    for (const { query } of queries) expect(html).toContain(query);
    expect(html).toContain("Authorize this call only");
    expect(html).not.toContain("Always allow");
  });
  it("renders parameters as plain text and never executes HTML or model-given instructions", () => {
    const html = render(
      event({ query: "<script>alert(1)</script><img src=x onerror=alert(1)>" }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
  it("disables both actions while submitting and shows the submitting status", () => {
    const html = render(event({ query: "test" }), true);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Submitting");
  });
});
