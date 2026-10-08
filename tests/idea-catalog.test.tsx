import "fake-indexeddb/auto";
import React, { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../src/api";
import { LocalDatabase } from "../src/direct/storage";
import { InspirationPage } from "../src/InspirationPages";
import {
  catalogSections,
  IdeaSheetBody,
  ideaMenuItems,
  ideaStartMessage,
  shownCatalogIdea,
} from "../src/IdeaCatalog";
import {
  catalogCopy,
  catalogIdea,
  catalogIdeas,
  ideaCatalog,
} from "../shared/idea-catalog";
import {
  defaultFeedInstructions,
  inspirationPrompt,
  newIdeas,
  sameIdea,
} from "../shared/inspiration";
import { t } from "../shared/i18n";
import { zhCN } from "../shared/locales/zh-CN";
import { uuid } from "../shared/crypto";
import { quoteMessage, splitQuote } from "../shared/message-quote";
import { MessageQuote } from "../src/ChatUI";

const language = (value: string) =>
  vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [value]);
afterEach(() => vi.unstubAllGlobals());

// Every element in a rendered tree, for calling a button's handler without a
// DOM. Only works on components without hooks.
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

const ideasPage = () =>
  renderToStaticMarkup(
    <InspirationPage client={new Client()} kind="ideas" onDiscuss={() => {}} />,
  );

describe("Ideas catalog", () => {
  it("keeps its sections and ideas in order, with an illustration for each", () => {
    expect(ideaCatalog.map((section) => section.title)).toEqual([
      undefined,
      "Relationships",
      "Productivity",
      "Health & fitness",
      "Money management",
      "Shopping",
      "More ideas",
    ]);
    expect(ideaCatalog.map((section) => section.ideas.length)).toEqual([
      4, 3, 3, 4, 4, 3, 12,
    ]);
    expect(new Set(catalogIdeas.map((idea) => idea.id)).size).toBe(33);
    for (const idea of catalogIdeas) {
      expect(existsSync(`src/assets/ideas/${idea.id}.png`), idea.id).toBe(true);
      const icon = shownCatalogIdea(idea).icon!;
      expect(icon.src).toBeTruthy();
      expect(Math.max(icon.width, icon.height)).toBeLessThanOrEqual(44.7);
    }
    // Every idea lists what it sets up, as one of four kinds of work.
    expect(catalogIdeas.filter((idea) => !idea.included?.length)).toEqual([]);
    expect(catalogIdea("occasion-planner")!.included).toHaveLength(2);
    expect(
      new Set(
        catalogIdeas.flatMap((idea) =>
          idea.included!.map((row) => t(row.name, {}, "zh-CN")),
        ),
      ),
    ).toEqual(new Set(["定期任务", "构件", "文档", "搜索"]));
  });

  it("has Simplified Chinese for every line", () => {
    const missing = catalogCopy().filter((text) => !Object.hasOwn(zhCN, text));
    expect(missing).toEqual([]);
    expect(
      ideaCatalog.flatMap((section) =>
        section.title ? [t(section.title, {}, "zh-CN")] : [],
      ),
    ).toEqual([
      "人际关系",
      "效率提升",
      "健康与健身",
      "财务管理",
      "购物",
      "更多点子",
    ]);
    const [first] = catalogIdeas;
    expect(t(first.title, {}, "zh-CN")).toBe(
      "票价下降？我会在价格符合你的预算时立即预订座位。",
    );
    expect(t(first.category, {}, "zh-CN")).toBe("旅行");
    expect(t(first.included![0].name, {}, "zh-CN")).toBe("定期任务");
    expect([
      ...new Set(catalogIdeas.map((idea) => t(idea.category, {}, "zh-CN"))),
    ]).toEqual([
      "旅行",
      "本地",
      "效率提升",
      "财务管理",
      "人际关系",
      "健康与健身",
      "购物",
      "生活小妙招",
      "娱乐",
      "住房与车辆",
    ]);
  });

  it("drops hidden ideas, and a section once all of its ideas are hidden", () => {
    const sections = catalogSections([
      "pet-care",
      "family-trivia-night",
      "reconnect",
      "fare-drop",
    ]);
    expect(sections.map((section) => section.title)).toEqual([
      undefined,
      "Productivity",
      "Health & fitness",
      "Money management",
      "Shopping",
      "More ideas",
    ]);
    expect(sections[0].ideas.map((idea) => idea.id)).toEqual([
      "occasion-planner",
      "inbox-triage",
      "forgotten-subscriptions",
    ]);
  });

  it("shows the default feed instructions in the person's language", () => {
    expect(t(defaultFeedInstructions, {}, "zh-CN")).toContain("动态");
    expect(t(defaultFeedInstructions, {}, "en")).toBe(defaultFeedInstructions);
  });
});

