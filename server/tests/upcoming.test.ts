import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { deliverDueUpcoming, UpcomingDelivery } from "../src/upcoming";
import { supabaseOwner } from "../../shared/supabase-auth";
import type { Env } from "../src/env";

const origin = "https://auth.example.com";
const key = "test-upcoming-ark-api-key-01";
const users: Record<string, string> = {
  "alice-access-token-000000001": "159c19ab-cfba-4436-9038-87f5fca38a4b",
  "bob-access-token-00000000001": "316c004b-07b0-4675-9b8d-deb5a740f03b",
};
const [ALICE, BOB] = Object.keys(users);
const owner = (token: string) => supabaseOwner(origin, users[token]);
const DAY = 86_400_000;
// 2026-03-02T09:00:00Z is a Monday.
const T0 = Date.parse("2026-03-02T08:00:00Z");

type Row = Record<string, unknown> & { id: string };
const ark: Record<string, Record<string, Row>> = {};
const events: Record<string, Row[]> = {};
let upcoming = "";
let sessionStatus = "idle";
let failNextSend: "reject" | "lost" | undefined;
let sequence = 0;
const posted: { session: string; event: Row }[] = [];

const upstream = vi.fn<typeof fetch>(async (input, init) => {
  const url = new URL(String(input));
  const bearer = (new Headers(init?.headers).get("Authorization") ?? "").slice(
    7,
  );
  if (url.origin === origin) {
    const id = users[bearer];
    return id
      ? Response.json({ id, is_anonymous: false })
      : Response.json({}, { status: 401 });
  }
  if (bearer !== key) return Response.json({}, { status: 401 });
  const parts = url.pathname.replace("/api/v3", "").split("/").slice(1);
  const method = init?.method ?? "GET";
  const [collection, id, sub, subId] = parts;
  if (collection === "models") return Response.json({ data: [] });
  if (collection === "sessions" && sub === "events") {
    if (method === "POST") {
      if (failNextSend === "reject") {
        failNextSend = undefined;
        return Response.json({}, { status: 400 });
      }
      const event = JSON.parse(String(init!.body)).events[0];
      (events[id] ??= []).push(event);
      posted.push({ session: id, event });
      if (failNextSend === "lost") {
        failNextSend = undefined;
        throw new TypeError("response lost");
      }
      return Response.json({ data: [event] });
    }
    expect(url.searchParams.get("order")).toBe("desc");
    return Response.json({ data: [...(events[id] ?? [])].reverse() });
  }
  if (collection === "memory_stores" && sub === "memories") {
    const memory = { id: "mem-upcoming", path: "/UPCOMING.md" };
    if (subId) return Response.json({ ...memory, content: upcoming });
    return Response.json({ data: upcoming ? [memory] : [] });
  }
  const rows = (ark[collection] ??= {});
  if (method === "POST" && !id) {
    const body = JSON.parse(String(init!.body));
    const row = { ...body, id: `${collection}-${++sequence}` };
    rows[row.id] = row;
    return Response.json(row);
  }
  if (!id) return Response.json({ data: Object.values(rows) });
  const row = rows[id];
  if (!row) return Response.json({}, { status: 404 });
  if (collection === "sessions")
    return Response.json({ ...row, status: sessionStatus });
  return Response.json(
    collection === "agents" ? { ...row, version: 1, tools: [] } : row,
  );
});

let env: Env;
const request = (token: string, path: string, body?: unknown, method = "GET") =>
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
async function prepare(token: string) {
  expect(
    (
      await request(
        token,
        "/v1/account/credential",
        { credential: { apiKey: key, project: "" }, revision: 0, confirm: true },
        "PUT",
      )
    ).status,
  ).toBe(200);
  const response = await request(
    token,
    "/v1/account/workspace",
    { credentialRevision: 1, confirm: true },
    "POST",
  );
  expect(response.status).toBe(200);
  const { workspace } = (await response.json()) as {
    workspace: { agentId: string; environmentId: string };
  };
  return workspace;
}
function session(agentId: string) {
  const id = `sessions-${++sequence}`;
  (ark.sessions ??= {})[id] = { id, agent: { id: agentId } };
  return id;
}
const item = (id: string, schedule: object, extra: object = {}) => ({
  id,
  title: `Reminder ${id}`,
  instruction: "",
  schedule,
  time_zone: "UTC",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...extra,
});
const document = (...items: object[]) =>
  JSON.stringify({ version: 1, items });
const register = (token: string, sessionId: string, revision = 0) =>
  request(
    token,
    "/v1/account/upcoming",
    {
      session_id: sessionId,
      language: "en",
      enabled: true,
      revision,
      confirm: true,
    },
    "PUT",
  );
const deliver = (token: string, at: number) =>
  new UpcomingDelivery(env, owner(token), upstream).deliver(at);

