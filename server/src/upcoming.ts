import { ApiError, ArkClient } from "../../shared/ark";
import { uuid } from "../../shared/crypto";
import {
  pendingCustomTools,
  pendingPermissions,
  type AgentEvent,
} from "../../shared/types";
import {
  deliveredOccurrences,
  dueOccurrence,
  parseUpcoming,
  reminderBatch,
  reminderPrompt,
} from "../../shared/upcoming";
import { AccountCredentials } from "./account";
import { HttpError, type Env } from "./env";
import { edgeFetch } from "./fetch";
import { AccountWorkspaces } from "./workspace";

// The service delivers an account's UPCOMING.md items into the main session
// the account registered, so reminders arrive while every app is closed. Each
// occurrence is claimed in D1 before one message is sent, and nothing is ever
// sent twice: an ambiguous send is reconciled from history, never repeated.
const base = "https://ark.cn-beijing.volces.com/api/v3";
const LEASE = 4 * 60_000;
const DAILY_LIMIT = 48;
const RECONCILE_WINDOW = 86_400_000;
// Definite rejections: Ark did not accept the message.
const REJECTED = [400, 401, 403, 404, 409, 413, 422, 429];
const languages = ["en", "zh-CN"] as const;
const validId = (value: unknown) => {
  if (typeof value !== "string" || !/^[\w-]{1,200}$/.test(value))
    throw new HttpError(502, "The upstream resource ID is invalid.");
  return value;
};

type Target = {
  session_id: string;
  language: string;
  enabled: number;
  since: number;
  revision: number;
  state: "active" | "session_unavailable";
};
type Message = { event_id: string; session_id: string; phase: string };
type Session = {
  id: string;
  status?: string;
  agent?: { id?: string };
  environment_id?: string;
};
type Memory = { id: string; path?: string; content?: unknown };
type Page<T> = { data?: T[]; next_page?: string | null };

export class UpcomingDelivery {
  constructor(
    private env: Env,
    private owner: string,
    private fetcher: typeof fetch = edgeFetch,
  ) {}

  private target() {
    return this.env.DB.prepare(
      "SELECT session_id,language,enabled,since,revision,state FROM upcoming_targets WHERE owner_id=?",
    )
      .bind(this.owner)
      .first<Target>();
  }

  async status() {
    const target = await this.target();
    return {
      delivery: target?.enabled ? ("server" as const) : ("off" as const),
      session_id: target?.enabled ? target.session_id : null,
    };
  }

  async read() {
    const target = await this.target();
    return {
      enabled: Boolean(target?.enabled),
      session_id: target?.session_id ?? null,
      language: target?.language ?? null,
      since: target?.since ?? null,
      revision: target?.revision ?? 0,
      state: target?.state ?? null,
    };
  }

  // The account's key and its service-created workspace; nothing else.
  private async context() {
    const stored = await new AccountCredentials(this.env, this.owner).read();
    if (!stored.credential)
      throw new HttpError(409, "Save your Ark API key to the account first.");
    const { workspace } = await new AccountWorkspaces(
      this.env,
      this.owner,
      this.fetcher,
    ).read();
    if (!workspace?.agentId || !workspace.memoryStoreId)
      throw new HttpError(409, "Prepare the workspace before this change.");
    const { apiKey, project } = stored.credential;
    return {
      workspace,
      ark: new ArkClient(
        { arkBaseUrl: base, arkKey: apiKey, project },
        this.fetcher,
      ),
    };
  }

  // A session is the account's only when it runs the account's own agent.
  private async session(ark: ArkClient, agentId: string, id: string) {
    const session = await ark.request<Session>(`/sessions/${validId(id)}`);
    return session.id === id && session.agent?.id === agentId
      ? session
      : undefined;
  }

  async save(
    input: {
      session_id: string;
      language: (typeof languages)[number];
      enabled: boolean;
      revision: number;
    },
    now = Date.now(),
  ) {
    const current = await this.target();
    if ((current?.revision ?? 0) !== input.revision)
      throw new HttpError(
        409,
        "Reminder delivery changed on another device. Refresh before saving.",
      );
    if (input.enabled) {
      const { ark, workspace } = await this.context();
      const session = await this.session(
        ark,
        workspace.agentId!,
        input.session_id,
      ).catch((error) => {
        if (error instanceof ApiError && error.status === 404) return undefined;
        throw error;
      });
      if (!session)
        throw new HttpError(
          403,
          "This conversation does not belong to the signed-in account.",
        );
    }
    // Delivery starts when it is enabled, so earlier occurrences that a device
    // may already have delivered are never replayed.
    const since = current?.enabled ? current.since : now;
    const result = await this.env.DB.prepare(
      `INSERT INTO upcoming_targets(owner_id,session_id,language,enabled,since,revision,state,next_check_at,updated_at)
      VALUES(?,?,?,?,?,1,'active',?,?)
      ON CONFLICT(owner_id) DO UPDATE SET session_id=excluded.session_id,language=excluded.language,
        enabled=excluded.enabled,since=?,revision=upcoming_targets.revision+1,state='active',
        next_check_at=excluded.next_check_at,updated_at=excluded.updated_at
      WHERE upcoming_targets.revision=?`,
    )
      .bind(
        this.owner,
        input.session_id,
        input.language,
        input.enabled ? 1 : 0,
        since,
        now,
        now,
        since,
        input.revision,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        409,
        "Reminder delivery changed on another device. Refresh before saving.",
      );
    return this.read();
  }

