import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { AccountWorkspaces } from "../src/workspace";
import { ConnectionStore } from "../src/connection";
import { Repository } from "../src/repository";
import { supabaseOwner } from "../../shared/supabase-auth";
import { accountWorkspaceKey } from "../../shared/workspace-key";
import type { Env } from "../src/env";

const origin = "https://auth.example.com";
const sharedKey = "test-shared-ark-api-key-0003";
const token = "settings-access-token-00000001";
const user = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const owner = supabaseOwner(origin, user);
const label = accountWorkspaceKey(sharedKey, "", owner);

// An Ark account with controllable failures for one account's workspace.
type Row = Record<string, unknown> & {
  id: string;
  metadata: Record<string, string>;
};
const ark: Record<string, Record<string, Row>> = {
  agents: {},
  environments: {},
  memory_stores: {},
};
let sequence = 0;
type Failure =
  | "network-before"
  | "network-after"
  | "status-408"
  | "status-429"
  | "status-500-after"
  | "unparseable-after"
  | "empty-body-after"
  | "version-conflict"
  | "rejected-400"
  | "late";
let nextUpdate: Failure | undefined;
let failNextRead = false;
// A request Ark received but applies only after the client gave up waiting.
let late: (() => void) | undefined;
const updates = () =>
  upstream.mock.calls.filter(
    ([input, init]) =>
      init?.method === "POST" &&
      /\/(agents|environments)\/[^/]+$/.test(new URL(String(input)).pathname),
  ).length;
const creates = () =>
  upstream.mock.calls.filter(
    ([input, init]) =>
      init?.method === "POST" &&
      /\/api\/v3\/[a-z_]+$/.test(new URL(String(input)).pathname),
  ).length;
