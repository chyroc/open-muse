import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Rail } from "../ui/Chrome";
import { StatusPanel } from "../ui/StatusPanel";
import { activityLabel } from "../ui/model";
import { CompanionSheet } from "../../src/CompanionSheet";
import { defaultIdentity } from "../../src/direct/identity";
import { initializeLanguage } from "../../shared/i18n";
import type { Client } from "../../src/api";

afterEach(() => vi.unstubAllGlobals());
const noop = () => {};

describe("Apple UI localization", () => {
  it.each(["en", "zh-CN"])(
    "names known tools plainly in the Mac activity list in %s",
    (language) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
      initializeLanguage();
      const zh = language === "zh-CN";
      expect(activityLabel("memory_read")).toBe(
        zh ? "读取个人记忆" : "Read personal memory",
      );
      expect(activityLabel("memory_edit")).toBe(
        zh ? "更新个人记忆" : "Update personal memory",
      );
      expect(activityLabel("mac_screenshot")).toBe(
        zh ? "查看屏幕" : "Look at the screen",
      );
      expect(activityLabel("web_search")).toBe(zh ? "搜索网页" : "Search the web");
      // A person's own tools keep their protocol name.
      expect(activityLabel("crm_lookup")).toBe("crm_lookup");
      expect(activityLabel(undefined)).toBe(zh ? "工具调用" : "Tool call");
    },
  );
  it.each(["en", "zh-CN"])(
    "renders Mac navigation and status in %s without changing routes",
    (language) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
      initializeLanguage();
      expect(document.documentElement.lang).toBe(language);
      const rail = renderToStaticMarkup(
        <Rail
          page="chat"
          onNavigate={noop}
          onSearch={noop}
          onSettings={noop}
          onShortcuts={noop}
        />,
      );
      expect(rail).toContain(
        language === "zh-CN" ? 'aria-label="设置"' : 'aria-label="Settings"',
      );
      // The Mac rail follows the desktop app it mirrors, not the mobile wording.
      expect(rail).toContain(language === "zh-CN" ? "资源库" : "Library");
      const panel = renderToStaticMarkup(
        <StatusPanel
          identity={defaultIdentity()}
          status=""
          tab="identity"
          onTab={noop}
          onClose={noop}
          events={[]}
          approvals={[]}
          busy={false}
          onConfirm={noop}
          onDocument={noop}
          onPrefill={noop}
        />,
      );
      expect(panel).toContain(
        language === "zh-CN" ? 'aria-label="身份"' : 'aria-label="Identity"',
      );
      expect(panel).toContain('aria-labelledby="status-identity"');
      expect(panel).toContain(
        language === "zh-CN"
          ? 'aria-label="打开 MEMORY.md"'
          : 'aria-label="Open MEMORY.md"',
      );
    },
  );

  it("keeps mobile status tabs functional in Chinese and leaves identity file names intact", async () => {
    vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", ["zh-CN"]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const identity = defaultIdentity();
    const client = {
      companionIdentity: async () => identity,
      signedIn: () => false,
    } as unknown as Client;
    try {
      await act(async () =>
        root.render(
          <CompanionSheet
            client={client}
            identity={identity}
            onIdentity={noop}
            onClose={noop}
            status="未连接"
            events={[]}
            permissions={[]}
            busy={false}
            onConfirm={noop}
            onNew={noop}
          />,
        ),
      );
      expect(host.textContent).toContain("暂无进行中的任务");
      const tab = host.querySelector<HTMLButtonElement>(
        '[role="tab"][aria-label="身份"]',
      )!;
      await act(async () => tab.click());
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(
        host.querySelector('[aria-label="打开 MEMORY.md"]'),
      ).not.toBeNull();
      expect(host.textContent).toContain("这些是初始模板。");
      await act(async () =>
        host
          .querySelector<HTMLButtonElement>('[role="tab"][aria-label="批准"]')!
          .click(),
      );
      expect(host.textContent).toContain("暂无批准记录");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
