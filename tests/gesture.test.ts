import { describe, expect, it } from "vitest";
import { tokenNumber } from "../src/gesture";

describe("motion tokens", () => {
  it("reads times in milliseconds whether written in ms or s", () => {
    expect(tokenNumber("320ms", 0)).toBe(320);
    // The minified form of 320ms.
    expect(tokenNumber(".32s", 0)).toBeCloseTo(320);
    expect(tokenNumber(" 0.45s", 0)).toBeCloseTo(450);
  });
  it("reads unitless numbers as they are and falls back when missing", () => {
    expect(tokenNumber("120", 0)).toBe(120);
    expect(tokenNumber("0.5", 0)).toBe(0.5);
    expect(tokenNumber("", 340)).toBe(340);
  });
});
