import { seal, unseal } from "./connection";
import { HttpError, type Env } from "./env";

// A live view of the cloud browser in the account's MA sandbox. The sandbox
// cannot be reached from the phone, so a helper there sends what the browser
// shows and asks for the person's input through this relay: the latest frame
// and a short queue of pending input per view. The app reaches a view only
// through a verified account session; the sandbox only through the view's own
// random token, which is stored hashed and expires with the view. Frames and
// input can be private (typed text may be a password), so both are sealed
// with the account and input is deleted once the sandbox has taken it.
const framePurpose = "open-muse-browser-frame";
const inputPurpose = "open-muse-browser-input";
export const VIEW_LIFETIME = 30 * 60 * 1000;
const MAX_FRAME = 700_000; // base64 JPEG characters
const MAX_EVENTS = 20;
const viewId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keys = ["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown"];

export type BrowserEvent =
  | { type: "click"; x: number; y: number }
  | { type: "scroll"; x: number; y: number; dy: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string }
  | { type: "navigate"; url: string }
  | { type: "back" };

type ViewRow = {
  view_id: string;
  owner_id: string;
  token_hash: string;
  expires_at: number;
  closed: number;
  frame_seq: number;
  frame: string | null;
  input_seq: number;
};

export function validViewId(id: string) {
  if (!viewId.test(id)) throw new HttpError(404, "Endpoint not found.");
  return id;
}

const unit = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

// One input event from the app, or an error naming what is wrong.
export function browserEvent(value: unknown): BrowserEvent {
  const event = value as Record<string, unknown> | null;
  const fail = () => {
    throw new HttpError(400, "Describe each browser input as a known event.");
  };
  if (!event || typeof event !== "object") return fail();
  const only = (...names: string[]) =>
    Object.keys(event).every((key) => key === "type" || names.includes(key));
  switch (event.type) {
    case "click":
      return unit(event.x) && unit(event.y) && only("x", "y")
        ? { type: "click", x: event.x as number, y: event.y as number }
        : fail();
    case "scroll":
      return unit(event.x) &&
        unit(event.y) &&
        typeof event.dy === "number" &&
        Math.abs(event.dy) <= 5000 &&
        only("x", "y", "dy")
        ? {
            type: "scroll",
            x: event.x as number,
            y: event.y as number,
            dy: event.dy,
          }
        : fail();
    case "text":
      return typeof event.text === "string" &&
        event.text.length > 0 &&
        event.text.length <= 1000 &&
        only("text")
        ? { type: "text", text: event.text }
        : fail();
    case "key":
      return keys.includes(event.key as string) && only("key")
        ? { type: "key", key: event.key as string }
        : fail();
    case "navigate": {
      if (typeof event.url !== "string" || !only("url")) return fail();
      try {
        const url = new URL(event.url);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          event.url.length > 2000
        )
          return fail();
        return { type: "navigate", url: url.href };
      } catch {
        return fail();
      }
    }
    case "back":
      return only() ? { type: "back" } : fail();
    default:
      return fail();
  }
}

