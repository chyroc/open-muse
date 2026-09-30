import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { ArkClient } from "../legacy-server/ark";
import { loadConfig } from "../legacy-server/config";
import type { AgentEvent, Session } from "../../shared/types";

// Test-only upstream double. Production never imports this module.
export function arkFixture(directory: string) {
  const config = loadConfig({
    MUSE_DATA_DIR: directory,
    MUSE_MODE: "ark",
    ARK_API_KEY: "test-only-not-a-real-key",
    ARK_AGENT_ID: "agt-test",
    ARK_ENVIRONMENT_ID: "env-test",
  });
  const ark = new ArkClient(config);
  const sessions: Record<string, Session> = {};
  const history: Record<string, AgentEvent[]> = {};
  vi.spyOn(ark, "create").mockImplementation(async (title, category) => {
    const id = `sesn-${randomUUID()}`;
    history[id] = [];
    return (sessions[id] = {
      id,
      title,
      category,
      status: "idle",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });
  vi.spyOn(ark, "get").mockImplementation(async (id) => sessions[id]);
  vi.spyOn(ark, "events").mockImplementation(async (id, page) => {
    const offset = Number(page ?? 0);
    const events = history[id] ?? [];
    return {
      data: events.slice(offset, offset + 200),
      next_page:
        offset + 200 < events.length ? String(offset + 200) : undefined,
    };
  });
  vi.spyOn(ark, "send").mockImplementation(async (id, input) => {
    const event = {
      ...input,
      id: input.id ?? randomUUID(),
      type: input.type!,
      created_at: new Date().toISOString(),
    };
    (history[id] ??= []).push(event);
    if (input.type === "user.message")
      history[id].push({
        id: randomUUID(),
        type: "agent.message",
        content: [{ type: "text", text: "Test upstream response" }],
      });
    return { data: [event] };
  });
  vi.spyOn(ark, "stream").mockImplementation(
    async (id) =>
      new Response(
        (history[id] ?? [])
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join("") + "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  return { config, ark, history, sessions };
}
