import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../shared/types";
import { badgeLabel, UnreadCounter, useUnreadBadge } from "../ui/unread";

const message = (id: string, type = "agent.message") =>
  ({ id, type, content: [{ type: "text", text: id }] }) as AgentEvent;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});

describe("unread replies", () => {
  it("treats a conversation's first messages as history", () => {
    const counter = new UnreadCounter();
    expect(counter.observe("a", [])).toBe(0);
    expect(
      counter.observe("a", [message("u1", "user.message"), message("r1")]),
    ).toBe(0);
    expect(
      counter.observe("a", [
        message("u1", "user.message"),
        message("r1"),
        message("u2", "user.message"),
        message("r2"),
      ]),
    ).toBe(1);
    // Switching conversations starts a new baseline.
    expect(counter.observe("b", [message("r9")])).toBe(0);
    expect(counter.observe("b", [message("r9"), message("r10")])).toBe(1);
  });

  it("labels the Dock badge with a short count", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(3)).toBe("3");
    expect(badgeLabel(120)).toBe("99+");
  });

  it("counts replies only while the window is in the background", async () => {
    const posts: object[] = [];
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: {
        messageHandlers: {
          museWindow: { postMessage: (v: object) => posts.push(v) },
        },
      },
    });
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    let shown = -1;
    function Probe({ list }: { list: AgentEvent[] }) {
      shown = useUnreadBadge("a", list);
      return null;
    }
    const host = document.createElement("div");
    root = createRoot(host);
    const first = [message("u1", "user.message"), message("r1")];
    await act(async () => root!.render(<Probe list={first} />));
    await act(async () =>
      root!.render(<Probe list={[...first, message("r2")]} />),
    );
    expect(shown).toBe(0);

    focus.mockReturnValue(false);
    await act(async () =>
      root!.render(
        <Probe
          list={[...first, message("r2"), message("r3"), message("r4")]}
        />,
      ),
    );
    expect(shown).toBe(2);
    expect(posts.at(-1)).toEqual({ name: "badge", value: "2" });

    focus.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(shown).toBe(0);
    expect(posts.at(-1)).toEqual({ name: "badge", value: "" });
  });

  it("lets only the workspace set a bounded Dock label", () => {
    const source = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(source).toContain(
      'body?["name"] == "badge", message.webView === webView',
    );
    expect(source).toContain("NSApp.dockTile.badgeLabel");
  });
});