  // The newest events, oldest first.
  private async recent(ark: ArkClient, session: string) {
    const page = await ark.request<Page<AgentEvent>>(
      `/sessions/${validId(session)}/events?order=desc&limit=100`,
    );
    return (page.data ?? []).reverse();
  }

  private async document(ark: ArkClient, store: string) {
    const path = `/memory_stores/${validId(store)}/memories`;
    const rows: Memory[] = [];
    let page = "";
    for (let i = 0; i < 20; i++) {
      const result = await ark.request<Page<Memory>>(
        `${path}?limit=100${page ? `&page=${encodeURIComponent(page)}` : ""}`,
      );
      rows.push(...(result.data ?? []));
      if (!result.next_page || result.next_page === page) break;
      page = result.next_page;
    }
    const hits = rows.filter((row) => row.path === "/UPCOMING.md");
    if (hits.length !== 1) return hits.length ? undefined : [];
    const memory = await ark.request<Memory>(`${path}/${validId(hits[0].id)}`);
    if (typeof memory.content !== "string") return undefined;
    try {
      return parseUpcoming(memory.content.trim());
    } catch {
      return undefined;
    }
  }

  private phase(event: string, phase: string, now: number) {
    return this.env.DB.prepare(
      "UPDATE upcoming_messages SET phase=?,updated_at=? WHERE event_id=? AND owner_id=?",
    )
      .bind(phase, now, event, this.owner)
      .run();
  }

  // Runs one delivery step for this owner. Returns what happened, for tests.
  async deliver(now = Date.now()) {
    const lease = await this.env.DB.prepare(
      `UPDATE upcoming_targets SET next_check_at=?
      WHERE owner_id=? AND enabled=1 AND state='active' AND next_check_at<=?`,
    )
      .bind(now + LEASE, this.owner, now)
      .run();
    if (!lease.meta.changes) return "skipped";
    try {
      return await this.step(now);
    } finally {
      await this.env.DB.prepare(
        "UPDATE upcoming_targets SET next_check_at=? WHERE owner_id=? AND next_check_at=?",
      )
        .bind(now, this.owner, now + LEASE)
        .run();
    }
  }

