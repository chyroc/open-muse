import { describe, expect, it } from "vitest";
import { isNetworkFailure } from "../shared/network-error";

describe("network failures", () => {
  it("recognizes the browsers' wording for a request that never arrived", () => {
    for (const message of [
      "Load failed",
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "The network connection was lost.",
      "The Internet connection appears to be offline.",
    ])
      expect(isNetworkFailure(new TypeError(message))).toBe(true);
  });
  it("recognizes the direct client's own network and timeout errors", () => {
    for (const name of ["NetworkError", "TimeoutError"]) {
      const error = new Error("Readable copy");
      error.name = name;
      expect(isNetworkFailure(error)).toBe(true);
    }
    expect(
      isNetworkFailure(new DOMException("Timed out", "TimeoutError")),
    ).toBe(true);
  });
  it("leaves other errors as they are", () => {
    expect(isNetworkFailure(new Error("Load failed"))).toBe(false);
    expect(isNetworkFailure(new TypeError("x is undefined"))).toBe(false);
    expect(isNetworkFailure("Load failed")).toBe(false);
    expect(
      isNetworkFailure(new DOMException("Cancelled", "AbortError")),
    ).toBe(false);
  });
});
