import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { database } from "./database";
import { handle } from "../src/index";
import { pruneClaims } from "../src/claims";
import { UpcomingDelivery } from "../src/upcoming";
import { supabaseOwner } from "../../shared/supabase-auth";
import { isCheckInPrompt } from "../../shared/checkin";
import { isGoalFollowUpPrompt } from "../../shared/goal-followup";
import { claimRetention } from "../../shared/proactive";
import type { Env } from "../src/env";

const origin = "https://auth.example.com";
const key = "test-proactive-ark-api-key-1";
const users: Record<string, string> = {
  "alice-access-token-000000001": "2a1f0c55-77a3-4b0e-9c1e-1d2f3a4b5c6d",
  "bob-access-token-00000000001": "8e7d6c5b-4a39-4281-b7c6-d5e4f3a2b1c0",
};
const [ALICE, BOB] = Object.keys(users);
const owner = (token: string) => supabaseOwner(origin, users[token]);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const zone = "America/New_York";
// 2026-10-05T14:00:00Z is a Monday, 10:00 in New York (EDT, UTC-4).
const MORNING = Date.parse("2026-10-05T14:00:00Z");

type Row = Record<string, unknown> & { id: string };
const ark: Record<string, Record<string, Row>> = {};
const events: Record<string, Row[]> = {};
const memory: Record<string, string> = {};
let sessionStatus = "idle";
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
      const event = JSON.parse(String(init!.body)).events[0];
      (events[id] ??= []).push(event);
      posted.push({ session: id, event });
      return Response.json({ data: [event] });
    }
    return Response.json({ data: [...(events[id] ?? [])].reverse() });
  }
  if (collection === "memory_stores" && sub === "memories") {
    const rows = Object.keys(memory).map((path) => ({
      id: `mem${path.replace(/\W/g, "-")}`,
      path,
    }));
    if (subId) {
      const row = rows.find((entry) => entry.id === subId);
      return row
        ? Response.json({ ...row, content: memory[row.path] })
        : Response.json({}, { status: 404 });
    }
    return Response.json({ data: rows });
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
        {
          credential: { apiKey: key, project: "" },
          revision: 0,
          confirm: true,
        },
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
  return ((await response.json()) as { workspace: { agentId: string } })
    .workspace;
}
function session(agentId: string) {
  const id = `sessions-${++sequence}`;
  (ark.sessions ??= {})[id] = { id, agent: { id: agentId } };
  return id;
}
const claim = (token: string, body: unknown) =>
  request(token, "/v1/account/claims", body, "POST");
const save = async (token: string, body: Record<string, unknown>) => {
  const current = (await (
    await request(token, "/v1/account/upcoming")
  ).json()) as { revision: number };
  return request(
    token,
    "/v1/account/upcoming",
    { language: "en", revision: current.revision, confirm: true, ...body },
    "PUT",
  );
};
const message = (
  id: string,
  type: "user.message" | "agent.message",
  at: number,
  text = id,
): Row => ({
  id,
  type,
  created_at: new Date(at).toISOString(),
  content: [{ type: "text", text }],
});
const goal = (id: string, updated: number, status = "active") => ({
  id,
  title: `Goal ${id}`,
  description: "",
  status,
  steps: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: new Date(updated).toISOString(),
});
const goals = (...items: object[]) =>
  JSON.stringify({ version: 1, goals: items });

