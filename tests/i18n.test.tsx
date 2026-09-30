import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  formatLocale,
  resolveLanguage,
  systemLanguage,
  t,
} from "../shared/i18n";
import { zhCN } from "../shared/locales/zh-CN";
import { groups, labels } from "../shared/ma";
import { goalCategories, goalStarter } from "../shared/goals";
import { ChatComposer } from "../src/ChatUI";
import { PermissionCard } from "../src/PermissionCard";
import { AuthPanel } from "../src/AuthPanel";
import { Markdown } from "../src/components";
import { Client } from "../src/api";

afterEach(() => vi.unstubAllGlobals());

describe("System language selection", () => {
  it.each([
    [["zh-CN", "en-US"], "zh-CN"],
    [["zh-Hant-TW"], "zh-CN"],
    [["zh_Hans_CN"], "zh-CN"],
    [["en-GB", "zh-CN"], "en"],
    [["fr-FR", "zh-HK", "en"], "zh-CN"],
    [["fr-FR", "ja-JP"], "en"],
    [[], "en"],
  ] as const)("resolves %j to %s", (languages, expected) => {
    expect(resolveLanguage(languages)).toBe(expected);
  });

  it("prefers the native app's language list over the browser defaults", () => {
    vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-Hans-CN", "en"]);
    expect(systemLanguage()).toBe("zh-CN");
    expect(formatLocale()).toBe("zh-CN");
    expect(t("Settings")).toBe("设置");
  });

  it("uses browser preferences when the native bridge is absent", () => {
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", undefined);
    vi.stubGlobal("navigator", { languages: ["zh-TW"], language: "zh-TW" });
    expect(systemLanguage()).toBe("zh-CN");
    vi.stubGlobal("navigator", { language: "en-AU" });
    expect(systemLanguage()).toBe("en");
    expect(formatLocale()).toBe("en-US");
    vi.stubGlobal("navigator", undefined);
  });

  it("interpolates values once without translating or interpreting them", () => {
    expect(t("Message {name}", { name: "Settings {name} $&" }, "zh-CN")).toBe(
      "给 Settings {name} $& 发消息",
    );
    expect(t("Unknown upstream response", {}, "zh-CN")).toBe(
      "Unknown upstream response",
    );
    expect(t("toString", {}, "zh-CN")).toBe("toString");
    expect(t("Message {name}", { name: "Muse" }, "en")).toBe("Message Muse");
  });
});

describe("Localized mobile UI", () => {
  it.each(["en", "zh-CN"])(
    "renders connection and composer controls in %s",
    (language) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
      const chinese = language === "zh-CN";
      const html = renderToStaticMarkup(
        <ChatComposer
          value="Settings 我的原文"
          setValue={() => {}}
          onSend={() => {}}
          onStop={() => {}}
          onActions={() => {}}
          running={false}
          busy={false}
          disabled
        />,
      );
      expect(html).toContain(
        chinese ? 'aria-label="给 Muse 发消息"' : 'aria-label="Message Muse"',
      );
      expect(html).toContain(
        chinese
          ? 'aria-label="发送消息" disabled'
          : 'aria-label="Send message" disabled',
      );
      expect(html).toContain("Settings 我的原文");
      const auth = renderToStaticMarkup(
        <AuthPanel client={new Client()} onChanged={() => {}} />,
      );
      expect(auth).toContain(chinese ? "开始 SSO 登录" : "Start SSO sign-in");
      expect(auth).toContain(chinese ? "未登录" : "Not signed in");
    },
  );

  it("localizes approval scope without changing tool names or parameters", () => {
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    const html = renderToStaticMarkup(
      <PermissionCard
        event={{
          id: "tool",
          type: "agent.tool_use",
          name: "web_search",
          input: { query: "Search original 用户查询", max_results: 3 },
        }}
        busy={false}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain("允许网页搜索？");
    expect(html).toContain("仅授权此次调用");
    expect(html).toContain("批准");
    expect(html).toContain("web_search");
    expect(html).toContain("Search original 用户查询");
    expect(html).toContain("max_results");
    expect(
      renderToStaticMarkup(<Markdown text="Settings / Send / 用户原文" />),
    ).toContain("Settings / Send / 用户原文");
    expect(goalStarter("health")).toContain("健康目标");
  });
});

describe("Translation catalog integrity", () => {
  it("keeps all interpolation names identical between languages", () => {
    const variables = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [english, chinese] of Object.entries(zhCN)) {
      expect(chinese.trim(), english).not.toBe("");
      expect(variables(chinese), english).toEqual(variables(english));
    }
  });

  it("covers every statically referenced translation and shared UI label", () => {
    const files = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory()
          ? files(file)
          : /\.tsx?$/.test(file)
            ? [file]
            : [];
      });
    const missing = new Set<string>();
    for (const file of [
      ...files("src"),
      ...files("macos/ui"),
      ...files("shared"),
    ]) {
      const ast = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === "t") {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg) && !Object.hasOwn(zhCN, arg.text))
            missing.add(`${file}: ${arg.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    for (const message of [
      ...groups.flatMap((group) => [group.label, group.hint]),
      ...Object.values(labels),
      ...goalCategories.map((category) => category.label),
    ]) {
      if (!Object.hasOwn(zhCN, message)) missing.add(message);
    }
    expect([...missing]).toEqual([]);
  });

  it("packages the two native languages and preserves English development docs", () => {
    for (const file of ["ios/App/App/Info.plist", "macos/Info.plist"]) {
      const plist = readFileSync(file, "utf8");
      expect(plist).toContain("CFBundleLocalizations");
      expect(plist).toContain("<string>zh-Hans</string>");
      expect(plist).toContain("<string>en</string>");
    }
    const keys = (language: string) =>
      [
        ...readFileSync(
          `macos/${language}.lproj/Localizable.strings`,
          "utf8",
        ).matchAll(/^"([^"]+)" =/gm),
      ]
        .map((match) => match[1])
        .sort();
    expect(keys("zh-Hans")).toEqual(keys("en"));
    expect(readFileSync("AGENTS.md", "utf8")).toBe(
      readFileSync("CLAUDE.md", "utf8"),
    );
  });
});
