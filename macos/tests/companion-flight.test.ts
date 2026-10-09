import { afterEach, describe, expect, it, vi } from "vitest";
import {
  companionFaceSelector,
  companionFlight,
  flyCompanion,
} from "../ui/companionFlight";

const rect = (left: number, top: number, size: number) =>
  ({ left, top, width: size, height: size }) as DOMRect;

const originalAnimate = HTMLElement.prototype.animate;
afterEach(() => {
  HTMLElement.prototype.animate = originalAnimate;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("companion flight", () => {
  it("picks the portrait at the top of the chat or of the rail", () => {
    expect(companionFaceSelector("chat")).toContain(".toolbar-avatar");
    expect(companionFaceSelector("feed")).toContain(".rail-companion");
    // Both name the portrait wrapper the chat and the rail render.
    document.body.innerHTML =
      '<div class="toolbar-avatar"><span class="companion-portrait"></span></div>' +
      '<div class="rail-companion"><span class="companion-portrait"></span></div>';
    expect(document.querySelector(companionFaceSelector("chat"))).toBeTruthy();
    expect(document.querySelector(companionFaceSelector("feed"))).toBeTruthy();
    document.body.innerHTML = "";
  });
  it("flies a copy from the old place and hands over when it lands", () => {
    const to = document.createElement("span");
    document.body.append(to);
    vi.spyOn(to, "getBoundingClientRect").mockReturnValue(rect(20, 40, 48));
    let finish: (() => void) | null = null;
    const animate = vi.fn(function (this: HTMLElement) {
      const animation = { onfinish: null, oncancel: null } as {
        onfinish: (() => void) | null;
        oncancel: (() => void) | null;
      };
      finish = () => animation.onfinish?.();
      return animation as unknown as Animation;
    });
    HTMLElement.prototype.animate = animate;
    flyCompanion(rect(600, 12, 56), to);
    expect(to.style.visibility).toBe("hidden");
    expect(document.body.children).toHaveLength(2);
    const [frames, options] = animate.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(frames[0].transform).toBe(
      `translate(580px, -28px) scale(${56 / 48})`,
    );
    expect(options.duration).toBe(companionFlight.durationMs);
    finish!();
    expect(to.style.visibility).toBe("");
    expect(document.body.children).toHaveLength(1);
  });
  it("stays put when motion is reduced", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const to = document.createElement("span");
    document.body.append(to);
    flyCompanion(rect(600, 12, 56), to);
    expect(to.style.visibility).toBe("");
    expect(document.body.children).toHaveLength(1);
  });
});