describe("Server delivery of Upcoming reminders", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let aliceSession: string;
  let bobSession: string;
  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      SUPABASE_AUTH_URL: origin,
      SUPABASE_ANON_KEY: "sb_publishable_test_public_key_only",
      BACKGROUND_ENABLED: "true",
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("u".repeat(32)) },
      }),
    };
    const alice = await prepare(ALICE);
    const bob = await prepare(BOB);
    aliceSession = session(alice.agentId);
    bobSession = session(bob.agentId);
  });
  afterAll(async () => fixture?.dispose());
  beforeEach(() => {
    sessionStatus = "idle";
    failNextSend = undefined;
  });

  it("registers only a conversation that runs the account's own agent", async () => {
    expect((await register(ALICE, bobSession)).status).toBe(403);
    expect((await register(ALICE, "sessions-missing")).status).toBe(403);
    const response = await register(ALICE, aliceSession);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      session_id: aliceSession,
      revision: 1,
      state: "active",
    });
    expect((await register(ALICE, aliceSession, 0)).status).toBe(409);
    const status = (await (await request(ALICE, "/v1/status")).json()) as {
      upcoming: unknown;
    };
    expect(status.upcoming).toEqual({
      delivery: "server",
      session_id: aliceSession,
    });
    const other = (await (await request(BOB, "/v1/status")).json()) as {
      upcoming: unknown;
    };
    expect(other.upcoming).toEqual({ delivery: "off", session_id: null });
  });

  it("sends a due occurrence once, after claiming it, and never replays it", async () => {
    // Registration time is the start; make it earlier than the schedule.
    await env.DB.prepare("UPDATE upcoming_targets SET since=?,next_check_at=0")
      .bind(T0)
      .run();
    upcoming = document(
      item("standup", { kind: "daily", time: "09:00" }),
      item("paused", { kind: "daily", time: "09:00" }, { status: "paused" }),
    );
    expect(await deliver(ALICE, T0 + 30 * 60_000)).toBe("idle");
    expect(await deliver(ALICE, T0 + 61 * 60_000)).toBe("sent");
    expect(posted).toHaveLength(1);
    const text = JSON.stringify(posted[0].event);
    expect(posted[0].session).toBe(aliceSession);
    expect(text).toContain("id standup, daily, due 2026-03-02T09:00:00.000Z");
    expect(text).not.toContain("paused");
    expect(posted[0].event.id).toMatch(/^evt-/);
    // Later ticks, including a replayed one, send nothing for that occurrence.
    expect(await deliver(ALICE, T0 + 66 * 60_000)).toBe("idle");
    expect(await deliver(ALICE, T0 + 61 * 60_000)).toBe("skipped");
    expect(posted).toHaveLength(1);
    // The next day's occurrence is a new one.
    expect(await deliver(ALICE, T0 + DAY + 61 * 60_000)).toBe("sent");
    expect(posted).toHaveLength(2);
  });

  it("waits while the conversation is busy instead of interrupting it", async () => {
    sessionStatus = "running";
    expect(await deliver(ALICE, T0 + 2 * DAY + 61 * 60_000)).toBe("busy");
    expect(posted).toHaveLength(2);
    sessionStatus = "idle";
    expect(await deliver(ALICE, T0 + 2 * DAY + 66 * 60_000)).toBe("sent");
    expect(posted).toHaveLength(3);
  });

  it("does not repeat an ambiguous send and holds new ones until it is found", async () => {
    failNextSend = "lost";
    expect(await deliver(ALICE, T0 + 3 * DAY + 61 * 60_000)).toBe(
      "unconfirmed",
    );
    expect(posted).toHaveLength(4);
    // The lost send did reach Ark: it is confirmed from history, not resent.
    expect(await deliver(ALICE, T0 + 3 * DAY + 66 * 60_000)).toBe("idle");
    expect(posted).toHaveLength(4);
    const phases = await env.DB.prepare(
      "SELECT phase FROM upcoming_messages ORDER BY created_at",
    ).all<{ phase: string }>();
    expect(phases.results.map((row) => row.phase)).toEqual([
      "sent",
      "sent",
      "sent",
      "sent",
    ]);
  });

  it("consumes an occurrence Ark definitely rejected without retrying it", async () => {
    failNextSend = "reject";
    expect(await deliver(ALICE, T0 + 4 * DAY + 61 * 60_000)).toBe(
      "unconfirmed",
    );
    expect(await deliver(ALICE, T0 + 4 * DAY + 66 * 60_000)).toBe("idle");
    expect(posted).toHaveLength(4);
  });

  it("skips occurrences another device already delivered into the history", async () => {
    events[aliceSession].push({
      id: "evt-from-a-device",
      type: "user.message",
      content: [
        {
          type: "text",
          text: "<open-muse-reminder>\nDue items:\n- id standup, daily, due 2026-03-07T09:00:00.000Z: \"Reminder standup\"\n</open-muse-reminder>",
        },
      ],
    });
    expect(await deliver(ALICE, T0 + 5 * DAY + 61 * 60_000)).toBe("idle");
    expect(posted).toHaveLength(4);
  });

  it("stops when the conversation no longer belongs to the account", async () => {
    delete ark.sessions[aliceSession];
    expect(await deliver(ALICE, T0 + 6 * DAY + 61 * 60_000)).toBe(
      "session_unavailable",
    );
    expect(
      await (await request(ALICE, "/v1/account/upcoming")).json(),
    ).toMatchObject({ state: "session_unavailable" });
    expect(await deliver(ALICE, T0 + 6 * DAY + 66 * 60_000)).toBe("skipped");
    ark.sessions[aliceSession] = { id: aliceSession, agent: { id: "x" } };
  });

  it("selects only recently active accounts of the configured issuer", async () => {
    upcoming = document(item("standup", { kind: "daily", time: "09:00" }));
    const bobOwner = owner(BOB);
    expect((await register(BOB, bobSession)).status).toBe(200);
    await env.DB.prepare(
      "UPDATE upcoming_targets SET since=?,next_check_at=0 WHERE owner_id=?",
    )
      .bind(T0, bobOwner)
      .run();
    const now = T0 + 7 * DAY + 61 * 60_000;
    await deliverDueUpcoming(env, "https://other.example.com", 0, now, upstream);
    expect(posted).toHaveLength(4);
    // Last verified request (real time) is before this cutoff.
    await deliverDueUpcoming(env, origin, Date.now() + DAY, now, upstream);
    expect(posted).toHaveLength(4);
    await deliverDueUpcoming(env, origin, 0, now, upstream);
    expect(posted).toHaveLength(5);
    expect(posted[4].session).toBe(bobSession);
  });
});
