import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import { CommandPalette, paletteItems } from "../ui/Palette";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

function items(query: string, handlers = {}) {
  return paletteItems({
    query,
    chats: [
      { id: "s1", title: "Trip to Kyoto" },
      { id: "s2", title: "Tax questions" },
    ],
    goals: [
      { id: "g1", title: "Run a 10k", status: "active" },
      { id: "g2", title: "Read Kyoto guide", status: "completed" },
    ],
    onPage: vi.fn(),
    onNewChat: vi.fn(),
    onSettings: vi.fn(),
    onShortcuts: vi.fn(),
    onChat: vi.fn(),
    onGoal: vi.fn(),
    onWrite: vi.fn(),
    ...handlers,
  });
}

describe("Mac command palette", () => {
  it("lists commands without a query and matches chats and open goals", () => {
    const empty = items("");
    expect(empty.every((item) => item.group !== "message")).toBe(true);
    expect(empty.filter((item) => item.group === "commands")).toHaveLength(8);
    const kyoto = items("kyoto");
    expect(kyoto.map((item) => [item.group, item.label])).toEqual([
      ["message", "Write “kyoto” in the main chat"],
      ["chats", "Trip to Kyoto"],
    ]);
    expect(items("10K").at(-1)).toMatchObject({
      group: "goals",
      label: "Run a 10k",
    });
    expect(items("feed").map((item) => item.label)).toContain("Go to Feed");
  });
  it("moves with the arrow keys and runs the active row on Return", async () => {
    const onChat = vi.fn();
    const onWrite = vi.fn();
    const onClose = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <CommandPalette
          query="ta"
          onQuery={vi.fn()}
          loading={false}
          items={items("ta", { onChat, onWrite })}
          onClose={onClose}
        />,
      ),
    );
    const input = host.querySelector("input")!;
    expect(host.querySelector("[aria-selected=true]")?.textContent).toContain(
      "Write “ta”",
    );
    const key = (value: string) =>
      act(async () => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: value, bubbles: true }),
        );
      });
    await key("ArrowDown");
    expect(host.querySelector("[aria-selected=true]")?.textContent).toBe(
      "Tax questions",
    );
    await key("Enter");
    expect(onClose).toHaveBeenCalled();
    expect(onChat).toHaveBeenCalledWith("s2");
    expect(onWrite).not.toHaveBeenCalled();
  });
  it("translates its copy", () => {
    for (const [, key] of readFileSync("macos/ui/Palette.tsx", "utf8").matchAll(
      /\bt\(\s*"([^"]+)"/g,
    ))
      expect(zhCN[key], key).toBeTruthy();
    for (const key of ["Message", "Commands", "Chats", "Goals"])
      expect(zhCN[key], key).toBeTruthy();
  });
});
