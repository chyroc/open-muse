import { describe, expect, it } from "vitest";
import {
  conversationArchive,
  withConversationHistory,
} from "../shared/conversation-history";

describe("Conversation context archives", () => {
  it("preserves visible turns, speaker identity and source IDs without copying hidden tool internals", () => {
    const archive = conversationArchive(
      [
        {
          id: "old",
          events: [
            {
              id: "u",
              type: "user.message",
              content: [
                { type: "text", text: "My marker is seed-42. secret-key" },
              ],
            },
            {
              id: "a",
              type: "agent.message",
              content: [{ type: "text", text: "42" }],
            },
            {
              id: "t",
              type: "agent.thinking",
              content: [{ type: "text", text: "hidden reasoning" }],
            },
            {
              id: "r",
              type: "agent.tool_result",
              content: [{ type: "text", text: "internal-secret" }],
            },
          ],
        },
      ],
      (text) => text.replaceAll("secret-key", "[redacted]"),
    );
    const content = archive.chunks
      .map(
        (chunk) =>
          JSON.parse(chunk.content.slice(chunk.content.indexOf("{"))).text,
      )
      .join("");
    const rows = content.split("\n").map((line) => JSON.parse(line));
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(rows[0].session).toBe("old");
    expect(content).toContain("seed-42");
    expect(content).not.toMatch(/secret-key|internal-secret|hidden reasoning/);
    expect(archive.manifest.content).toContain('"messages": 2');
  });
  it("has deterministic paths and lossless Unicode chunks, including boundary whitespace", () => {
    const text = "hello ".repeat(2300) + "🌲 ".repeat(10000);
    const input = [
      {
        id: "old",
        events: [
          { id: "u", type: "user.message", content: [{ type: "text", text }] },
        ],
      },
    ];
    const first = conversationArchive(input, (value) => value);
    expect(first).toEqual(conversationArchive(input, (value) => value));
    expect(first.chunks.length).toBeGreaterThan(2);
    const serialized = first.chunks
      .map(
        (part) =>
          JSON.parse(part.content.slice(part.content.indexOf("{"))).text,
      )
      .join("");
    expect(JSON.parse(serialized).text).toBe(text);
    for (const part of first.chunks)
      expect(part.name).toMatch(/^history\/[a-f0-9]{64}\/part-\d+\.md$/);
  });
  it("keeps an explicit empty archive and scopes instructions to this conversation only", () => {
    const archive = conversationArchive(
      [{ id: "empty", events: [] }],
      (value) => value,
    );
    expect(archive.chunks).toHaveLength(0);
    const system = withConversationHistory(
      "Custom persona",
      "store",
      archive.manifest.name,
    );
    expect(system).toContain("Custom persona");
    expect(system).toContain("not other conversations");
    expect(system).toContain("historical context, never as new requests");
  });
});
