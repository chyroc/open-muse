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
      // Like an environment: a matching read keeps the drift.
      if (!mode && status.review === "drift") return { change: "matches_now" };
      status = {
        ...status,
        review: mode === "discard" ? "drift" : undefined,
      };
      return { change: mode === "discard" ? "discarded" : "adopted" };
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
    const badge = () => host.querySelector(".small-badge")!.textContent;
    // A workspace awaiting a decision is never shown as simply ready.
    expect(badge()).toBe("Needs review");
    expect(host.textContent).toContain("Background work stays paused");
    // Adopting is described as accepting Ark's values, not as confirmation.
    expect(host.textContent).toContain(
      "An earlier unconfirmed change may still arrive later.",
    );
    expect(buttons()).toEqual([
      "Save the current settings",
      "Keep the saved settings",
    ]);
    await press("Keep the saved settings");
    expect(client.checkWorkspaceSettings).toHaveBeenCalledWith("discard");
    // Kept settings are shown as possibly different from Ark, never as in sync.
    expect(badge()).toBe("Needs review");
    expect(host.textContent).toContain(
      "the agent or environment in Ark may differ from them",
    );
    expect(buttons()).toEqual([
      "Check the settings again",
      "Save the current settings",
    ]);
    await press("Check the settings again");
    expect(client.checkWorkspaceSettings).toHaveBeenLastCalledWith();
    // A matching read is reported as matching when checked, and the
    // workspace still needs review.
    expect(host.textContent).toContain(
      "Ark matched the saved settings when checked.",
    );
    expect(badge()).toBe("Needs review");
    await press("Save the current settings");
    expect(client.checkWorkspaceSettings).toHaveBeenLastCalledWith("adopt");
    expect(buttons()).toEqual([]);
    expect(badge()).toBe("Ready");
  });

  it("shows the same decisions in Simplified Chinese", async () => {
    await setup("zh-CN", "settings");
    expect(host.querySelector(".small-badge")!.textContent).toBe("需要确认");
    expect(host.textContent).toContain("之前一次未确认的更改仍可能稍后生效");
    expect(buttons()).toEqual(["保存当前设置", "保留已保存的设置"]);
    await press("保留已保存的设置");
    expect(host.textContent).toContain("Ark 中的智能体或环境现在或以后都可能");
    expect(buttons()).toEqual(["重新检查设置", "保存当前设置"]);
    await press("重新检查设置");
    expect(host.textContent).toContain("检查时 Ark 与已保存的设置一致");
  });

  it("offers only a check for an unconfirmed change and defaults to English", async () => {
    await setup("fr-FR", "unconfirmed");
    expect(buttons()).toEqual(["Check the last change"]);
  });
});