  private async step(now: number) {
    const target = await this.target();
    if (!target?.enabled || target.state !== "active") return "skipped";
    const { ark, workspace } = await this.context();

    // Earlier messages whose result was not confirmed are looked up, never
    // resent. While one stays unconfirmed, nothing new is sent.
    const open = await this.env.DB.prepare(
      `SELECT event_id,session_id,phase FROM upcoming_messages
      WHERE owner_id=? AND phase IN ('sending','unconfirmed') AND created_at>=?`,
    )
      .bind(this.owner, now - RECONCILE_WINDOW)
      .all<Message>();
    let pending = false;
    for (const message of open.results) {
      const history = await this.recent(ark, message.session_id);
      if (history.some((event) => event.id === message.event_id))
        await this.phase(message.event_id, "sent", now);
      else {
        if (message.phase === "sending")
          await this.phase(message.event_id, "unconfirmed", now);
        pending = true;
      }
    }
    if (pending) return "unconfirmed";

    const session = await this.session(
      ark,
      workspace.agentId!,
      target.session_id,
    ).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    });
    if (!session) {
      await this.env.DB.prepare(
        "UPDATE upcoming_targets SET state='session_unavailable',revision=revision+1,updated_at=? WHERE owner_id=?",
      )
        .bind(now, this.owner)
        .run();
      return "session_unavailable";
    }
    // Someone is using the conversation, or it waits for an approval or a
    // client's tool result; try again on a later tick.
    if (session.status !== "idle") return "busy";

    const items = await this.document(ark, workspace.memoryStoreId!);
    if (!items) return "unreadable";
    const last = await this.env.DB.prepare(
      "SELECT item_id,max(occurrence_at) AS at FROM upcoming_deliveries WHERE owner_id=? GROUP BY item_id",
    )
      .bind(this.owner)
      .all<{ item_id: string; at: number }>();
    const delivered = new Map(last.results.map((row) => [row.item_id, row.at]));
    let due = items.flatMap((item) => {
      const at = dueOccurrence(
        item,
        Math.max(target.since, delivered.get(item.id) ?? 0),
        now,
      );
      return at === undefined ? [] : [{ item, at }];
    });
    if (!due.length) return "idle";
    const history = await this.recent(ark, target.session_id);
    if (pendingPermissions(history).length || pendingCustomTools(history).length)
      return "busy";
    // Occurrences a device already delivered into the shared history.
    const named = deliveredOccurrences(history);
    due = due
      .filter(({ item, at }) => !named.has(`${item.id}@${at}`))
      .slice(0, reminderBatch);
    if (!due.length) return "idle";

    const sent = await this.env.DB.prepare(
      "SELECT count(*) AS n FROM upcoming_messages WHERE owner_id=? AND created_at>=?",
    )
      .bind(this.owner, now - 86_400_000)
      .first<{ n: number }>();
    if ((sent?.n ?? 0) >= DAILY_LIMIT) return "limited";

    // Claim before sending. An occurrence another invocation claimed first is
    // left to it.
    const event = `evt-${uuid()}`;
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO upcoming_messages(event_id,owner_id,session_id,phase,created_at,updated_at) VALUES(?,?,?,'sending',?,?)",
      ).bind(event, this.owner, target.session_id, now, now),
      ...due.map(({ item, at }) =>
        this.env.DB.prepare(
          "INSERT INTO upcoming_deliveries(owner_id,item_id,occurrence_at,event_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
        ).bind(this.owner, item.id, at, event),
      ),
    ]);
    const claimed = await this.env.DB.prepare(
      "SELECT item_id,occurrence_at FROM upcoming_deliveries WHERE owner_id=? AND event_id=?",
    )
      .bind(this.owner, event)
      .all<{ item_id: string; occurrence_at: number }>();
    const mine = due.filter(({ item, at }) =>
      claimed.results.some(
        (row) => row.item_id === item.id && row.occurrence_at === at,
      ),
    );
    if (!mine.length) {
      await this.env.DB.prepare(
        "DELETE FROM upcoming_messages WHERE event_id=? AND owner_id=?",
      )
        .bind(event, this.owner)
        .run();
      return "idle";
    }
    try {
      await ark.request(`/sessions/${validId(target.session_id)}/events`, {
        method: "POST",
        body: JSON.stringify({
          events: [
            {
              id: event,
              type: "user.message",
              content: [
                {
                  type: "text",
                  text: reminderPrompt(target.language, new Date(now), mine),
                },
              ],
            },
          ],
        }),
      });
      await this.phase(event, "sent", now);
      return "sent";
    } catch (error) {
      await this.phase(
        event,
        error instanceof ApiError && REJECTED.includes(error.status)
          ? "rejected"
          : "unconfirmed",
        now,
      );
      return "unconfirmed";
    }
  }
}

export function upcomingInput(input: Record<string, unknown>) {
  if (
    input.confirm !== true ||
    typeof input.session_id !== "string" ||
    !/^[\w-]{1,200}$/.test(input.session_id) ||
    !languages.includes(input.language as (typeof languages)[number]) ||
    typeof input.enabled !== "boolean" ||
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0 ||
    Object.keys(input).some(
      (key) =>
        !["session_id", "language", "enabled", "revision", "confirm"].includes(
          key,
        ),
    )
  )
    throw new HttpError(400, "Confirm reminder delivery for a conversation.");
  return input as {
    session_id: string;
    language: (typeof languages)[number];
    enabled: boolean;
    revision: number;
  };
}

// Accounts whose key was stored under the configured issuer and that made a
// verified request recently, oldest due first.
export async function deliverDueUpcoming(
  env: Env,
  issuer: string,
  activeSince: number,
  now: number,
  fetcher: typeof fetch = edgeFetch,
) {
  if (!issuer) return;
  const due = await env.DB.prepare(
    `SELECT t.owner_id FROM upcoming_targets t JOIN account_credentials c ON c.owner_id=t.owner_id
    WHERE t.enabled=1 AND t.state='active' AND t.next_check_at<=? AND t.owner_id GLOB 'muse_user_*'
      AND c.encrypted IS NOT NULL AND c.issuer=? AND c.last_seen_at>=?
    ORDER BY t.next_check_at,t.owner_id LIMIT 20`,
  )
    .bind(now, issuer, activeSince)
    .all<{ owner_id: string }>();
  for (const { owner_id: owner } of due.results) {
    try {
      await new UpcomingDelivery(env, owner, fetcher).deliver(now);
    } catch {
      /* Fail closed for this owner. Do not log private upstream state. */
    }
  }
}
