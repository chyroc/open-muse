import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import {
  PanelEdgeHandle,
  panelClosePreview,
  panelEdge,
  panelOpacity,
  panelReveal,
  type PanelDrag,
} from "../ui/PanelEdge";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

async function mount(mode: "open" | "close") {
  const drags: PanelDrag[] = [];
  const commit = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <PanelEdgeHandle
        mode={mode}
        width={345}
        label="Edge"
        onDrag={(drag) => drags.push(drag)}
        onCommit={commit}
      />,
    ),
  );
  const edge = host.querySelector<HTMLElement>(".panel-edge")!;
  const pointer = async (type: string, clientX: number) =>
    act(async () => {
      edge.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          isPrimary: true,
          pointerId: 1,
          clientX,
          clientY: 100,
        }),
      );
    });
  return { drags, commit, pointer };
}

describe("status panel edge", () => {
  it("reveals a pulled panel with the pointer and fades it in early", () => {
    expect(panelReveal(1000, 990, 345)).toBe(10);
    expect(panelReveal(1000, 400, 345)).toBe(345);
    expect(panelReveal(1000, 1010, 345)).toBe(0);
    expect(panelOpacity(0, 345)).toBe(0);
    expect(panelOpacity(345 * panelEdge.fadeEnd, 345)).toBe(1);
    expect(panelOpacity(345 * 0.15, 345)).toBeCloseTo(0.5);
  });
  it("only closes once the push leaves a sliver of the panel", () => {
    expect(panelClosePreview(1000, 1300, 345)).toBe(false);
    expect(panelClosePreview(1000, 1325, 345)).toBe(true);
  });
  it("opens on a click, or on a pull past the threshold", async () => {
    const { commit, pointer, drags } = await mount("open");
    await pointer("pointerdown", 1000);
    await pointer("pointerup", 1001);
    expect(commit).toHaveBeenLastCalledWith(true);
    await pointer("pointerdown", 1000);
    await pointer("pointermove", 970);
    expect(drags.at(-1)).toEqual({ kind: "opening", reveal: 30 });
    await pointer("pointerup", 970);
    expect(commit).toHaveBeenLastCalledWith(false);
    expect(drags.at(-1)).toEqual({ kind: "idle" });
    await pointer("pointerdown", 1000);
    await pointer("pointermove", 1000 - panelEdge.openThreshold);
    await pointer("pointerup", 1000 - panelEdge.openThreshold);
    expect(commit).toHaveBeenLastCalledWith(true);
  });
  it("closes on a click, and springs back from a short push", async () => {
    const { commit, pointer, drags } = await mount("close");
    await pointer("pointerdown", 500);
    await pointer("pointerup", 500);
    expect(commit).toHaveBeenLastCalledWith(false);
    await pointer("pointerdown", 500);
    await pointer("pointermove", 600);
    expect(drags.at(-1)).toEqual({ kind: "closing", preview: false });
    await pointer("pointerup", 600);
    expect(commit).toHaveBeenLastCalledWith(true);
    await pointer("pointerdown", 500);
    await pointer("pointermove", 840);
    expect(drags.at(-1)).toEqual({ kind: "closing", preview: true });
    await pointer("pointerup", 840);
    expect(commit).toHaveBeenLastCalledWith(false);
  });
  it("names both edges in each language", () => {
    for (const key of [
      "Click or drag to open the status panel",
      "Click or drag to close the status panel",
    ])
      expect(zhCN[key], key).toBeTruthy();
  });
});
