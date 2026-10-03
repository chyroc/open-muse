import { ApiError, ArkClient } from "../../shared/ark";
import { base64url, uuid } from "../../shared/crypto";
import { isSupabaseOwner, supabaseOrigin } from "../../shared/supabase-auth";
import {
  pendingCustomTools,
  pendingPermissions,
  type AgentEvent,
} from "../../shared/types";
import {
  larkChannelMessage,
  larkChannelPrompt,
  webhookPolicy,
  webhookPrompt,
} from "../../shared/webhooks";
import { ACCOUNT_ACTIVITY_WINDOW, AccountCredentials } from "./account";
import { tokenHash } from "./auth";
import { ConnectionStore } from "./connection";
import { backgroundReady, HttpError, maEndpoint, type Env } from "./env";
import { edgeFetch } from "./fetch";
import { AccountWorkspaces } from "./workspace";

// Incoming webhooks: an account creates URLs that external systems post
// events to, and each accepted event becomes one hidden message in the main
// chat the account registered for delivery. The hook's secret is returned
// once and stored only as a hash. Ingress needs no account session; it is
// authenticated by that secret alone, and deleting the hook or the account
// stops it at once. Like Upcoming, a message is claimed before it is sent and
// an ambiguous send is checked in history, never repeated.
const HOUR = 3_600_000;
const RECONCILE_WINDOW = 86_400_000;
// Definite rejections: MA did not accept the message.
const REJECTED = [400, 401, 403, 404, 409, 413, 422, 429];
const INGRESS = /^\/v1\/hooks\/([A-Za-z0-9_-]{1,80})$/;
const SECRET = /^omh_[A-Za-z0-9_-]{43}$/;
const EVENT_ID = /^[\x21-\x7e]{1,200}$/;
// Compared against when a hook does not exist, so that case costs the same.
const MISSING = "0".repeat(64);

type Hook = {
  id: string;
  owner_id: string;
  name: string;
  secret_hash: string;
};
type Delivery = {
  id: string;
  session_id: string;
  status: "sending" | "sent" | "unconfirmed" | "rejected";
};
type Session = { id: string; status?: string; agent?: { id?: string } };
type Page<T> = { data?: T[] };

// The hook ID when the request is the public ingress, `POST /v1/hooks/:id`.
export function webhookIngress(pathname: string, method: string) {
  return method === "POST" ? INGRESS.exec(pathname)?.[1] : undefined;
}

export function webhookInput(input: Record<string, unknown>) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (
    !/^[^\r\n\u0000-\u001f]{1,60}$/.test(name) ||
    Object.keys(input).some((key) => key !== "name")
  )
    throw new HttpError(400, "Name the webhook in up to 60 characters.");
  return name;
}

