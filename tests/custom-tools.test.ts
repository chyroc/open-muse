import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { Client, type CustomToolResult } from "../src/api";
import { LocalDatabase } from "../src/direct/storage";
import { uuid } from "../shared/crypto";
import {
  pendingCustomTools,
  pendingPermissions,
  taskState,
  type AgentEvent,
} from "../shared/types";

const blocked = (ids: string[]): AgentEvent => ({
  id: "idle",
  type: "session.status_idle",
  stop_reason: { type: "requires_action", event_ids: ids },
});
const call: AgentEvent = {
  id: "call",
  type: "agent.custom_tool_use",
  name: "mac_screenshot",
  input: {},
};
const ask: AgentEvent = {
  id: "ask",
  type: "agent.tool_use",
  name: "bash",
  evaluated_permission: "ask",
};

async function fixture(history: AgentEvent[]) {
  const posts: { events: Record<string, unknown>[] }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const path = new URL(String(input)).pathname.slice("/api/v3".length);
    if (path === "/sessions/sesn-1/events" && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return Response.json({ data: body.events });
    }
    if (path === "/sessions/sesn-1/events")
      return Response.json({ data: history });
    return Response.json({}, { status: 404 });
  });
  const client = new Client({
    database: new LocalDatabase(`custom-tools-${uuid()}`),
    fetcher,
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `test-${uuid()}`,
          project: "",
        }),
      write: async () => {},
    },
  });
  await client.restore();
  return { client, posts };
}
const result = (id = "call"): CustomToolResult => ({
  custom_tool_use_id: id,
  is_error: false,
  content: [
    { type: "text", text: '{"ok":true}' },
    {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    },
  ],
});

describe("custom tool calls", () => {
  it("are pending results, never permission requests", () => {
    const events = [ask, call, blocked(["ask", "call"])];
    expect(pendingPermissions(events).map((e) => e.id)).toEqual(["ask"]);
    expect(pendingCustomTools(events).map((e) => e.id)).toEqual(["call"]);
    expect(taskState(events)).toBe("attention");
    const answered = [
      ...events,
      { id: "r", type: "user.custom_tool_result", custom_tool_use_id: "call" },
    ];
    expect(pendingCustomTools(answered)).toEqual([]);
    // Once the session runs again nothing is pending.
    expect(
      pendingCustomTools([call, { id: "run", type: "session.status_running" }]),
    ).toEqual([]);
  });
  it("answers a blocking call once with text and an image", async () => {
    const { client, posts } = await fixture([call, blocked(["call"])]);
    const page = await client.answerCustomTools("sesn-1", [result()]);
    expect(posts).toHaveLength(1);
    expect(posts[0].events[0]).toMatchObject({
      type: "user.custom_tool_result",
      custom_tool_use_id: "call",
      is_error: false,
    });
    expect(String(posts[0].events[0].id)).toMatch(/^evt-/);
    expect(page.data[0].type).toBe("user.custom_tool_result");
  });
  it("refuses to answer a call that is no longer pending", async () => {
    const answered: AgentEvent = {
      id: "r",
      type: "user.custom_tool_result",
      custom_tool_use_id: "call",
    };
    const { client, posts } = await fixture([
      call,
      blocked(["call"]),
      answered,
    ]);
    await expect(
      client.answerCustomTools("sesn-1", [result()]),
    ).rejects.toThrow("no longer pending");
    await expect(
      client.answerCustomTools("sesn-1", [result("other")]),
    ).rejects.toThrow("no longer pending");
    expect(posts).toHaveLength(0);
  });
  it("rejects malformed or duplicated results before any request", async () => {
    const { client, posts } = await fixture([call, blocked(["call"])]);
    await expect(
      client.answerCustomTools("sesn-1", [result(), result()]),
    ).rejects.toThrow();
    await expect(
      client.answerCustomTools("sesn-1", [
        {
          ...result(),
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/gif", data: "AA==" },
            },
          ] as unknown as CustomToolResult["content"],
        },
      ]),
    ).rejects.toThrow();
    await expect(
      client.answerCustomTools("sesn-1", [{ ...result(), content: [] }]),
    ).rejects.toThrow();
    expect(posts).toHaveLength(0);
  });
});
