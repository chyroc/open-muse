import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePanel } from "../../src/WorkspacePanel";
import type { Client } from "../../src/api";
import type { WorkspaceStatus } from "../../shared/types";

let root: Root | undefined, host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});
async function setup(language: string, review: WorkspaceStatus["review"]) {
  vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
  let status: WorkspaceStatus = { state: "ready", message: "", review };
  const client = {
    workspaceStatus: vi.fn(async () => status),
    checkWorkspaceSettings: vi.fn(async (mode?: "adopt" | "discard") => {
      status = {
        ...status,
        review: mode === "discard" ? "drift" : undefined,
      };
      return {};
    }),
    startWorkspace: vi.fn(async () => status),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(<WorkspacePanel client={client as unknown as Client} />),
  );
  return client;
}
const buttons = () =>
  [...host.querySelectorAll("button")].map((node) => node.textContent);
async function press(label: string) {
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((node) => node.textContent === label)!
      .click();
  });
}

describe("Workspace settings review", () => {
  it("offers both explicit decisions for a change it could not confirm", async () => {
    const client = await setup("en-US", "settings");
    expect(buttons()).toEqual([
      "Save the current settings",
      "Keep the saved settings",
    ]);
    await press("Keep the saved settings");
    expect(client.checkWorkspaceSettings).toHaveBeenCalledWith("discard");
    // Kept settings are shown as possibly different from Ark, never as in sync.
    expect(host.textContent).toContain(
      "the agent or environment in Ark may differ from them",
    );
    expect(buttons()).toEqual([
      "Check the settings again",
      "Save the current settings",
    ]);
    await press("Check the settings again");
    expect(client.checkWorkspaceSettings).toHaveBeenLastCalledWith();
    expect(buttons()).toEqual([]);
  });

  it("shows the same decisions in Simplified Chinese", async () => {
    await setup("zh-CN", "settings");
    expect(buttons()).toEqual(["保存当前设置", "保留已保存的设置"]);
    await press("保留已保存的设置");
    expect(host.textContent).toContain("Ark 中的智能体或环境可能与之不同");
    expect(buttons()).toEqual(["重新检查设置", "保存当前设置"]);
  });

  it("offers only a check for an unconfirmed change and defaults to English", async () => {
    await setup("fr-FR", "unconfirmed");
    expect(buttons()).toEqual(["Check the last change"]);
  });
});
