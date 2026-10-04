import { afterEach, describe, expect, it, vi } from "vitest";
import { listenForEdgePull, type EdgePull } from "../src/gesture";

// A stand-in document that records listeners, so touches can be replayed.
function page() {
  const listeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("document", {
    addEventListener: (name: string, fn: (event: unknown) => void) =>
      listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
    documentElement: {},
  });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  const touch = (name: string, x: number, y: number, time: number) => {
    const event = {
      timeStamp: time,
      touches: name === "touchend" ? [] : [{ clientX: x, clientY: y }],
      preventDefault: vi.fn(),
    };
    listeners.get(name)?.(event);
    return event;
  };
  return { listeners, touch };
}

afterEach(() => vi.unstubAllGlobals());

describe("Pulling the sidebar in from the screen edge", () => {
  function pullTo(points: [number, number, number][], allowed = true) {
    const { touch, listeners } = page();
    const pulls: EdgePull[] = [];
    const seen: number[] = [];
    const stop = listenForEdgePull({
      width: () => 400,
      allowed: () => allowed,
      onStart: (pull) => {
        pull.follow = (progress) => seen.push(progress);
        pulls.push(pull);
      },
    });
    const [first, ...rest] = points;
    touch("touchstart", ...first);
    const moves = rest.map((point) => touch("touchmove", ...point));
    touch("touchend", 0, 0, (rest.at(-1)?.[2] ?? 0) + 16);
    stop();
    return { pull: pulls[0], seen, moves, listeners };
  }

  it("follows a finger from the edge and opens past a third", () => {
    const { pull, seen, moves, listeners } = pullTo([
      [3, 400, 0],
      [40, 402, 100],
      [120, 404, 200],
      [200, 405, 300],
    ]);
    expect(seen.at(-1)).toBeCloseTo(197 / 400);
    expect(pull.released).toBe("open");
    // The page does not scroll while the sidebar follows the finger.
    expect(moves.at(-1)!.preventDefault).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it("springs back after a short slow pull, opens on a flick", () => {
    expect(
      pullTo([
        [3, 400, 0],
        [40, 400, 200],
        [60, 400, 400],
      ]).pull.released,
    ).toBe("close");
    expect(
      pullTo([
        [3, 400, 0],
        [30, 400, 10],
        [90, 400, 20],
      ]).pull.released,
    ).toBe("open");
  });

  it("ignores touches away from the edge, vertical ones, and covered pages", () => {
    expect(
      pullTo([
        [150, 400, 0],
        [300, 400, 100],
      ]).pull,
    ).toBeUndefined();
    expect(
      pullTo([
        [3, 400, 0],
        [10, 480, 100],
      ]).pull,
    ).toBeUndefined();
    expect(
      pullTo(
        [
          [3, 400, 0],
          [200, 400, 100],
        ],
        false,
      ).pull,
    ).toBeUndefined();
  });
});
