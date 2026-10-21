import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import type { ModelChoice } from "../../shared/models";
import { ModelRow, ModelSettings } from "../ui/ModelSettings";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
}

function client(stored?: ModelChoice) {
  let value = stored;
  return {
    modelChoice: vi.fn(async () => value),
    setModelChoice: vi.fn(async (next: ModelChoice | null) => {
      value = next ?? undefined;
    }),
  };
}

const radios = (name: string) => [
  ...host!.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
];

describe("Mac model settings", () => {
  it("names the default model and thinking depth on the General row", async () => {
    await mount(<ModelRow client={client()} onOpen={vi.fn()} />);
    expect(host!.textContent).toContain("Doubao Seed 2.1 Pro · High");
  });

  it("saves the chosen model with its own thinking levels", async () => {
    const account = client();
    await mount(<ModelSettings client={account} />);
    expect(radios("open-muse-model")).toHaveLength(6);
    expect(radios("open-muse-effort").map((item) => item.value)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    const glm = radios("open-muse-model").find((item) =>
      item.value.startsWith("glm-"),
    )!;
    await act(async () => glm.click());
    expect(account.setModelChoice).toHaveBeenCalledWith({
      model: glm.value,
      effort: "high",
    });
    // GLM offers only two levels; the list follows the chosen model.
    expect(radios("open-muse-effort").map((item) => item.value)).toEqual([
      "low",
      "high",
    ]);
    await act(async () => radios("open-muse-effort")[0].click());
    expect(account.setModelChoice).toHaveBeenLastCalledWith({
      model: glm.value,
      effort: "low",
    });
    expect(host!.textContent).toContain("Text only");
  });

  it("shows the choice synced from another device", async () => {
    await mount(
      <ModelRow
        client={client({ model: "doubao-seed-2-1-lite-260915", effort: "low" })}
        onOpen={vi.fn()}
      />,
    );
    expect(host!.textContent).toContain("Doubao Seed 2.1 Lite · Low");
    expect(zhCN["Feed and Ideas keep the default model."]).toBeTruthy();
  });
});
