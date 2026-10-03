import { describe, expect, it } from "vitest";
import { identityInstructions, systemWithIdentity } from "../shared/identity";
import { toolingInstructions } from "../shared/tooling";
import {
  agentSnapshot,
  continuationAgent,
  canonicalJson,
  needsPromptRefresh,
  refreshedAgentSystem,
  type AgentSnapshot,
} from "../shared/session-refresh";
import type { Session } from "../shared/types";

const snapshot = (): AgentSnapshot => ({
  id: "agent-test",
  version: 3,
  system:
    "Custom instructions.\n<open-muse-identity>Previous app rules.</open-muse-identity>\nCustom suffix.",
  metadata: { open_muse_workspace: "owner" },
  model: { id: "test-model" },
  tools: [{ type: "test-toolset", config: { a: 1, b: 2 } }],
});
const session = (agent: unknown): Session & { agent: unknown } => ({
  id: "session-test",
  title: "Test conversation",
  status: "idle",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  category: "general",
  agent,
});

describe("Main-conversation instruction refresh", () => {
  it("requires a verified owned snapshot before preparing a replacement", () => {
    const owned = snapshot();
    expect(continuationAgent(session(owned), "owner", owned.id)).toBe(owned);
    for (const source of [
      undefined,
      "agent-test",
      { ...owned, version: 0 },
      { ...owned, metadata: { open_muse_workspace: "other" } },
    ])
      expect(() =>
        continuationAgent(session(source), "owner", owned.id),
      ).toThrow("history is intact");
  });
  it("detects stale app-owned snapshots but reuses current instructions", () => {
    const old = snapshot();
    expect(needsPromptRefresh(session(old), "owner", old.id)).toBe(true);
    old.system = systemWithIdentity("Custom instructions.");
    expect(needsPromptRefresh(session(old), "owner", old.id)).toBe(false);
  });
  it("never adopts a foreign, mismatched or incomplete snapshot", () => {
    expect(needsPromptRefresh(session(snapshot()), "other", "agent-test")).toBe(
      false,
    );
    expect(needsPromptRefresh(session(snapshot()), "owner", "other")).toBe(
      false,
    );
    for (const invalid of [
      "agent-test",
      undefined,
      { ...snapshot(), version: 0 },
      { ...snapshot(), system: undefined },
    ]) {
      expect(agentSnapshot(session(invalid))).toBeUndefined();
      expect(needsPromptRefresh(session(invalid), "owner", "agent-test")).toBe(
        false,
      );
    }
  });
  it("preserves session custom text and pinned model/tool configuration", () => {
    const source = snapshot();
    const base = { ...source, system: "A different base Agent system prompt." };
    const refreshed = refreshedAgentSystem(source, base);
    expect(refreshed).toContain("Custom instructions.");
    expect(refreshed).toContain("Custom suffix.");
    expect(refreshed).toContain(identityInstructions);
    expect(refreshed).not.toContain("Previous app rules.");
    expect(source.system).toContain("Previous app rules.");
    expect(refreshedAgentSystem({ ...source, system: refreshed }, base)).toBe(
      refreshed,
    );
  });
  it("continues a chat on a chosen model only when the person chose one", () => {
    const source = {
      ...snapshot(),
      model: { id: "chosen-model", reasoning_effort: "low" },
    };
    const base = snapshot();
    expect(() => refreshedAgentSystem(source, base)).toThrow(
      "history is intact",
    );
    expect(refreshedAgentSystem(source, base, true)).toContain(
      identityInstructions,
    );
    // Other pinned configuration still has to match.
    expect(() =>
      refreshedAgentSystem({ ...source, tools: [] }, base, true),
    ).toThrow("history is intact");
  });
  it("adds app rules to a known owned legacy snapshot without erasing custom text", () => {
    const source = { ...snapshot(), system: "Legacy custom instructions." };
    expect(needsPromptRefresh(session(source), "owner", source.id)).toBe(true);
    expect(refreshedAgentSystem(source, source)).toContain(
      "Legacy custom instructions.",
    );
  });
  it("refuses malformed or ambiguous app blocks", () => {
    for (const system of [
      "Custom <open-muse-identity>unfinished",
      "</open-muse-identity> before <open-muse-identity>",
      identityInstructions + identityInstructions,
      identityInstructions + "</open-muse-identity>",
    ]) {
      const source = { ...snapshot(), system };
      expect(() =>
        needsPromptRefresh(session(source), "owner", source.id),
      ).toThrow("history is intact");
      expect(() => refreshedAgentSystem(source, source)).toThrow(
        "history is intact",
      );
    }
  });
  it("refreshes a stale app tools block in place and leaves sessions without one alone", () => {
    const current = systemWithIdentity(
      "Custom instructions.\n<open-muse-tools>Old toolbox guide.</open-muse-tools>\nCustom suffix.",
    );
    const source = { ...snapshot(), system: current };
    expect(needsPromptRefresh(session(source), "owner", source.id)).toBe(true);
    const refreshed = refreshedAgentSystem(source, source);
    expect(refreshed).toContain(toolingInstructions);
    expect(refreshed).toContain("/mnt/session/outputs");
    expect(refreshed).not.toContain("Old toolbox guide.");
    expect(refreshed).toContain("Custom instructions.");
    expect(refreshed).toContain("Custom suffix.");
    expect(refreshed.indexOf(toolingInstructions)).toBeLessThan(
      refreshed.indexOf("Custom suffix."),
    );
    expect(refreshed).toContain(identityInstructions);
    expect(
      needsPromptRefresh(
        session({ ...source, system: refreshed }),
        "owner",
        source.id,
      ),
    ).toBe(false);
    const unmanaged = { ...snapshot(), system: systemWithIdentity("Custom.") };
    expect(needsPromptRefresh(session(unmanaged), "owner", unmanaged.id)).toBe(
      false,
    );
    expect(refreshedAgentSystem(unmanaged, unmanaged)).not.toContain(
      "<open-muse-tools>",
    );
    for (const system of [
      "Custom <open-muse-tools>unfinished",
      toolingInstructions + toolingInstructions,
    ]) {
      const malformed = { ...snapshot(), system: systemWithIdentity(system) };
      expect(() =>
        needsPromptRefresh(session(malformed), "owner", malformed.id),
      ).toThrow("history is intact");
    }
  });
  it("does not discard session-specific runtime overrides or adopt another version", () => {
    const source = snapshot();
    for (const field of [
      "model",
      "tools",
      "mcp_servers",
      "skills",
      "multiagent",
    ] as const) {
      expect(() =>
        refreshedAgentSystem(source, { ...source, [field]: { changed: true } }),
      ).toThrow("history is intact");
    }
    expect(() =>
      refreshedAgentSystem(source, { ...source, version: 4 }),
    ).toThrow("history is intact");
    expect(() =>
      refreshedAgentSystem(source, { ...source, id: "other" }),
    ).toThrow("history is intact");
  });
  it("ignores JSON object order but retains event order and all values", () => {
    const a = [{ id: "tool", input: { a: 1, b: 2 } }, { id: "reply" }];
    const b = [{ input: { b: 2, a: 1 }, id: "tool" }, { id: "reply" }];
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).not.toBe(canonicalJson([...b].reverse()));
    expect(canonicalJson(a)).not.toBe(
      canonicalJson([{ ...a[0], input: { a: 1, b: 3 } }, a[1]]),
    );
  });
});