const upstream = vi.fn<typeof fetch>(async (input, init) => {
  const url = new URL(String(input));
  const bearer = (new Headers(init?.headers).get("Authorization") ?? "").slice(
    7,
  );
  if (url.origin === origin)
    return bearer === token
      ? Response.json({ id: user, is_anonymous: false })
      : Response.json({}, { status: 401 });
  if (bearer !== sharedKey) return Response.json({}, { status: 401 });
  const [, collection, id] = url.pathname.replace("/api/v3", "").split("/");
  const rows = ark[collection];
  if (!rows) return Response.json({ data: [] });
  const method = init?.method ?? "GET";
  if (method === "POST" && !id) {
    const row = {
      ...JSON.parse(String(init!.body)),
      id: `${collection}-${++sequence}`,
      version: 1,
    };
    rows[row.id] = row;
    return Response.json(row);
  }
  const row = id ? rows[id] : undefined;
  if (method === "POST") {
    const failure = nextUpdate;
    nextUpdate = undefined;
    if (!row) return Response.json({}, { status: 404 });
    const changes = JSON.parse(String(init!.body));
    // Agent updates are optimistic: they must name the current version.
    if (collection === "agents" && changes.version !== row.version)
      return Response.json({ error: "version" }, { status: 409 });
    if (failure === "late") {
      // Lost before Ark applied it; the test applies it later.
      late = () => {
        Object.assign(row, changes);
        if (collection === "agents") row.version = Number(row.version) + 1;
      };
      throw new TypeError("timed out");
    }
    if (failure === "network-before") throw new TypeError("network down");
    if (failure === "status-408") return Response.json({}, { status: 408 });
    if (failure === "status-429") return Response.json({}, { status: 429 });
    if (failure === "rejected-400")
      return Response.json({ error: "invalid" }, { status: 400 });
    if (failure === "version-conflict")
      return Response.json({ error: "version" }, { status: 409 });
    Object.assign(row, JSON.parse(String(init!.body)));
    if (collection === "agents") row.version = Number(row.version) + 1;
    if (failure === "network-after") throw new TypeError("response lost");
    if (failure === "status-500-after")
      return Response.json({}, { status: 500 });
    if (failure === "unparseable-after")
      return new Response("<html>gateway</html>", { status: 200 });
    if (failure === "empty-body-after") return Response.json({});
    return Response.json(row);
  }
  if (!id) return Response.json({ data: Object.values(rows) });
  if (failNextRead) {
    failNextRead = false;
    throw new TypeError("read failed");
  }
  if (!row) return Response.json({}, { status: 404 });
  return Response.json(row);
});
let env: Env;
const call = (path: string, body?: unknown, method = "GET") =>
  handle(
    new Request(`https://background.example${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
    upstream,
  );
type Record_ = {
  revision: number;
  workspace: {
    agentId: string;
    environmentId: string;
    memoryStoreId: string;
    model: string;
    agent?: Record<string, unknown>;
    environment?: Record<string, unknown>;
    previous?: Record<string, unknown>;
  };
  settings?: string;
  change?: string;
  rebuilt?: Record<string, string>;
};
const record = async () =>
  (await (await call("/v1/account/workspace")).json()) as Record_;
const change = async (
  kind: "agent" | "environment",
  changes: Record<string, unknown>,
  revision?: number,
) =>
  call(
    "/v1/account/workspace/settings",
    {
      kind,
      changes,
      revision: revision ?? (await record()).revision,
      credentialRevision: 1,
      confirm: true,
    },
    "PUT",
  );
const reconcile = async (mode?: "adopt" | "discard") =>
  call(
    "/v1/account/workspace/reconcile",
    {
      revision: (await record()).revision,
      credentialRevision: 1,
      ...(mode ? { mode } : {}),
      confirm: true,
    },
    "POST",
  );
const config = (networking: string) => ({
  config: { type: "cloud", networking: { type: networking } },
});

describe("Account workspace settings changes", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      OWNER_ID: "private-owner",
      SUPABASE_AUTH_URL: origin,
      SUPABASE_ANON_KEY: "sb_publishable_test_public_key_only",
      BACKGROUND_ENABLED: "true",
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("s".repeat(32)) },
      }),
    };
    await call(
      "/v1/account/credential",
      {
        credential: { apiKey: sharedKey, project: "" },
        revision: 0,
        confirm: true,
      },
      "PUT",
    );
    expect(
      (
        await call(
          "/v1/account/workspace",
          { credentialRevision: 1, confirm: true },
          "POST",
        )
      ).status,
    ).toBe(200);
    expect((await change("environment", config("open"))).status).toBe(200);
  });
  afterAll(async () => fixture.dispose());

  it("lets only one of two concurrent changes reach Ark", async () => {
    const revision = (await record()).revision;
    const before = updates();
    const results = await Promise.all([
      change("environment", config("first"), revision),
      change("environment", config("second"), revision),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(updates()).toBe(before + 1);
    const saved = (await record()).workspace;
    expect(saved.environment).toEqual(
      expect.objectContaining({
        config: ark.environments[saved.environmentId].config,
      }),
    );
  });

  it.each<[Failure, "applied" | "review"]>([
    ["network-before", "review"],
    ["status-408", "review"],
    ["status-429", "review"],
    ["network-after", "applied"],
    ["status-500-after", "applied"],
    ["unparseable-after", "applied"],
  ])(
    "keeps the change unconfirmed after %s and resolves it only by reading Ark",
    async (failure, outcome) => {
      const saved = (await record()).workspace.environment;
      const before = updates();
      nextUpdate = failure;
      const response = await change("environment", config(`after-${failure}`));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "unconfirmed" });
      expect(updates()).toBe(before + 1);
      expect(await record()).toMatchObject({
        settings: "unconfirmed",
        workspace: { environment: saved },
      });
      // While unconfirmed, nothing else is sent.
      expect((await change("environment", config("blocked"))).status).toBe(409);
      expect(
        (
          await call(
            "/v1/account/workspace",
            { credentialRevision: 1, confirm: true },
            "POST",
          )
        ).status,
      ).toBe(409);
      expect(updates()).toBe(before + 1);
      const resolved = await reconcile();
      expect(updates()).toBe(before + 1);
      if (outcome === "applied") {
        expect(resolved.status).toBe(200);
        expect(await resolved.json()).toMatchObject({ change: "applied" });
        expect((await record()).workspace.environment).toEqual(
          expect.objectContaining({
            config: {
              type: "cloud",
              networking: { type: `after-${failure}` },
            },
          }),
        );
        expect((await record()).settings).toBeUndefined();
        return;
      }
      // An environment has no version: Ark still showing the saved values
      // does not prove the change will not arrive, so it is not released.
      expect(resolved.status).toBe(409);
      expect(await resolved.json()).toMatchObject({ code: "settings_review" });
      expect(await record()).toMatchObject({
        settings: "review",
        workspace: { environment: saved },
      });
      // The user keeps the saved settings; Open Muse keeps saying Ark may
      // differ until a read shows it does not.
      expect(await (await reconcile("discard")).json()).toMatchObject({
        change: "discarded",
        settings: "drift",
      });
      expect(updates()).toBe(before + 1);
      expect(await (await reconcile()).json()).toMatchObject({
        change: "drift_cleared",
      });
      expect(await record()).toMatchObject({
        workspace: { environment: saved },
      });
      expect((await record()).settings).toBeUndefined();
    },
  );

  it("treats a change it cannot read back as unconfirmed", async () => {
    const before = updates();
    nextUpdate = "empty-body-after";
    failNextRead = true;
    const response = await change("environment", config("unread"));
    expect(response.status).toBe(503);
    expect(updates()).toBe(before + 1);
    expect(await (await reconcile()).json()).toMatchObject({
      change: "applied",
    });
  });

  it("releases the change only for a definite rejection", async () => {
    const saved = (await record()).workspace.environment;
    nextUpdate = "rejected-400";
    expect((await change("environment", config("rejected"))).status).toBe(422);
    expect(await record()).toMatchObject({ workspace: { environment: saved } });
    expect((await record()).settings).toBeUndefined();
    // An agent version conflict is a rejection only while the agent still has
    // the version the change was based on.
    const agent = ark.agents[(await record()).workspace.agentId];
    nextUpdate = "version-conflict";
    expect(
      (
        await change("agent", {
          version: agent.version as number,
          system: "conflict",
        })
      ).status,
    ).toBe(422);
    expect((await record()).settings).toBeUndefined();
    agent.version = Number(agent.version) + 1;
    nextUpdate = "version-conflict";
    expect(
      (
        await change("agent", {
          version: Number(agent.version) - 1,
          system: "conflict",
        })
      ).status,
    ).toBe(503);
    expect((await record()).settings).toBe("unconfirmed");
    // Changed by something else meanwhile: kept for review, never sealed
    // without the user's decision.
    const review = await reconcile();
    expect(review.status).toBe(409);
    expect(await review.json()).toMatchObject({ code: "settings_review" });
    expect((await record()).settings).toBe("review");
    expect((await reconcile("adopt")).status).toBe(200);
    expect((await record()).workspace.agent).toMatchObject({
      version: agent.version,
    });
  });

  it("never seals values that reference resources an account cannot use", async () => {
    const saved = await record();
    const agent = ark.agents[saved.workspace.agentId];
    nextUpdate = "network-after";
    expect(
      (
        await change("agent", {
          version: agent.version as number,
          system: "after a lost response",
        })
      ).status,
    ).toBe(503);
    // Someone with the key attaches an uploaded skill meanwhile.
    agent.skills = [{ type: "custom", skill_id: "skill-of-someone" }];
    const posts = updates();
    expect((await reconcile()).status).toBe(409);
    const adopt = await reconcile("adopt");
    expect(adopt.status).toBe(409);
    expect((await record()).workspace.agent).toEqual(saved.workspace.agent);
    expect(updates()).toBe(posts);
    delete agent.skills;
    expect((await reconcile("adopt")).status).toBe(200);
  });

  it("stops background work as soon as a change needs review", async () => {
    const saved = await record();
    const connections = new ConnectionStore(env, owner);
    const bind = async () =>
      call(
        "/v1/connection",
        {
          workspace: {
            agentId: saved.workspace.agentId,
            agentVersion: ark.agents[saved.workspace.agentId].version,
            environmentId: saved.workspace.environmentId,
            memoryStoreId: saved.workspace.memoryStoreId,
          },
          credentialRevision: 1,
          revision: (await connections.status()).revision,
          confirm: true,
        },
        "PUT",
      );
    expect((await bind()).status).toBe(200);
    expect(await connections.status()).toMatchObject({ configured: true });
    nextUpdate = "network-after";
    expect((await change("environment", config("lost reply"))).status).toBe(
      503,
    );
    // An unconfirmed change only ever carries values an account may use.
    expect(await connections.status()).toMatchObject({ configured: true });
    // Someone with the key points the environment at storage meanwhile.
    ark.environments[saved.workspace.environmentId].config = {
      type: "cloud",
      tos: { bucket: "someone", prefix: "" },
    };
    const before = updates();
    expect((await reconcile()).status).toBe(409);
    expect(updates()).toBe(before);
    // Background sessions would use the live environment, so they stop.
    expect(await connections.status()).toMatchObject({ configured: false });
    expect((await record()).workspace.environment).toEqual(
      saved.workspace.environment,
    );
    const refused = await bind();
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "settings_review" });
    ark.environments[saved.workspace.environmentId].config = config("fixed");
    expect(await (await reconcile("adopt")).json()).toMatchObject({
      change: "adopted",
    });
  });

  it("reports an agent change missing at read time as not applied yet and catches a late arrival", async () => {
    const saved = (await record()).workspace.agent!;
    const agent = ark.agents[(await record()).workspace.agentId];
    const base = agent.version as number;
    nextUpdate = "late";
    expect(
      (await change("agent", { version: base, system: "arrives late" })).status,
    ).toBe(503);
    // At read time the agent still has the base version.
    expect(await (await reconcile()).json()).toMatchObject({
      change: "not_applied_yet",
    });
    expect((await record()).workspace.agent).toEqual(saved);
    // The earlier request is applied after all.
    late!();
    const before = updates();
    const next = await change("agent", {
      version: base,
      system: "a later change",
    });
    // Based on the old version, the next change is refused by Ark, which is
    // checked, so the late values are never silently overwritten or sealed.
    expect(next.status).toBe(503);
    expect(updates()).toBe(before + 1);
    const review = await reconcile();
    expect(review.status).toBe(409);
    expect(await review.json()).toMatchObject({ code: "settings_review" });
    expect((await record()).workspace.agent).toEqual(saved);
    expect(agent.system).toBe("arrives late");
    expect(await (await reconcile("adopt")).json()).toMatchObject({
      change: "adopted",
      workspace: { agent: { system: "arrives late" } },
    });
  });

  it("can always leave a change it could not save, and keeps saying Ark may differ", async () => {
    const saved = await record();
    const connections = new ConnectionStore(env, owner);
    const agent = ark.agents[saved.workspace.agentId];
    // Allow background work with a schedule.
    expect(
      (
        await call(
          "/v1/connection",
          {
            workspace: {
              agentId: saved.workspace.agentId,
              agentVersion: agent.version,
              environmentId: saved.workspace.environmentId,
              memoryStoreId: saved.workspace.memoryStoreId,
            },
            credentialRevision: 1,
            revision: (await connections.status()).revision,
            confirm: true,
          },
          "PUT",
        )
      ).status,
    ).toBe(200);
    const repo = new Repository(env.DB, owner);
    await repo.saveSchedule(
      {
        enabled: true,
        timezone: "UTC",
        local_time: "09:00",
        revision: (await repo.schedule()).revision,
      },
      Date.now(),
      { revision: (await connections.status()).revision, hash: "h" },
    );
    expect((await repo.schedule()).enabled).toBe(true);
    // Ark returns settings too large to save.
    const before = updates();
    const huge = config("x".repeat(110_000));
    const response = await change("environment", huge);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "settings_review" });
    expect(updates()).toBe(before + 1);
    expect(await record()).toMatchObject({
      settings: "review",
      workspace: { environment: saved.workspace.environment },
    });
    // The live values differ from the saved ones, so background work stops.
    expect(await connections.status()).toMatchObject({ configured: false });
    // Too large to adopt: the user keeps the saved settings instead.
    expect((await reconcile("adopt")).status).toBe(409);
    expect(await (await reconcile("discard")).json()).toMatchObject({
      change: "discarded",
      settings: "drift",
      workspace: { environment: saved.workspace.environment },
    });
    expect(updates()).toBe(before + 1);
    // Background sessions would use Ark's live environment, so they stop.
    expect(await connections.status()).toMatchObject({ configured: false });
    expect((await repo.schedule()).enabled).toBe(false);
    const rebind = await call(
      "/v1/connection",
      {
        workspace: {
          agentId: saved.workspace.agentId,
          agentVersion: agent.version,
          environmentId: saved.workspace.environmentId,
          memoryStoreId: saved.workspace.memoryStoreId,
        },
        credentialRevision: 1,
        revision: (await connections.status()).revision,
        confirm: true,
      },
      "PUT",
    );
    expect(rebind.status).toBe(409);
    // Still different from the saved settings: the drift stays.
    expect(await (await reconcile()).json()).toMatchObject({
      change: "drift_kept",
      settings: "drift",
    });
    // Values an account may not use are never adopted.
    ark.environments[saved.workspace.environmentId].config = {
      type: "cloud",
      tos: { bucket: "someone", prefix: "" },
    };
    expect((await reconcile("adopt")).status).toBe(409);
    expect((await record()).settings).toBe("drift");
    // A confirmed change ends the drift.
    expect((await change("environment", config("settled"))).status).toBe(200);
    expect((await record()).settings).toBeUndefined();
  });

  it("recreates a deleted agent and environment from the saved settings", async () => {
    const agent = ark.agents[(await record()).workspace.agentId];
    expect(
      (
        await change("agent", {
          version: agent.version as number,
          system: "User instructions to keep",
          tools: [{ type: "agent_toolset_20260701" }],
        })
      ).status,
    ).toBe(200);
    expect((await change("environment", config("restricted"))).status).toBe(
      200,
    );
    const saved = await record();
    // Allow background work, then lose both resources at Ark.
    const connections = new ConnectionStore(env, owner);
    const bound = await call(
      "/v1/connection",
      {
        workspace: {
          agentId: saved.workspace.agentId,
          agentVersion: ark.agents[saved.workspace.agentId].version,
          environmentId: saved.workspace.environmentId,
          memoryStoreId: saved.workspace.memoryStoreId,
        },
        credentialRevision: 1,
        revision: (await connections.status()).revision,
        confirm: true,
      },
      "PUT",
    );
    expect(bound.status).toBe(200);
    const repo = new Repository(env.DB, owner);
    await repo.saveSchedule(
      {
        enabled: true,
        timezone: "UTC",
        local_time: "09:00",
        revision: (await repo.schedule()).revision,
      },
      Date.now(),
      { revision: (await connections.status()).revision, hash: "h" },
    );
    expect((await repo.schedule()).enabled).toBe(true);
    delete ark.agents[saved.workspace.agentId];
    delete ark.environments[saved.workspace.environmentId];
    const before = creates();
    const response = await call(
      "/v1/account/workspace",
      { credentialRevision: 1, confirm: true },
      "POST",
    );
    expect(response.status).toBe(200);
    const rebuilt = (await response.json()) as Record_;
    expect(rebuilt.rebuilt).toEqual({
      agent: "restored",
      environment: "restored",
    });
    expect(creates()).toBe(before + 2);
    const newAgent = ark.agents[rebuilt.workspace.agentId];
    expect(newAgent).toMatchObject({
      system: "User instructions to keep",
      tools: [{ type: "agent_toolset_20260701" }],
      metadata: { open_muse_workspace: label },
    });
    expect(ark.environments[rebuilt.workspace.environmentId]).toMatchObject({
      config: { networking: { type: "restricted" } },
    });
    // The old binding never points at the new resources.
    expect(await connections.status()).toMatchObject({ configured: false });
    expect((await new Repository(env.DB, owner).schedule()).enabled).toBe(
      false,
    );
  });

  it("keeps unusable saved settings and recreates with defaults only when asked", async () => {
    const current = await record();
    const workspaces = new AccountWorkspaces(env, owner, upstream);
    // Settings sealed before references were checked may name an uploaded
    // skill.
    const unsafe = {
      ...current.workspace,
      agent: {
        ...current.workspace.agent,
        skills: [{ type: "custom", skill_id: "skill-of-someone" }],
      },
    };
    await (
      workspaces as unknown as {
        write: (...args: unknown[]) => Promise<number>;
      }
    ).write(label, current.revision, unsafe, null, Date.now());
    delete ark.agents[current.workspace.agentId];
    const before = creates();
    const blocked = await call(
      "/v1/account/workspace",
      { credentialRevision: 1, confirm: true },
      "POST",
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      code: "rebuild_review",
      details: ["skills"],
    });
    expect(creates()).toBe(before);
    expect((await record()).workspace.agent).toEqual(unsafe.agent);
    const reset = await call(
      "/v1/account/workspace",
      { credentialRevision: 1, resetSettings: true, confirm: true },
      "POST",
    );
    expect(reset.status).toBe(200);
    const result = (await reset.json()) as Record_;
    expect(result.rebuilt).toEqual({ agent: "recreated_with_defaults" });
    expect(result.workspace.agent).toBeUndefined();
    expect(result.workspace.previous).toEqual({ agent: unsafe.agent });
    expect(ark.agents[result.workspace.agentId].skills).not.toEqual(
      unsafe.agent.skills,
    );
  });
});
