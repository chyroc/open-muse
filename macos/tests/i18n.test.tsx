import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Rail } from "../ui/Chrome";
import { StatusPanel } from "../ui/StatusPanel";
import { CompanionSheet } from "../../src/CompanionSheet";
import { defaultIdentity } from "../../src/direct/identity";
import { initializeLanguage } from "../../shared/i18n";
import type { Client } from "../../src/api";

afterEach(() => vi.unstubAllGlobals());
const noop = () => {};

describe("Apple UI localization", () => {
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
          onStatus={noop}
        />,
      );
      expect(rail).toContain(
        language === "zh-CN" ? 'title="设置（⌘,）"' : 'title="Settings (⌘,)"',
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
            sessions={[]}
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
          .querySelector<HTMLButtonElement>('[role="tab"][aria-label="审批"]')!
          .click(),
      );
      expect(host.textContent).toContain("此对话中没有等待批准的操作。");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
