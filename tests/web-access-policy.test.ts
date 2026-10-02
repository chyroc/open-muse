import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canAutoApprove,
  setWebAccessDefault,
  webAccessDefault,
  webAccessKey,
} from "../shared/approval-policy";
import type { AgentEvent } from "../shared/types";

const search: AgentEvent = {
  id: "search",
  type: "agent.tool_use",
  name: "web_search",
  evaluated_permission: "ask",
};

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("web access default", () => {
  it("lets web search and page reads run unless the device asks always", () => {
    expect(canAutoApprove(search, "some")).toBe(true);
    expect(canAutoApprove(search, "always")).toBe(false);
    expect(canAutoApprove({ ...search, name: "bash" }, "some")).toBe(false);
  });
  it("defaults to some actions and only stores the stricter choice", () => {
    const values = storage();
    expect(webAccessDefault()).toBe("some");
    setWebAccessDefault("always");
    expect(values.get(webAccessKey)).toBe("always");
    expect(webAccessDefault()).toBe("always");
    expect(canAutoApprove(search)).toBe(false);
    setWebAccessDefault("some");
    expect(values.has(webAccessKey)).toBe(false);
    expect(canAutoApprove(search)).toBe(true);
  });
  it("falls back to the default when storage is missing or unreadable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(webAccessDefault()).toBe("some");
  });
});