export function base64url(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hash(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return base64url(new Uint8Array(digest));
}

// The app's side: open, watch, steer and close the account's own views.
export class BrowserViews {
  constructor(
    private env: Env,
    private owner: string,
  ) {}

  private async own(id: string, now: number) {
    const row = await this.env.DB.prepare(
      "SELECT view_id,owner_id,token_hash,expires_at,closed,frame_seq,frame,input_seq FROM browser_views WHERE view_id=? AND owner_id=?",
    )
      .bind(validViewId(id), this.owner)
      .first<ViewRow>();
    if (!row) throw new HttpError(404, "This browser view was not found.");
    return { row, open: !row.closed && row.expires_at > now };
  }

  // A new view replaces the account's earlier ones. The token is returned
  // once, for the sandbox helper; only its hash is kept.
  async open(now: number) {
    const id = crypto.randomUUID();
    const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const expires = now + VIEW_LIFETIME;
    await this.env.DB.batch([
      this.env.DB.prepare("DELETE FROM browser_inputs WHERE owner_id=?").bind(
        this.owner,
      ),
      this.env.DB.prepare("DELETE FROM browser_views WHERE owner_id=?").bind(
        this.owner,
      ),
      this.env.DB.prepare(
        "INSERT INTO browser_views(view_id,owner_id,token_hash,created_at,expires_at,closed,frame_seq,frame,input_seq) VALUES (?,?,?,?,?,0,0,NULL,0)",
      ).bind(id, this.owner, await hash(token), now, expires),
    ]);
    return { id, token, expires_at: expires };
  }

  // The newest frame after `after`, if any, and whether the view is open.
  async frame(id: string, after: number, now: number) {
    const { row, open } = await this.own(id, now);
    const base = { open, seq: row.frame_seq, expires_at: row.expires_at };
    if (!row.frame || row.frame_seq <= after) return base;
    const value = (await unseal(
      this.env,
      framePurpose,
      this.owner,
      row.frame_seq,
      row.frame,
    )) as {
      image?: unknown;
      url?: unknown;
      title?: unknown;
      width?: unknown;
      height?: unknown;
    };
    return {
      ...base,
      image: value.image,
      url: value.url,
      title: value.title,
      width: value.width,
      height: value.height,
    };
  }

  async input(id: string, events: unknown, now: number) {
    if (!Array.isArray(events) || !events.length || events.length > MAX_EVENTS)
      throw new HttpError(400, "Send between 1 and 20 browser inputs.");
    const parsed = events.map(browserEvent);
    const { row, open } = await this.own(id, now);
    if (!open) throw new HttpError(409, "This browser view has ended.");
    const first = row.input_seq + 1;
    const statements = [
      this.env.DB.prepare(
        "UPDATE browser_views SET input_seq=input_seq+? WHERE view_id=? AND owner_id=? AND input_seq=?",
      ).bind(parsed.length, row.view_id, this.owner, row.input_seq),
    ];
    for (const [index, event] of parsed.entries()) {
      const seq = first + index;
      statements.push(
        this.env.DB.prepare(
          "INSERT INTO browser_inputs(view_id,owner_id,seq,encrypted,created_at) VALUES (?,?,?,?,?)",
        ).bind(
          row.view_id,
          this.owner,
          seq,
          await seal(this.env, inputPurpose, this.owner, seq, event),
          now,
        ),
      );
    }
    const [update] = await this.env.DB.batch(statements);
    if (!update.meta.changes)
      throw new HttpError(
        409,
        "Another input arrived at the same time; try again.",
      );
    return { accepted: parsed.length };
  }

  async close(id: string, now: number) {
    const { row } = await this.own(id, now);
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE browser_views SET closed=1,frame=NULL WHERE view_id=? AND owner_id=?",
      ).bind(row.view_id, this.owner),
      this.env.DB.prepare(
        "DELETE FROM browser_inputs WHERE view_id=? AND owner_id=?",
      ).bind(row.view_id, this.owner),
    ]);
    return { closed: true as const };
  }
}

// The sandbox helper's side: one request per cycle sends the newest frame
// (when it changed) and takes the input queued after `after`.
export async function relay(
  env: Env,
  id: string,
  token: string,
  input: Record<string, unknown>,
  now: number,
) {
  const row = await env.DB.prepare(
    "SELECT view_id,owner_id,token_hash,expires_at,closed,frame_seq,frame,input_seq FROM browser_views WHERE view_id=?",
  )
    .bind(validViewId(id))
    .first<ViewRow>();
  // An unknown view and a wrong token look the same.
  if (!row || !token || (await hash(token)) !== row.token_hash)
    throw new HttpError(404, "This browser view was not found.");
  if (row.closed || row.expires_at <= now) return { open: false, events: [] };
  const after = input.after;
  if (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0)
    throw new HttpError(400, "Say which input was handled last.");
  const owner = row.owner_id;
  const statements = [
    env.DB.prepare(
      "DELETE FROM browser_inputs WHERE view_id=? AND owner_id=? AND seq<=?",
    ).bind(row.view_id, owner, after),
  ];
  if (input.image !== undefined) {
    const { image, url, title, width, height } = input;
    if (
      typeof image !== "string" ||
      !image.length ||
      image.length > MAX_FRAME ||
      !/^[A-Za-z0-9+/=]+$/.test(image) ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      !(width > 0 && width <= 4096 && height > 0 && height <= 8192)
    )
      throw new HttpError(
        400,
        "Send the frame as a base64 JPEG with its size.",
      );
    const seq = row.frame_seq + 1;
    statements.push(
      env.DB.prepare(
        "UPDATE browser_views SET frame=?,frame_seq=?,frame_at=? WHERE view_id=? AND owner_id=?",
      ).bind(
        await seal(env, framePurpose, owner, seq, {
          image,
          url: typeof url === "string" ? url.slice(0, 2000) : "",
          title: typeof title === "string" ? title.slice(0, 300) : "",
          width,
          height,
        }),
        seq,
        now,
        row.view_id,
        owner,
      ),
    );
  }
  await env.DB.batch(statements);
  const rows = await env.DB.prepare(
    "SELECT seq,encrypted FROM browser_inputs WHERE view_id=? AND owner_id=? AND seq>? ORDER BY seq LIMIT 50",
  )
    .bind(row.view_id, owner, after)
    .all<{ seq: number; encrypted: string }>();
  const events = [];
  for (const item of rows.results)
    events.push({
      seq: item.seq,
      event: await unseal(env, inputPurpose, owner, item.seq, item.encrypted),
    });
  return { open: true, events };
}
