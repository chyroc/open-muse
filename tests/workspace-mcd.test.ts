import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ArkClient } from "../shared/ark";
import { uuid } from "../shared/crypto";
import { environmentWithTools } from "../shared/tooling";
import { MCD_MCP_URL } from "../shared/mcd";
import { LocalDatabase } from "../src/direct/storage";
import { DirectWorkspace } from "../src/direct/workspace";

type AgentShape = {
  version: number;
  mcp_servers?: { name?: string; url?: string }[];
};

// A workspace whose agent and environment already exist, with the given MCP
// servers on the agent and whether McDonald's is connected. Captures the agent
// changes syncPolicy submits.
function fixture(agentMcp: AgentShape["mcp_servers"], mcdConnected: boolean) {
  const key = "workspace-a";
  const changes: { kind: string; body: Record<string, unknown> }[] = [];
  const config = environmentWithTools({
    type: "cloud",
    networking: { type: "unrestricted" },
  });
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname.replace("/api/v3", "");
    if (path.startsWith("/environments/"))
      return Response.json({
        id: "env-1",
        metadata: { open_muse_workspace: key },
        config,
      });
    if (path.startsWith("/agents/"))
      return Response.json({
        id: "agent-1",
        metadata: { open_muse_workspace: key },
        version: 3,
        system: "stale system",
        tools: [{ type: "agent_toolset_20260701" }],
        mcp_servers: agentMcp,
      });
    return Response.json({}, { status: 404 });
  });
  const ark = new ArkClient(
    { arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", arkKey: "k", project: "" },
    fetcher,
  );
  const db = new LocalDatabase(`ws-${uuid()}`);
  const workspace = new DirectWorkspace(
    key,
    ark,
    db,
    async () => ({ agentId: "agent-1", environmentId: "env-1", model: "m" }),
    async () => ({ agentId: "agent-1", environmentId: "env-1", model: "m" }),
    async (kind, body) => {
      changes.push({ kind, body });
    },
    async () => mcdConnected,
  );
  return { workspace, db, key, changes };
}

async function seed(db: LocalDatabase, key: string) {
  await db.set(`${key}:workspace`, {
    agent_id: "agent-1",
    environment_id: "env-1",
    model_id: "m",
    resource_name: "open-muse-x",
    agent_pending: false,
    environment_pending: false,
    state: "ready",
    message: "",
  });
}

const agentChange = (changes: { kind: string; body: Record<string, unknown> }[]) =>
  changes.find((change) => change.kind === "agent")?.body as
    | { mcp_servers?: { name?: string; url?: string }[] }
    | undefined;

describe("workspace McDonald's MCP server", () => {
  it("declares the remote MCP on the agent while connected", async () => {
    const f = fixture([], true);
    await seed(f.db, f.key);
    await f.workspace.syncPolicy();
    expect(agentChange(f.changes)?.mcp_servers).toEqual([
      { name: "mcd", url: MCD_MCP_URL },
    ]);
  });

  it("removes the remote MCP from the agent once disconnected", async () => {
    const f = fixture([{ name: "mcd", url: MCD_MCP_URL }], false);
    await seed(f.db, f.key);
    await f.workspace.syncPolicy();
    expect(agentChange(f.changes)?.mcp_servers).toEqual([]);
  });

  it("keeps an unrelated MCP server the agent already has", async () => {
    const other = { name: "other", url: "https://example.com/mcp" };
    const f = fixture([other], true);
    await seed(f.db, f.key);
    await f.workspace.syncPolicy();
    expect(agentChange(f.changes)?.mcp_servers).toEqual([
      other,
      { name: "mcd", url: MCD_MCP_URL },
    ]);
  });
});
