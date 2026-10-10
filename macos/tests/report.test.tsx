import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { issueLink, reportPage } from "../ui/report";
import { ReportDialog } from "../ui/ReportDialog";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
});
const read = (link: string) => new URL(link).searchParams;

describe("Mac problem reports", () => {
  it("prefills a GitHub issue with the words, a place for the picture and the setup", () => {
    const link = issueLink({
      description: "The chat stops scrolling\nIt stays above the newest reply.",
      diagnostics: "Open Muse 20261010-abc\nmacOS 26.0",
      picture: true,
    });
    expect(link.startsWith(reportPage)).toBe(true);
    const params = read(link);
    expect(params.get("title")).toBe("The chat stops scrolling");
    const body = params.get("body")!;
    expect(body).toContain("It stays above the newest reply.");
    expect(body).toContain("### Screenshot");
    expect(body).toContain("Open Muse 20261010-abc\nmacOS 26.0");
    expect(
      read(
        issueLink({ description: "", diagnostics: "x", picture: false }),
      ).get("title"),
    ).toBe("Problem report");
  });
  it("shortens long words, never the setup, to keep the address short", () => {
    const link = issueLink({
      description: "很长的描述".repeat(800),
      diagnostics: "Setup line",
      picture: false,
    });
    expect(link.length).toBeLessThanOrEqual(7600);
    expect(read(link).get("body")).toContain("Setup line");
    expect(read(link).get("body")).not.toContain("### Screenshot");
  });
  it("opens the issue with the picture only when it is kept", async () => {
    const postMessage = vi.fn(async (body: Record<string, string>) =>
      body.operation === "submit" ? true : true,
    );
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museReport: { postMessage } } },
    });
    HTMLDialogElement.prototype.showModal ??= function () {};
    HTMLDialogElement.prototype.close ??= function () {};
    const onOpened = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <ReportDialog
          picture="data:image/png;base64,AAAA"
          signedIn
          onClose={vi.fn()}
          onOpened={onOpened}
        />,
      ),
    );
    const box = host.querySelector<HTMLInputElement>(".report-picture input")!;
    expect(box.checked).toBe(true);
    await act(async () => box.click());
    const open = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "Open on GitHub",
    )!;
    await act(async () => open.click());
    const submit = postMessage.mock.calls.find(
      ([body]) => body.operation === "submit",
    )![0];
    expect(submit.image).toBe("false");
    expect(submit.url.startsWith(reportPage)).toBe(true);
    expect(onOpened).toHaveBeenCalledWith(false);
  });
  it("translates its copy and opens only the project's issue page natively", () => {
    for (const file of [
      "macos/ui/ReportDialog.tsx",
      "macos/ui/DesktopApp.tsx",
      "macos/ui/HelpSettings.tsx",
    ])
      for (const [, key] of readFileSync(file, "utf8").matchAll(
        /\bt\(\s*"([^"]+)"/g,
      ))
        expect(zhCN[key], key).toBeTruthy();
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain(`static let reportPage = "${reportPage}"`);
    expect(swift).toContain("link.hasPrefix(Self.reportPage)");
  });
});
