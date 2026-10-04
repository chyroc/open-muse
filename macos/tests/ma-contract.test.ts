import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { eventText, type AgentEvent } from "../../shared/types";
import { defaultFeedInstructions } from "../../shared/inspiration";
import { MacGoals } from "../ui/goals";
import { MacIdeas } from "../ui/ideas";
import { vaultAccount } from "./account";

async function fixture() {
  const db = new LocalDatabase(`mac-contract-${crypto.randomUUID()}`);
  const posted: { session: string; events: AgentEvent[] }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://ark.cn-beijing.volces.com");
    if (url.pathname === "/api/v3/agents" && !init.method)
      return Response.json({ data: [] });
    // The session belongs to the account's own agent.
    if (url.pathname === "/api/v3/sessions/isolated-session" && !init.method)
      return Response.json({ id: "isolated-session", agent: "agent-own" });
    if (
      url.pathname === "/api/v3/sessions/isolated-session/events" &&
      init.method === "POST"
    ) {
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer test-only-mac-contract-key",
      );
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body)).toEqual(["events"]);
      expect(body.events).toHaveLength(1);
      posted.push({ session: "isolated-session", events: body.events });
      return Response.json({ data: body.events });
    }
    throw new Error(
      `Unexpected isolated request: ${init.method ?? "GET"} ${url.pathname}`,
    );
  });
  // The account's workspace, as the service recorded it.
  const account = vaultAccount(async () =>
    JSON.stringify({ apiKey: "test-only-mac-contract-key" }),
  );
  account.accountWorkspace = async () => ({
    revision: 1,
    unconfirmed: false,
    workspace: {
      agentId: "agent-own",
      environmentId: "environment-own",
      memoryStoreId: "store-own",
      model: "model",
    },
  });
  const client = new Client({ database: db, fetcher, account });
  await client.restore();
  // Only setup/context readers are isolated. Sending uses the real Client,
  // operation schema, request builder, ArkClient and fetch transport.
  vi.spyOn(client, "prepareWorkspace").mockResolvedValue({} as never);
  vi.spyOn(client, "prepareGoals").mockResolvedValue({} as never);
  vi.spyOn(client, "goals").mockResolvedValue({
    data: [],
    revision: "fixture",
  });
  vi.spyOn(client, "sessions").mockResolvedValue({ data: [] });
  vi.spyOn(client, "events").mockResolvedValue([]);
  vi.spyOn(client, "create").mockResolvedValue({
    id: "isolated-session",
    title: "Isolated",
    status: "idle",
    category: "life",
    created_at: "2026-09-30T00:00:00Z",
    updated_at: "2026-09-30T00:00:00Z",
  });
  vi.spyOn(client, "conversationIndex").mockResolvedValue({ entries: {} });
  vi.spyOn(client, "inspiration").mockResolvedValue({
    items: [],
    runs: {},
    instructions: { content: defaultFeedInstructions, revision: "fixture" },
    instructionsDismissed: false,
  });
  return { client, db, posted };
}

describe("Mac MA production request contract", () => {
  it("posts the exact durable goal starter through the real client", async () => {
    const f = await fixture();
    const service = new MacGoals(f.client, f.db);
    const open = vi.fn(async (_id: string) => {});
    await service.start("health", open);
    expect(open).toHaveBeenCalledWith("isolated-session");
    expect(f.posted).toHaveLength(1);
    expect(eventText(f.posted[0].events[0])).toBe(
      "I want to start a health goal",
    );
    expect(f.posted[0].events[0].id).toMatch(/^evt-/);
    expect((await service.snapshot()).chats[0].phase).toBe("confirmed");
  });

  it("posts Mac idea generation through the real client", async () => {
    const f = await fixture();
    await new MacIdeas(f.client, f.db).generate();
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0].events[0].type).toBe("user.message");
    expect(eventText(f.posted[0].events[0])).toContain(
      "Suggest 3–4 genuinely useful",
    );
    expect(f.posted[0].events[0].id).toBeTruthy();
  });
});
