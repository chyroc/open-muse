import { describe, expect, it } from "vitest";
import { continuousRectPath } from "../src/ContinuousSurface";

describe("Continuous corners", () => {
  it("eases into each corner over 1.6 times the radius", () => {
    const path = continuousRectPath(386, 700, 54);
    // The top edge starts bending 1.6 × 54 = 86.4 before the right edge.
    expect(path.startsWith("M299.6 0")).toBe(true);
    // Each corner keeps a circular middle section of the same radius.
    expect(path.match(/a54 54 0 0 1/g)).toHaveLength(4);
    expect(path.endsWith("Z")).toBe(true);
  });
  it("limits the radius to half the shorter side and handles no radius", () => {
    expect(continuousRectPath(100, 40, 54)).toContain("a20 20");
    expect(continuousRectPath(100, 40, 0)).toBe("M0 0H100V40H0Z");
    expect(continuousRectPath(0, 40, 10)).toBe("");
  });
});
