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

describe("工具审批展示", () => {
  it("识别截图中的搜索参数，保留顺序与原始搜索词", () => {
    expect(
      searchPreview(
        event({
          max_results: 8,
          search_request_list: [
            { query: "深圳北到汕头" },
            { query: "南澳岛交通" },
          ],
        }),
      ),
    ).toEqual({
      queries: ["深圳北到汕头", "南澳岛交通"],
      maxResults: 8,
      extra: false,
    });
    expect(searchPreview(event({ query: "单个搜索词" }))?.queries).toEqual([
      "单个搜索词",
    ]);
  });
  it.each([
    null,
    "query",
    {},
    { query: " " },
    { search_request_list: [] },
    { search_request_list: [{ query: "good" }, { query: 5 }] },
  ])("无效输入不提供误导性搜索摘要：%j", (input) => {
    expect(searchPreview(event(input))).toBeNull();
    expect(render(event(input))).toContain(
      'class="permission-details" open=""',
    );
  });
  it("未知字段和无效结果上限要求检查完整参数", () => {
    for (const input of [
      { query: "test", private_option: "extra" },
      { search_request_list: [{ query: "test", domain: "example.org" }] },
      { query: "test", max_results: -1 },
      { query: "test", max_results: "8" },
    ]) {
      expect(searchPreview(event(input))?.extra).toBe(true);
      expect(render(event(input))).toContain("含额外选项，请检查");
      expect(render(event(input))).toContain(
        'class="permission-details" open=""',
      );
    }
  });
  it("未知工具不假定为搜索，也不隐藏原始参数", () => {
    const value = event(
      { command: "echo test", path: "/tmp/test" },
      "custom.web_search",
    );
    expect(searchPreview(value)).toBeNull();
    const html = render(value);
    expect(html).toContain("允许执行此工具？");
    expect(html).toContain("echo test");
    expect(html).toContain('class="permission-details" open=""');
  });
  it("默认折叠搜索 JSON；长列表可展开且没有丢失参数", () => {
    const queries = Array.from({ length: 6 }, (_, i) => ({
      query: `完整搜索词 ${i}`,
    }));
    const html = render(event({ search_request_list: queries }));
    expect(html).toContain("查看其余 3 项搜索");
    expect(html).toContain('class="permission-details"');
    expect(html).not.toContain('class="permission-details" open');
    for (const { query } of queries) expect(html).toContain(query);
    expect(html).toContain("仅授权本次调用");
    expect(html).not.toContain("始终允许");
  });
  it("参数按纯文本渲染，不执行 HTML 或模型给出的指令", () => {
    const html = render(
      event({ query: "<script>alert(1)</script><img src=x onerror=alert(1)>" }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
  it("提交期间两个操作均禁用，并显示提交状态", () => {
    const html = render(event({ query: "test" }), true);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在提交");
  });
});
