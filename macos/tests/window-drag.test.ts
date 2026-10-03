import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installWindowDrag,
  startsWindowDrag,
  titleStripHeight,
} from "../ui/windowDrag";

afterEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: undefined,
  });
});

describe("dragging the window by its top strip", () => {
  it("starts from empty parts of the strip only", () => {
    document.body.innerHTML =
      '<header><span id="title">Chat</span><button id="menu"><svg id="icon"></svg></button><textarea id="field"></textarea></header>';
    const at = (id: string, clientY = 20, button = 0) =>
      startsWindowDrag({
        button,
        clientY,
        target: document.getElementById(id),
      });
    expect(at("title")).toBe(true);
    expect(at("menu")).toBe(false);
    expect(at("icon")).toBe(false);
    expect(at("field")).toBe(false);
    expect(at("title", 80)).toBe(false);
    expect(at("title", 20, 2)).toBe(false);
  });
  it("asks the shell to drag on a press and to zoom on a double click", () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { museWindow: { postMessage } } },
    });
    document.body.innerHTML = '<div id="strip"></div>';
    const stop = installWindowDrag();
    const strip = document.getElementById("strip")!;
    strip.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientY: 10 }),
    );
    strip.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientY: 10 }),
    );
    strip.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientY: 200 }),
    );
    expect(postMessage.mock.calls.map(([body]) => body.name)).toEqual([
      "window-drag",
      "window-zoom",
    ]);
    stop();
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain("final class WindowWebView: WKWebView");
    expect(swift).toContain("window.performDrag(with: event)");
    expect(swift).toContain('"AppleActionOnDoubleClick"');
    // An inactive window still answers a press in the strip, as a title bar does.
    expect(swift).toContain(
      "override func acceptsFirstMouse(for event: NSEvent?)",
    );
    expect(swift).toContain(
      `static let titleStripHeight: CGFloat = ${titleStripHeight}`,
    );
  });
});
