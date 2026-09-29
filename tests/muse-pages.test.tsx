import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ChatWelcome,
  FeedPage,
  IdeasPage,
  primaryNavigation,
  goalPrompt,
} from "../src/MusePages";

describe("Muse iOS 导航与真实状态", () => {
  it("规划请求包含目标说明、已有步骤和完成状态", () => {
    const prompt = goalPrompt({
      id: "goal",
      title: "周末旅行",
      description: "预算 1000 元",
      status: "active",
      created_at: "",
      updated_at: "",
      steps: [
        { id: "one", title: "确定日期", done: true },
        { id: "two", title: "选择车次", done: false },
      ],
    });
    expect(prompt).toContain("预算 1000 元");
    expect(prompt).toContain("- [x] 确定日期");
    expect(prompt).toContain("- [ ] 选择车次");
    expect(prompt).toContain("先请求批准");
  });
  it("保留静态包中确认的五个入口", () => {
    expect(primaryNavigation.map((item) => item.id)).toEqual([
      "home",
      "feed",
      "discover",
      "goals",
      "library",
    ]);
    expect(new Set(primaryNavigation.map((item) => item.path)).size).toBe(5);
  });
  it("动态空状态不展示虚构结果", () => {
    const html = renderToStaticMarkup(
      <FeedPage sessions={[]} loading={false} />,
    );
    expect(html).toContain("还没有新动态");
    expect(html).toContain("尚未提供定时推送或主动推荐");
  });
  it("动态展示真实会话链接和运行状态", () => {
    const html = renderToStaticMarkup(
      <FeedPage
        sessions={[
          {
            id: "my-session",
            title: "测试",
            status: "running",
            category: "general",
            created_at: "2026-09-29",
            updated_at: "2026-09-29",
          },
        ]}
        loading={false}
      />,
    );
    expect(html).toContain("#/task/my-session");
    expect(html).toContain("正在处理");
  });
  it("预设灵感不冒充个性化推荐", () => {
    expect(renderToStaticMarkup(<IdeasPage onTemplate={() => {}} />)).toContain(
      "这些是预设建议",
    );
  });
  it("聊天输入与目标关联可见", () => {
    const html = renderToStaticMarkup(
      <ChatWelcome
        composer={<textarea aria-label="描述你的任务" />}
        sessions={[]}
        onTemplate={() => {}}
        onClearGoal={() => {}}
        goal={{
          id: "goal",
          title: "周末计划",
          description: "",
          steps: [],
          status: "active",
          created_at: "",
          updated_at: "",
        }}
      />,
    );
    expect(html).toContain("周末计划");
    expect(html).toContain("取消关联目标");
    expect(html).toContain("描述你的任务");
  });
});