function equal(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const validId = (value: unknown) => {
  if (typeof value !== "string" || !/^[\w-]{1,200}$/.test(value))
    throw new HttpError(502, "The upstream resource ID is invalid.");
  return value;
};

export class AccountWebhooks {
  constructor(
    private env: Env,
    private owner: string,
  ) {}

  // Whether events can be delivered now: a main chat registered for delivery
  // while the apps are closed, and background work allowed.
  async mainChat() {
    const target = await this.env.DB.prepare(
      "SELECT session_id,language FROM upcoming_targets WHERE owner_id=? AND enabled=1 AND state='active'",
    )
      .bind(this.owner)
      .first<{ session_id: string; language: string }>();
    return target ?? undefined;
  }

  async list(background: boolean) {
    const hooks = await this.env.DB.prepare(
      "SELECT id,name,created_at,last_delivery_at FROM webhooks WHERE owner_id=? ORDER BY created_at,id",
    )
      .bind(this.owner)
      .all<{
        id: string;
        name: string;
        created_at: number;
        last_delivery_at: number | null;
      }>();
    const deliveries = await this.env.DB.prepare(
      "SELECT id,webhook_id,event_key,status,created_at FROM webhook_deliveries WHERE owner_id=? ORDER BY created_at DESC,id LIMIT 20",
    )
      .bind(this.owner)
      .all<{
        id: string;
        webhook_id: string;
        event_key: string | null;
        status: Delivery["status"];
        created_at: number;
      }>();
    return {
      webhooks: hooks.results,
      deliveries: deliveries.results.map(({ event_key, ...row }) => ({
        ...row,
        event_id: event_key,
      })),
      ready: { mainChat: Boolean(await this.mainChat()), background },
    };
  }

  async create(name: string, now = Date.now()) {
    const id = uuid();
    const secret = `omh_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
    // Insert only while the account is under its limit, in one statement.
    const result = await this.env.DB.prepare(
      `INSERT INTO webhooks(id,owner_id,name,secret_hash,created_at,last_delivery_at)
      SELECT ?,?,?,?,?,NULL WHERE (SELECT count(*) FROM webhooks WHERE owner_id=?)<?`,
    )
      .bind(
        id,
        this.owner,
        name,
        await tokenHash(secret),
        now,
        this.owner,
        webhookPolicy.perAccount,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(
        409,
        "This account already has the most webhooks it can keep. Revoke one first.",
        "webhook_limit",
      );
    return {
      id,
      name,
      created_at: now,
      last_delivery_at: null,
      path: `/v1/hooks/${id}`,
      secret,
    };
  }

  // Revoking deletes the hook and its delivery records; ingress stops at once.
  // Repeating it succeeds.
  async revoke(id: string) {
    if (!/^[\w-]{1,80}$/.test(id))
      throw new HttpError(404, "Endpoint not found.");
    await this.env.DB.batch([
      this.env.DB.prepare(
        "DELETE FROM webhook_deliveries WHERE webhook_id=? AND owner_id=?",
      ).bind(id, this.owner),
      this.env.DB.prepare(
        "DELETE FROM webhooks WHERE id=? AND owner_id=?",
      ).bind(id, this.owner),
    ]);
    return { ok: true as const };
  }
}

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > webhookPolicy.bodyBytes) {
          await reader.cancel();
          throw new HttpError(413, "Request is too large.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder().decode(bytes);
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    return { text, json: undefined };
  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    throw new HttpError(400, "A valid JSON body is required.");
  }
}

// Runs one public webhook request. The response never says whether a hook
// exists without its secret.
export async function receiveWebhook(
  env: Env,
  id: string,
  request: Request,
  now = Date.now(),
  fetcher: typeof fetch = edgeFetch,
) {
  const url = new URL(request.url);
  const header = /^Bearer (\S+)$/.exec(
    request.headers.get("Authorization") ?? "",
  )?.[1];
  // Lark and some services cannot set headers, so the secret may come in
  // the query instead.
  const secret = header ?? url.searchParams.get("token") ?? "";
  const hook = await env.DB.prepare(
    "SELECT id,owner_id,name,secret_hash FROM webhooks WHERE id=?",
  )
    .bind(id)
    .first<Hook>();
  const hash = await tokenHash(secret);
  if (
    !equal(hash, hook?.secret_hash ?? MISSING) ||
    !hook ||
    !SECRET.test(secret) ||
    !isSupabaseOwner(hook.owner_id)
  )
    throw new HttpError(401, "The webhook token is invalid.");
  const { text, json } = await readBody(request);
  const body =
    json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : undefined;
  // Lark's URL verification handshake, answered only after the token check.
  if (
    body?.type === "url_verification" &&
    typeof body.challenge === "string" &&
    body.challenge.length <= 512
  )
    return { challenge: body.challenge };
  const larkHeader = body?.header as Record<string, unknown> | undefined;
  const eventKey =
    request.headers.get("X-Event-Id") ??
    (typeof larkHeader?.event_id === "string" ? larkHeader.event_id : null);
  if (eventKey !== null && !EVENT_ID.test(eventKey))
    throw new HttpError(400, "The event ID is invalid.");
  const webhook = new WebhookDelivery(env, hook, fetcher);
  // The secret never reaches the conversation, even if a sender echoes it.
  return webhook.deliver(text.split(secret).join("[redacted]"), eventKey, now);
}

class WebhookDelivery {
  private owner: string;
  constructor(
    private env: Env,
    private hook: Hook,
    private fetcher: typeof fetch,
  ) {
    this.owner = hook.owner_id;
  }

  private status(id: string, status: Delivery["status"], now: number) {
    return this.env.DB.prepare(
      "UPDATE webhook_deliveries SET status=?,updated_at=? WHERE id=? AND owner_id=?",
    )
      .bind(status, now, id, this.owner)
      .run();
  }

  private async context() {
    const stored = await new AccountCredentials(this.env, this.owner).read();
    if (!stored.credential)
      throw new HttpError(
        409,
        "Background work is not allowed for this account.",
        "background_not_allowed",
      );
    const { workspace } = await new AccountWorkspaces(
      this.env,
      this.owner,
      this.fetcher,
    ).read();
    if (!workspace?.agentId)
      throw new HttpError(
        409,
        "Background work is not allowed for this account.",
        "background_not_allowed",
      );
    const { apiKey, project } = stored.credential;
    return {
      agentId: workspace.agentId,
      ark: new ArkClient(
        { ...maEndpoint(this.env), arkKey: apiKey, project },
        this.fetcher,
      ),
    };
  }

  // The newest events of a session, oldest first.
  private async recent(ark: ArkClient, session: string) {
    const page = await ark.request<Page<AgentEvent>>(
      `/sessions/${validId(session)}/events?order=desc&limit=100`,
    );
    return (page.data ?? []).reverse();
  }

  // Ambiguous sends are confirmed from history, never resent.
  private async reconcile(ark: ArkClient, now: number) {
    const open = await this.env.DB.prepare(
      `SELECT id,session_id,status FROM webhook_deliveries
      WHERE owner_id=? AND status IN ('sending','unconfirmed') AND created_at>=?
      ORDER BY created_at LIMIT 20`,
    )
      .bind(this.owner, now - RECONCILE_WINDOW)
      .all<Delivery>();
    const histories = new Map<string, AgentEvent[]>();
    for (const delivery of open.results) {
      if (!histories.has(delivery.session_id)) {
        if (histories.size >= 3) break;
        histories.set(
          delivery.session_id,
          await this.recent(ark, delivery.session_id).catch(() => []),
        );
      }
      if (
        histories
          .get(delivery.session_id)!
          .some((event) => event.id === delivery.id)
      )
        await this.status(delivery.id, "sent", now);
      else if (delivery.status === "sending")
        await this.status(delivery.id, "unconfirmed", now);
    }
    return histories;
  }

  private async duplicate(eventKey: string, now: number) {
    const existing = await this.env.DB.prepare(
      "SELECT id,session_id,status FROM webhook_deliveries WHERE webhook_id=? AND event_key=?",
    )
      .bind(this.hook.id, eventKey)
      .first<Delivery>();
    if (!existing) return undefined;
    let status = existing.status;
    if (status === "sending" || status === "unconfirmed") {
      try {
        await this.reconcile((await this.context()).ark, now);
        status =
          (
            await this.env.DB.prepare(
              "SELECT status FROM webhook_deliveries WHERE id=?",
            )
              .bind(existing.id)
              .first<{ status: Delivery["status"] }>()
          )?.status ?? status;
      } catch {
        /* The earlier delivery stays as recorded; it is never resent. */
      }
    }
    return {
      ok: true as const,
      duplicate: true,
      delivery: existing.id,
      status,
    };
  }

  async deliver(data: string, eventKey: string | null, now: number) {
    // A Lark bot message is delivered as the person's message channel.
    let lark: ReturnType<typeof larkChannelMessage>;
    try {
      lark = larkChannelMessage(JSON.parse(data));
    } catch {
      lark = undefined;
    }
    if (eventKey) {
      const seen = await this.duplicate(eventKey, now);
      if (seen) return seen;
    }
    // The same account gate as scheduled work: a key stored under the
    // configured issuer and a verified request within the activity window.
    let issuer = "";
    try {
      issuer = supabaseOrigin(this.env.SUPABASE_AUTH_URL);
    } catch {
      /* No issuer: no account is active. */
    }
    const active = await this.env.DB.prepare(
      "SELECT 1 AS ok FROM account_credentials WHERE owner_id=? AND encrypted IS NOT NULL AND issuer=? AND last_seen_at>=?",
    )
      .bind(this.owner, issuer, now - ACCOUNT_ACTIVITY_WINDOW)
      .first<{ ok: number }>();
    const connection = active
      ? await new ConnectionStore(this.env, this.owner).resolve()
      : undefined;
    if (!connection || !backgroundReady(connection.env))
      throw new HttpError(
        409,
        "Background work is not allowed for this account. Allow it in the app's settings.",
        "background_not_allowed",
      );
    const target = await new AccountWebhooks(this.env, this.owner).mainChat();
    if (!target)
      throw new HttpError(
        409,
        "No main chat is registered for delivery. Turn on delivery while Open Muse is closed in the app's Upcoming tab.",
        "no_main_chat",
      );
    const counts = await this.env.DB.prepare(
      `SELECT count(*) AS account,
        coalesce(sum(CASE WHEN webhook_id=? THEN 1 ELSE 0 END),0) AS hook
      FROM webhook_deliveries WHERE owner_id=? AND created_at>=? AND status<>'rejected'`,
    )
      .bind(this.hook.id, this.owner, now - HOUR)
      .first<{ account: number; hook: number }>();
    if (
      Number(counts?.hook ?? 0) >= webhookPolicy.hookHourly ||
      Number(counts?.account ?? 0) >= webhookPolicy.accountHourly
    )
      throw new HttpError(429, "Too many events. Try again later.");

    const { ark, agentId } = await this.context();
    const session = await ark
      .request<Session>(`/sessions/${validId(target.session_id)}`)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) return undefined;
        throw error;
      });
    if (
      !session ||
      session.id !== target.session_id ||
      session.agent?.id !== agentId
    )
      throw new HttpError(
        409,
        "No main chat is registered for delivery. Turn on delivery while Open Muse is closed in the app's Upcoming tab.",
        "no_main_chat",
      );
    const histories = await this.reconcile(ark, now);
    const history =
      histories.get(target.session_id) ??
      (await this.recent(ark, target.session_id));
    // The conversation is running or waits for an approval or a client's
    // tool result. Nothing is recorded, so the sender may try again.
    if (
      session.status !== "idle" ||
      pendingPermissions(history).length ||
      pendingCustomTools(history).length
    )
      throw new HttpError(
        503,
        "The main chat is busy. Send the event again later.",
        "busy",
      );

    // Claim before sending. A concurrent request with the same event ID
    // finds this row and sends nothing.
    const event = `evt-${uuid()}`;
    const claim = await this.env.DB.prepare(
      `INSERT INTO webhook_deliveries(id,webhook_id,owner_id,event_key,session_id,status,created_at,updated_at)
      VALUES(?,?,?,?,?,'sending',?,?) ON CONFLICT DO NOTHING`,
    )
      .bind(
        event,
        this.hook.id,
        this.owner,
        eventKey,
        target.session_id,
        now,
        now,
      )
      .run();
    if (!claim.meta.changes && eventKey)
      return (await this.duplicate(eventKey, now))!;
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
                  text: lark
                    ? larkChannelPrompt(target.language, new Date(now), lark)
                    : webhookPrompt(
                        target.language,
                        new Date(now),
                        this.hook,
                        data.trim() || "(empty)",
                      ),
                },
              ],
            },
          ],
        }),
      });
      await this.status(event, "sent", now);
    } catch (error) {
      if (error instanceof ApiError && REJECTED.includes(error.status)) {
        // Nothing was accepted, so the sender may send this event again.
        await this.env.DB.prepare(
          "UPDATE webhook_deliveries SET status='rejected',event_key=NULL,updated_at=? WHERE id=? AND owner_id=?",
        )
          .bind(now, event, this.owner)
          .run();
        throw new HttpError(
          502,
          "The main chat did not accept the event.",
          "rejected",
        );
      }
      await this.status(event, "unconfirmed", now);
      await this.touch(now);
      return {
        ok: true as const,
        duplicate: false,
        delivery: event,
        status: "unconfirmed" as const,
      };
    }
    await this.touch(now);
    return {
      ok: true as const,
      duplicate: false,
      delivery: event,
      status: "sent" as const,
    };
  }

  private touch(now: number) {
    return this.env.DB.prepare(
      "UPDATE webhooks SET last_delivery_at=? WHERE id=? AND owner_id=?",
    )
      .bind(now, this.hook.id, this.owner)
      .run();
  }
}