describe("Cross-device claims", () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  let aliceSession: string;
  let bobSession: string;
  const deliver = (at: number) =>
    new UpcomingDelivery(env, owner(ALICE), upstream).deliver(at);
  // A quiet, established conversation: the companion replied 30 hours ago.
  const quiet = (now: number) => {
    events[aliceSession] = [
      message("hello", "user.message", now - 31 * HOUR),
      message("answer", "agent.message", now - 30 * HOUR),
    ];
  };

  beforeAll(async () => {
    fixture = await database();
    env = {
      DB: fixture.db,
      SUPABASE_AUTH_URL: origin,
      SUPABASE_ANON_KEY: "sb_publishable_test_public_key_only",
      BACKGROUND_ENABLED: "true",
      CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        current: "v1",
        keys: { v1: btoa("p".repeat(32)) },
      }),
    };
    const alice = await prepare(ALICE);
    const bob = await prepare(BOB);
    aliceSession = session(alice.agentId);
    bobSession = session(bob.agentId);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await fixture?.dispose();
  });
  beforeEach(async () => {
    // Claims made through the API are stamped with the service clock.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MORNING);
    sessionStatus = "idle";
    posted.length = 0;
    for (const path of Object.keys(memory)) delete memory[path];
    await env.DB.batch([
      env.DB.prepare("DELETE FROM proactive_claims"),
      env.DB.prepare("DELETE FROM upcoming_messages"),
      env.DB.prepare("DELETE FROM upcoming_deliveries"),
      env.DB.prepare("UPDATE upcoming_targets SET next_check_at=0"),
    ]);
  });

  it("gives each key to its first claimant only, per account and kind", async () => {
    const body = {
      kind: "checkin",
      key: "2026-10-05",
      session_id: aliceSession,
    };
    const first = await claim(ALICE, body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ claimed: true });
    const again = (await (await claim(ALICE, body)).json()) as Record<
      string,
      unknown
    >;
    expect(again).toMatchObject({ claimed: false, by: "app" });
    expect(again.age_ms).toBeGreaterThanOrEqual(0);
    // Concurrent claims: exactly one wins.
    const race = await Promise.all(
      [1, 2, 3, 4].map(() =>
        claim(ALICE, { ...body, key: "2026-10-06" }).then(
          (response) => response.json() as Promise<{ claimed: boolean }>,
        ),
      ),
    );
    expect(race.filter((result) => result.claimed)).toHaveLength(1);
    // Another kind and another account are separate.
    expect(
      await (await claim(ALICE, { ...body, kind: "reminder" })).json(),
    ).toEqual({ claimed: true });
    expect(
      await (await claim(BOB, { ...body, session_id: bobSession })).json(),
    ).toEqual({ claimed: true });
    const rows = await env.DB.prepare(
      "SELECT owner_id FROM proactive_claims WHERE kind='checkin' AND claim_key='2026-10-05'",
    ).all<{ owner_id: string }>();
    expect(rows.results.map((row) => row.owner_id).sort()).toEqual(
      [owner(ALICE), owner(BOB)].sort(),
    );
  });

  it("rejects malformed claims", async () => {
    for (const body of [
      { kind: "welcome", key: "x", session_id: aliceSession },
      { kind: "checkin", key: "has space", session_id: aliceSession },
      { kind: "checkin", key: "x".repeat(121), session_id: aliceSession },
      { kind: "checkin", key: "x", session_id: "../other" },
      { kind: "checkin", key: "x" },
      { kind: "checkin", key: "x", session_id: aliceSession, extra: 1 },
    ])
      expect((await claim(ALICE, body)).status).toBe(400);
    const anonymous = await handle(
      new Request("https://background.example/v1/account/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "checkin",
          key: "x",
          session_id: aliceSession,
        }),
      }),
      env,
      upstream,
    );
    expect(anonymous.status).toBe(401);
  });

  it("lets an expired claim be taken again and prunes old ones", async () => {
    const body = {
      kind: "goal",
      key: "g1@2026-10-05",
      session_id: aliceSession,
    };
    expect(await (await claim(ALICE, body)).json()).toEqual({ claimed: true });
    await env.DB.prepare("UPDATE proactive_claims SET expires_at=?")
      .bind(Date.now() - 1)
      .run();
    expect(await (await claim(ALICE, body)).json()).toEqual({ claimed: true });
    const row = await env.DB.prepare(
      "SELECT expires_at,created_at FROM proactive_claims",
    ).first<{ expires_at: number; created_at: number }>();
    expect(Number(row!.expires_at) - Number(row!.created_at)).toBe(
      claimRetention,
    );
    await pruneClaims(env, Date.now() + claimRetention + 1);
    const left = await env.DB.prepare(
      "SELECT count(*) AS n FROM proactive_claims",
    ).first<{ n: number }>();
    expect(Number(left!.n)).toBe(0);
  });

  it("keeps check-ins and goal follow-ups off until the account opts in", async () => {
    const off = await save(ALICE, { session_id: aliceSession, enabled: true });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({
      enabled: true,
      checkins: false,
      goal_followups: false,
      time_zone: null,
    });
    quiet(MORNING);
    memory["/GOALS.md"] = goals(goal("run", MORNING - 10 * DAY));
    expect(await deliver(MORNING)).toBe("idle");
    expect(posted).toHaveLength(0);
    // Opting in needs a time zone.
    expect(
      (
        await save(ALICE, {
          session_id: aliceSession,
          enabled: true,
          checkins: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await save(ALICE, {
          session_id: aliceSession,
          enabled: true,
          checkins: true,
          time_zone: "Not/AZone",
        })
      ).status,
    ).toBe(400);
    const on = await save(ALICE, {
      session_id: aliceSession,
      enabled: true,
      checkins: true,
      time_zone: zone,
    });
    expect(await on.json()).toMatchObject({
      checkins: true,
      goal_followups: false,
      time_zone: zone,
    });
    // Registering a new chapter keeps the choice; turning delivery off clears it.
    expect(
      await (
        await save(ALICE, { session_id: aliceSession, enabled: true })
      ).json(),
    ).toMatchObject({ checkins: true });
    expect(
      await (
        await save(ALICE, { session_id: aliceSession, enabled: false })
      ).json(),
    ).toMatchObject({ enabled: false, checkins: false, goal_followups: false });
    expect(
      await (
        await save(ALICE, { session_id: aliceSession, enabled: true })
      ).json(),
    ).toMatchObject({ checkins: false });
  });

  it("checks in once per local day, in the person's time zone and waking hours", async () => {
    expect(
      (
        await save(ALICE, {
          session_id: aliceSession,
          enabled: true,
          checkins: true,
          time_zone: zone,
        })
      ).status,
    ).toBe(200);
    await env.DB.prepare("UPDATE upcoming_targets SET next_check_at=0").run();
    // 03:00 UTC on Monday is 23:00 Sunday in New York: too late.
    const night = MORNING - 11 * HOUR;
    quiet(night);
    expect(await deliver(night)).toBe("idle");
    // 07:30 in New York is still too early, though it is 11:30 UTC.
    const early = MORNING - 2.5 * HOUR;
    quiet(early);
    expect(await deliver(early)).toBe("idle");
    expect(posted).toHaveLength(0);

    quiet(MORNING);
    expect(await deliver(MORNING)).toBe("checkin");
    expect(posted).toHaveLength(1);
    const text = (posted[0].event.content as { text: string }[])[0].text;
    expect(isCheckInPrompt(text)).toBe(true);
    expect(text).toContain("Monday 10:00 AM");
    expect(posted[0].session).toBe(aliceSession);
    const claims = await env.DB.prepare(
      "SELECT kind,claim_key,claimant FROM proactive_claims",
    ).all();
    expect(claims.results).toEqual([
      { kind: "checkin", claim_key: "2026-10-05", claimant: "service" },
    ]);
    // Later that day, even after a quiet history again, nothing more is sent.
    quiet(MORNING + 8 * HOUR);
    expect(await deliver(MORNING + 8 * HOUR)).toBe("idle");
    expect(posted).toHaveLength(1);
    // The app's claim for that day is refused.
    expect(
      await (
        await claim(ALICE, {
          kind: "checkin",
          key: "2026-10-05",
          session_id: aliceSession,
        })
      ).json(),
    ).toMatchObject({ claimed: false, by: "service" });
  });

  it("never checks in on a busy, recent, pending, or unanswered conversation", async () => {
    await save(ALICE, {
      session_id: aliceSession,
      enabled: true,
      checkins: true,
      time_zone: zone,
    });
    const now = MORNING + 7 * DAY;
    // The last message is only 17 hours old.
    events[aliceSession] = [
      message("hello", "user.message", now - 18 * HOUR),
      message("answer", "agent.message", now - 17 * HOUR),
    ];
    expect(await deliver(now)).toBe("idle");
    // The person's message still waits for a reply.
    events[aliceSession] = [
      message("hello", "user.message", now - 31 * HOUR),
      message("answer", "agent.message", now - 30 * HOUR),
      message("again", "user.message", now - 29 * HOUR),
    ];
    expect(await deliver(now)).toBe("idle");
    // A reminder or welcome from the app is still unanswered by the person.
    events[aliceSession] = [
      message("hello", "user.message", now - 40 * HOUR),
      message("answer", "agent.message", now - 39 * HOUR),
      message(
        "reminder",
        "user.message",
        now - 31 * HOUR,
        "<open-muse-reminder>\nDue items:\n</open-muse-reminder>",
      ),
      message("delivered", "agent.message", now - 30 * HOUR),
    ];
    expect(await deliver(now)).toBe("idle");
    // An approval is pending.
    quiet(now);
    events[aliceSession].push(
      {
        id: "tool-1",
        type: "agent.tool_use",
        created_at: new Date(now - 30 * HOUR).toISOString(),
      },
      {
        id: "status-1",
        type: "session.status_idle",
        created_at: new Date(now - 30 * HOUR).toISOString(),
        stop_reason: { type: "requires_action", event_ids: ["tool-1"] },
      },
    );
    expect(await deliver(now)).toBe("idle");
    // The conversation is running.
    quiet(now);
    sessionStatus = "running";
    expect(await deliver(now)).toBe("busy");
    expect(posted).toHaveLength(0);
    // An app checked in today first.
    sessionStatus = "idle";
    vi.setSystemTime(now - 5 * HOUR);
    await claim(ALICE, {
      kind: "checkin",
      key: "2026-10-12",
      session_id: aliceSession,
    });
    expect(await deliver(now)).toBe("idle");
    expect(posted).toHaveLength(0);
    const messages = await env.DB.prepare(
      "SELECT count(*) AS n FROM upcoming_messages",
    ).first<{ n: number }>();
    expect(Number(messages!.n)).toBe(0);
  });

  it("follows up on a goal without progress for a week, at most every three days", async () => {
    await save(ALICE, {
      session_id: aliceSession,
      enabled: true,
      checkins: false,
      goal_followups: true,
      time_zone: zone,
    });
    const now = MORNING + 14 * DAY;
    memory["/GOALS.md"] = goals(
      goal("fresh", now - 6 * DAY),
      goal("done", now - 30 * DAY, "completed"),
    );
    quiet(now);
    expect(await deliver(now)).toBe("idle");
    memory["/GOALS.md"] = goals(
      goal("fresh", now - 6 * DAY),
      goal("run", now - 9 * DAY),
      goal("read", now - 8 * DAY),
    );
    expect(await deliver(now)).toBe("goal");
    expect(posted).toHaveLength(1);
    const text = (posted[0].event.content as { text: string }[])[0].text;
    expect(isGoalFollowUpPrompt(text)).toBe(true);
    // The stalest goal goes first.
    expect(text).toContain('"Goal run"');
    const claims = await env.DB.prepare(
      "SELECT kind,claim_key FROM proactive_claims ORDER BY kind",
    ).all();
    expect(claims.results).toEqual([
      { kind: "checkin", claim_key: "2026-10-19" },
      { kind: "goal", claim_key: "run@2026-10-19" },
    ]);
    // Two days later another goal is stale, but the account had one recently.
    const later = now + 2 * DAY;
    quiet(later);
    expect(await deliver(later)).toBe("idle");
    // After three days the next stale goal follows, not the same one again.
    const next = now + 3 * DAY + HOUR;
    quiet(next);
    expect(await deliver(next)).toBe("goal");
    expect((posted[1].event.content as { text: string }[])[0].text).toContain(
      '"Goal read"',
    );
    expect(posted).toHaveLength(2);
  });

  it("leaves a reminder occurrence an app claimed to that app", async () => {
    await save(ALICE, { session_id: aliceSession, enabled: true });
    await env.DB.prepare("UPDATE upcoming_targets SET since=? WHERE owner_id=?")
      .bind(MORNING - DAY, owner(ALICE))
      .run();
    memory["/UPCOMING.md"] = JSON.stringify({
      version: 1,
      items: [
        {
          id: "standup",
          title: "Standup",
          instruction: "",
          schedule: { kind: "daily", time: "09:00" },
          time_zone: "UTC",
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    quiet(MORNING);
    const due = Date.parse("2026-10-05T09:00:00Z");
    expect(
      await (
        await claim(ALICE, {
          kind: "reminder",
          key: `standup@${due}`,
          session_id: aliceSession,
        })
      ).json(),
    ).toEqual({ claimed: true });
    expect(await deliver(MORNING)).toBe("idle");
    expect(posted).toHaveLength(0);
    // The next day's occurrence is the service's, and claimed by it.
    quiet(MORNING + DAY);
    expect(await deliver(MORNING + DAY)).toBe("sent");
    expect(
      await (
        await claim(ALICE, {
          kind: "reminder",
          key: `standup@${due + DAY}`,
          session_id: aliceSession,
        })
      ).json(),
    ).toMatchObject({ claimed: false, by: "service" });
  });
});