describe("Ideas page", () => {
  it.each([
    [
      "en",
      "Ideas",
      ["Relationships", "Productivity", "Health &amp; fitness", "More ideas"],
      "Fares dropped? I’ll book your seats the moment the price fits your budget.",
      "Travel",
    ],
    [
      "zh-Hans",
      "点子",
      ["人际关系", "效率提升", "健康与健身", "更多点子"],
      "票价下降？我会在价格符合你的预算时立即预订座位。",
      "旅行",
    ],
  ])("lists the catalog in %s", (code, title, headings, first, category) => {
    language(code);
    const html = ideasPage();
    // The page opens with its title and the first idea, before any heading.
    expect(html.indexOf(title)).toBeLessThan(html.indexOf(first));
    expect(html.indexOf(first)).toBeLessThan(html.indexOf(headings[0]));
    let last = 0;
    for (const heading of headings) {
      const at = html.indexOf(`<h2 class="idea-section-title">${heading}</h2>`);
      expect(at, heading).toBeGreaterThan(last);
      last = at;
    }
    expect(html.match(/class="catalog-idea"/g)).toHaveLength(33);
    expect(html.match(/class="catalog-idea-body"/g)).toHaveLength(33);
    const body = t(catalogIdeas[0].body);
    expect(html).toContain(`aria-label="${first}, ${body}, ${category}"`);
    expect(html).toMatch(/<img src="[^"]*fare-drop[^"]*\.png"/);
    // Nothing generated yet: no extra section, and no empty state.
    expect(html).not.toContain(t("Made for you"));
    expect(html).not.toContain("inspiration-empty");
    // Finding new ideas stays at the very bottom.
    expect(html.indexOf("generate-inspiration")).toBeGreaterThan(
      html.lastIndexOf("catalog-idea-body"),
    );
  });
});

