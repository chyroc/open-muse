import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ApiError, ArkClient } from "../shared/ark";
import { uuid } from "../shared/crypto";
import { DEFAULT_MODEL, DirectWorkspace } from "../src/direct/workspace";
import { LocalDatabase } from "../src/direct/storage";

function fixture() {
  const db = new LocalDatabase(`direct-workspace-${uuid()}`);
  const rows: Record<string, Record<string, any>[]> = {
    agents: [],
    environments: [],
  };
  const ark = new ArkClient({
    arkBaseUrl: "https://example.invalid",
    arkKey: "test-only",
    project: "",
  });
  const request = vi
    .spyOn(ark, "request")
    .mockImplementation(async (path, init) => {
      const [, group, id] = path.split("?")[0].split("/");
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (id) {
          Object.assign(
            rows[group].find((row) => row.id === id)!,
            body,
          );
          return {} as never;
        }
        const row = {
          ...body,
          id: `${group}-${rows[group].length + 1}`,
          version: 1,
        };
        rows[group].push(row);
        return row as never;
      }
      if (id) {
        const row = rows[group]?.find((row) => row.id === id);
        if (!row) throw new ApiError(404, "Missing resource");
        return row as never;
      }
      return { data: rows[group] ?? [] } as never;
    });
  return {
    db,
    rows,
    request,
    workspace: new DirectWorkspace("owner", ark, db),
  };
}
describe("Direct MA initial model provisioning", () => {
  it("creates a fresh assistant with the MA-verified public default without a catalog dependency", async () => {
    const f = fixture();
    expect(DEFAULT_MODEL).toBe("doubao-seed-2-1-pro-260915");
    await f.workspace.start();
    await f.workspace.wait();
    expect((await f.workspace.status()).state).toBe("ready");
    expect(f.rows.agents[0].model.id).toBe(DEFAULT_MODEL);
    expect(
      f.request.mock.calls.some(([path]) => path.startsWith("/models")),
    ).toBe(false);
  });
  it("repairs a definitively rejected former default and reuses the already-created environment", async () => {
    const f = fixture();
    await f.db.set("owner:workspace", {
      agent_id: "",
      environment_id: "environments-1",
      model_id: "doubao-seed-2-0-pro-260215",
      resource_name: "open-muse-owner",
      agent_pending: false,
      environment_pending: false,
      state: "error",
      message: "Previous agent model was rejected",
    });
    f.rows.environments.push({
      id: "environments-1",
      metadata: { open_muse_workspace: "owner" },
    });
    await f.workspace.start();
    await f.workspace.wait();
    expect(f.rows.agents[0].model.id).toBe(DEFAULT_MODEL);
    expect(f.rows.environments).toHaveLength(1);
  });
  it("preserves an existing custom model and does not create another assistant", async () => {
    const f = fixture();
    f.rows.agents.push({
      id: "custom-agent",
      version: 1,
      model: { id: "custom-model" },
      system: "Custom persona",
      tools: [],
      metadata: { open_muse_workspace: "owner" },
    });
    await f.workspace.start();
    await f.workspace.wait();
    expect(f.rows.agents).toHaveLength(1);
    expect(f.rows.agents[0].model.id).toBe("custom-model");
    expect(f.rows.agents[0].system).toContain("Custom persona");
  });
  it("does not replace a model for an unconfirmed agent creation", async () => {
    const f = fixture();
    await f.db.set("owner:workspace", {
      agent_id: "",
      environment_id: "environments-1",
      model_id: "doubao-seed-2-0-pro-260215",
      resource_name: "open-muse-owner",
      agent_pending: true,
      environment_pending: false,
      state: "error",
      message: "Unconfirmed creation",
    });
    f.rows.environments.push({
      id: "environments-1",
      metadata: { open_muse_workspace: "owner" },
    });
    await f.workspace.start();
    await expect(f.workspace.wait()).rejects.toThrow("unconfirmed");
    expect(f.rows.agents).toHaveLength(0);
    expect(
      (await f.db.get<{ model_id: string }>("owner:workspace"))?.model_id,
    ).toBe("doubao-seed-2-0-pro-260215");
  });
});
