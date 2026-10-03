import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePanel } from "../../src/WorkspacePanel";
import type { Client } from "../../src/api";
import type { WorkspaceStatus } from "../../shared/types";
import type { AccountWorkspaceComparison } from "../../shared/account-workspace";

let root: Root | undefined, host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});
const reviewed = "a".repeat(64);
async function setup(
  language: string,
  review: WorkspaceStatus["review"],
  comparison: Partial<AccountWorkspaceComparison> = {},
) {
  vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
  let status: WorkspaceStatus = { state: "ready", message: "", review };
  const client = {
    workspaceStatus: vi.fn(async () => status),
    compareWorkspaceSettings: vi.fn(
      async (): Promise<AccountWorkspaceComparison> => ({
        revision: 3,
        kind: "environment",
        saved: { config: { type: "cloud", networking: { type: "limited" } } },
        current: {
          config: { type: "cloud", networking: { type: "unrestricted" } },
        },
        differs: ["config"],
        unusable: [],
        tooLarge: false,
        expected: reviewed,
        ...comparison,
      }),
    ),
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
const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  )!;
async function press(label: string) {
  await act(async () => button(label).click());
}

describe("Workspace settings review", () => {
  it("shows what saving would keep and saves only the reviewed values", async () => {
    const client = await setup("en-US", "settings");
    const badge = () => host.querySelector(".small-badge")!.textContent;
    // A workspace awaiting a decision is never shown as simply ready, and
    // starting new work waits for the decision.
    expect(badge()).toBe("Needs review");
    expect(host.querySelector('a[href="#/"]')).toBeNull();
    expect(host.textContent).toContain("Background work stays paused");
    // The resource and each differing field, saved and in Ark now.
    expect(host.querySelector("h4")!.textContent).toBe("Environment settings");
    const field = host.querySelector("details")!;
    expect(field.querySelector("summary")!.textContent).toBe("config");
    const values = [...field.querySelectorAll("pre")].map((node) =>
      JSON.parse(node.textContent!),
    );
    expect(values).toEqual([
      { type: "cloud", networking: { type: "limited" } },
      { type: "cloud", networking: { type: "unrestricted" } },
    ]);
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
    expect(client.checkWorkspaceSettings).toHaveBeenLastCalledWith(
      "adopt",
      reviewed,
    );
    expect(buttons()).toEqual([]);
    expect(badge()).toBe("Ready");
    // A ready workspace needs no separate start button.
    expect(host.querySelector('a[href="#/"]')).toBeNull();
  });

  it("does not offer to save values an account cannot use", async () => {
    await setup("en-US", "settings", { unusable: ["config"] });
    expect(host.textContent).toContain(
      "config in Ark references resources an account cannot use",
    );
    expect(button("Save the current settings").disabled).toBe(true);
    expect(button("Keep the saved settings").disabled).toBe(false);
  });

  it("shows the same decisions in Simplified Chinese", async () => {
    await setup("zh-CN", "settings", { differs: [] });
    expect(host.querySelector(".small-badge")!.textContent).toBe("需要确认");
    expect(host.querySelector("h4")!.textContent).toBe("环境设置");
    expect(host.textContent).toContain(
      "本次检查时，Ark 的当前设置与已保存的设置一致",
    );
    expect(host.textContent).toContain("之前一次未确认的更改仍可能稍后生效");
    expect(buttons()).toEqual(["保存当前设置", "保留已保存的设置"]);
    await press("保留已保存的设置");
    expect(host.textContent).toContain("Ark 中的智能体或环境现在或以后都可能");
    expect(buttons()).toEqual(["重新检查设置", "保存当前设置"]);
    await press("重新检查设置");
    expect(host.textContent).toContain("检查时 Ark 与已保存的设置一致");
  });

  it("shows long values in full, since saving accepts all of them", async () => {
    const system = "x".repeat(64_000);
    await setup("en-US", "drift", {
      kind: "agent",
      saved: { system: "short" },
      current: { system },
      differs: ["system"],
    });
    const [, now] = host.querySelectorAll("details pre");
    expect(now.textContent).toBe(system);
  });

  it("shows the next resource once the first decision is made", async () => {
    const client = await setup("en-US", "drift");
    client.compareWorkspaceSettings.mockResolvedValueOnce({
      revision: 4,
      kind: "agent",
      saved: {},
      current: {},
      differs: [],
      unusable: [],
      tooLarge: false,
      expected: reviewed,
    });
    await act(async () => root!.render(<></>));
    await act(async () =>
      root!.render(<WorkspacePanel client={client as unknown as Client} />),
    );
    expect(host.querySelector("h4")!.textContent).toBe("Agent settings");
    // The first resource is accepted; the other one still drifts.
    client.checkWorkspaceSettings.mockImplementationOnce(async () => ({
      change: "adopted",
    }));
    await press("Save the current settings");
    expect(host.querySelector("h4")!.textContent).toBe("Environment settings");
    expect(client.compareWorkspaceSettings).toHaveBeenCalledTimes(3);
  });

  it("offers only a check for an unconfirmed change and defaults to English", async () => {
    const client = await setup("fr-FR", "unconfirmed");
    expect(buttons()).toEqual(["Check the last change"]);
    expect(client.compareWorkspaceSettings).not.toHaveBeenCalled();
  });
});