describe("Idea sheet", () => {
  const sheet = (id: string) =>
    renderToStaticMarkup(
      <IdeaSheetBody
        idea={shownCatalogIdea(catalogIdea(id)!)}
        onStart={() => {}}
        onMore={() => {}}
      />,
    );

  it.each([
    [
      "en",
      "What&#x27;s included",
      "Recurring task",
      "Get started",
      "More options",
    ],
    ["zh-Hans", "包含哪些内容", "定期任务", "开始吧", "更多选项"],
  ])("shows the idea and what it sets up in %s", (code, ...labels) => {
    language(code);
    const html = sheet("occasion-planner");
    const idea = shownCatalogIdea(catalogIdea("occasion-planner")!);
    expect(html).toContain(`<h2>${idea.title}</h2>`);
    expect(html).toContain(idea.body);
    const [included, recurring, start, more] = labels;
    expect(html).toContain(`<h3>${included}</h3>`);
    expect(html).toContain("idea-included-glyph");
    expect(html).toContain(`<strong>${recurring}</strong>`);
    expect(html).toContain(idea.included![0].detail);
    expect(html.match(/idea-included-check/g)).toHaveLength(2);
    expect(html).toContain(`aria-label="${more}"`);
    expect(html).toContain(start);
  });

  it("leaves out the included list for an idea without one", () => {
    language("zh-Hans");
    const html = renderToStaticMarkup(
      <IdeaSheetBody
        idea={{
          ...shownCatalogIdea(catalogIdea("trip-planner")!),
          included: undefined,
        }}
        onStart={() => {}}
        onMore={() => {}}
      />,
    );
    expect(html).not.toContain("idea-included");
    expect(html).toContain("开始吧");
  });

  it.each([
    ["en", ["Get started", "Show more like this", "Not interested"]],
    ["zh-Hans", ["开始吧", "更多类似内容", "不感兴趣"]],
  ])("offers the menu in %s", (code, labels) => {
    language(code);
    const items = ideaMenuItems({
      onStart: () => {},
      onLike: () => {},
      onHide: () => {},
    });
    expect(items.map((item) => item.kind)).toEqual([
      "item",
      "separator",
      "item",
      "item",
    ]);
    expect(
      items.flatMap((item) => (item.kind === "item" ? [item.label] : [])),
    ).toEqual(labels);
    const last = items[3];
    expect(last.kind === "item" && last.destructive).toBe(true);
  });

  it.each([
    ["en", "Let's get started!"],
    ["zh-Hans", "我们开始吧！"],
  ])("starts an idea by quoting its title in %s", (code, go) => {
    language(code);
    const idea = shownCatalogIdea(catalogIdea("fare-drop")!);
    // The title is quoted as authored, in every language.
    const message = ideaStartMessage(idea);
    expect(message).toBe(`> ${catalogIdea("fare-drop")!.title}\n\n${go}`);
    expect(splitQuote(message)).toEqual({
      quote: catalogIdea("fare-drop")!.title,
      text: go,
    });
    const onStart = vi.fn();
    const tree = IdeaSheetBody({ idea, onStart, onMore: () => {} });
    const button = elements(tree).find(
      (element) => element.props.className === "idea-sheet-start",
    )!;
    (button.props.onClick as () => void)();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("holds the button and grays the checks once started", () => {
    const idea = shownCatalogIdea(catalogIdea("pet-care")!);
    const html = renderToStaticMarkup(
      <IdeaSheetBody
        idea={idea}
        starting
        onStart={() => {}}
        onMore={() => {}}
      />,
    );
    expect(html).toContain('class="idea-sheet-scroll starting"');
    expect(html).toMatch(/class="idea-sheet-start" disabled=""/);
  });

  it("sends a started idea to the main chat, not a new side chat", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const ideas = app.slice(app.indexOf('kind="ideas"'));
    expect(ideas.slice(0, 200)).toContain(
      "onStart={(text) => void sendToMain(text)}",
    );
    const send = app.slice(app.indexOf("const sendToMain"));
    expect(send.slice(0, 900)).toContain('navigate("/")');
    expect(send.slice(0, 900)).toContain('type: "user.message", text');
  });
});

describe("Ideas this device turned away or wants more of", () => {
  it("are kept apart from any workspace while signed out", async () => {
    const client = new Client({
      database: new LocalDatabase(`ideas-${uuid()}`),
    });
    expect(await client.ideaCatalogState()).toEqual({
      liked: [],
      hidden: [],
      started: [],
    });
    await client.reactToCatalogIdea("fare-drop", "hidden");
    await client.reactToCatalogIdea("fare-drop", "hidden");
    await client.reactToCatalogIdea("pet-care", "liked");
    await client.reactToCatalogIdea("inbox-triage", "started");
    expect(await client.ideaCatalogState()).toEqual({
      liked: ["pet-care"],
      hidden: ["fare-drop"],
      started: ["inbox-triage"],
    });
    await expect(
      client.reactToCatalogIdea("pet-care", "shared" as "liked"),
    ).rejects.toThrow();
  });
});

describe("Messages that quote", () => {
  it("keep the quote apart from the message, as replies write it", () => {
    expect(quoteMessage("First line\n\n second ", "Sure")).toBe(
      "> First line\n> second\n\nSure",
    );
    expect(splitQuote("> First line\n> second\n\nSure, go on.")).toEqual({
      quote: "First line\nsecond",
      text: "Sure, go on.",
    });
    // Nothing after the quote, or no blank line: the text stays as written.
    for (const text of ["> Only a quote", "> Quote\nno gap", "Plain > text"])
      expect(splitQuote(text)).toEqual({ text });
    expect(renderToStaticMarkup(<MessageQuote text="A title" />)).toBe(
      '<blockquote class="message-quote">A title</blockquote>',
    );
  });

  it("show the quote above the bubble in chat history", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("splitQuote(eventText(event))");
    expect(app).toContain("<MessageQuote text={sent.quote} />");
  });
});

describe("Ideas made for the person", () => {
  it("leave out ones that repeat a known idea, even reworded", () => {
    const known = ["Plan a weekend hiking trip", "整理本周的会议纪要"];
    const fresh = newIdeas(
      [
        { title: "Plan a weekend hiking trip!" },
        { title: "Plan a weekend hiking trips" },
        { title: "整理本周会议纪要" },
        { title: "Compare phone plans for you" },
        { title: "Compare phone plans for you." },
        { title: "Draft a birthday message" },
      ],
      known,
    );
    expect(fresh.map((item) => item.title)).toEqual([
      "Compare phone plans for you",
      "Draft a birthday message",
    ]);
    expect(sameIdea("Read more", "Run more")).toBe(false);
    expect(sameIdea("", "")).toBe(false);
  });

  it("are asked not to repeat previous or handled ideas", () => {
    const prompt = inspirationPrompt("ideas", {
      instructions: "",
      recent: "",
      goals: "[]",
      liked: [],
      previous: ["Old idea"],
      handled: ["Started idea"],
    });
    expect(prompt).toContain(
      "never repeat or reword a previous or handled idea",
    );
    expect(prompt).toContain('"handled":["Started idea"]');
    // Feed posts carry no handled list.
    expect(
      inspirationPrompt("feed", {
        instructions: "",
        recent: "",
        goals: "[]",
        liked: [],
        previous: [],
        handled: ["Started idea"],
      }),
    ).not.toContain('"handled"');
  });
});
