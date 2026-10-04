import { seal, unseal } from "./connection";
import { HttpError, type Env } from "./env";
import { edgeFetch } from "./fetch";

// The account's Lark (Feishu) connection, set up by this service so the
// person never runs lark-cli setup in a conversation. It speaks the same
// public device flows lark-cli uses: app registration on accounts.feishu.cn
// (the person creates an app or picks an existing one), then the OAuth device
// flow for their user token with offline access. The app secret and refresh
// token stay here, sealed with the account; a conversation's sandbox only
// ever receives a short-lived user access token, renewed here when needed.
const purpose = "open-muse-lark-connection";
const ACCOUNTS = "https://accounts.feishu.cn";
const OPEN = "https://open.feishu.cn";
// Renew the user token when it has less than this left.
const RENEW_AHEAD = 5 * 60 * 1000;
// Scopes when the published list cannot be read: the everyday domains.
const FALLBACK_SCOPES = [
  "calendar:calendar:read",
  "calendar:calendar.event:read",
  "calendar:calendar.free_busy:read",
  "contact:user.base:readonly",
  "docx:document:readonly",
  "docx:document:create",
  "drive:drive.metadata:readonly",
  "drive:drive.search:readonly",
  "im:message:readonly",
  "im:chat:read",
  "search:docs:read",
  "task:task:read",
  "wiki:wiki:readonly",
];

type Setup = {
  phase: "app" | "user";
  device_code: string;
  url: string;
  interval: number;
  expires_at: number;
  next_poll_at: number;
};
type Value = {
  app?: { id: string; secret: string };
  user?: {
    open_id: string;
    name?: string;
    access_token: string;
    access_expires_at: number;
    refresh_token: string;
    refresh_expires_at: number;
    scope: string;
  };
  setup?: Setup;
  error?: string;
};
export type LarkConnectionStatus =
  | { phase: "none"; error?: string }
  | { phase: "app" | "user"; url: string; expires_at: number }
  | { phase: "connected"; name?: string; scope: string };

const form = (values: Record<string, string>) =>
  new URLSearchParams(values).toString();

export class LarkConnections {
  constructor(
    private env: Env,
    private owner: string,
    private fetcher: typeof fetch = edgeFetch,
    private now: () => number = Date.now,
  ) {}

  private async read() {
    const row = await this.env.DB.prepare(
      "SELECT revision,encrypted FROM lark_connections WHERE owner_id=?",
    )
      .bind(this.owner)
      .first<{ revision: number; encrypted: string }>();
    if (!row) return { revision: 0, value: {} as Value };
    return {
      revision: row.revision,
      value: (await unseal(
        this.env,
        purpose,
        this.owner,
        row.revision,
        row.encrypted,
      )) as Value,
    };
  }

  // Writes at the revision read; a concurrent change wins and is re-read.
  private async write(base: number, value: Value) {
    const revision = base + 1;
    const encrypted = await seal(
      this.env,
      purpose,
      this.owner,
      revision,
      value,
    );
    const result =
      base === 0
        ? await this.env.DB.prepare(
            "INSERT INTO lark_connections(owner_id,revision,encrypted,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner_id) DO NOTHING",
          )
            .bind(this.owner, revision, encrypted, this.now())
            .run()
        : await this.env.DB.prepare(
            "UPDATE lark_connections SET revision=?,encrypted=?,updated_at=? WHERE owner_id=? AND revision=?",
          )
            .bind(revision, encrypted, this.now(), this.owner, base)
            .run();
    return Boolean(result.meta.changes);
  }

  private async post(url: string, body: string, headers: HeadersInit) {
    const response = await this.fetcher(url, {
      method: "POST",
      headers,
      body,
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      /* Not JSON: reported below. */
    }
    return { ok: response.ok, data };
  }

  private async scopes() {
    try {
      const response = await this.fetcher(`${OPEN}/lark-cli/apis/scopes.json`);
      const file = (await response.json()) as {
        scopes?: Record<string, { user_scopes?: unknown }>;
      };
      const all = new Set<string>();
      for (const domain of Object.values(file.scopes ?? {}))
        for (const scope of Array.isArray(domain.user_scopes)
          ? domain.user_scopes
          : [])
          if (typeof scope === "string" && /^[\w:.-]{1,100}$/.test(scope))
            all.add(scope);
      if (all.size) return [...all];
    } catch {
      /* Fall back below. */
    }
    return FALLBACK_SCOPES;
  }

  private async beginApp(): Promise<Setup> {
    const { data } = await this.post(
      `${ACCOUNTS}/oauth/v1/app/registration`,
      form({
        action: "begin",
        archetype: "PersonalAgent",
        auth_method: "client_secret",
        request_user_info: "open_id tenant_brand",
      }),
      { "Content-Type": "application/x-www-form-urlencoded" },
    );
    return this.setup(
      "app",
      data,
      (code) =>
        `${OPEN}/page/cli?user_code=${encodeURIComponent(code)}&from=open-muse`,
    );
  }

  private async beginUser(app: NonNullable<Value["app"]>): Promise<Setup> {
    const scope = [...(await this.scopes()), "offline_access"].join(" ");
    const { data } = await this.post(
      `${ACCOUNTS}/oauth/v1/device_authorization`,
      form({ client_id: app.id, scope }),
      {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${app.id}:${app.secret}`)}`,
      },
    );
    return this.setup("user", data, () =>
      typeof data.verification_uri_complete === "string"
        ? data.verification_uri_complete
        : "",
    );
  }

  private setup(
    phase: Setup["phase"],
    data: Record<string, unknown>,
    url: (userCode: string) => string,
  ): Setup {
    const code = data.device_code;
    const userCode = data.user_code;
    if (typeof code !== "string" || typeof userCode !== "string")
      throw new HttpError(
        502,
        `Lark did not start ${phase === "app" ? "app setup" : "authorization"}: ${String(data.error_description ?? data.error ?? "no device code")}`.slice(
          0,
          300,
        ),
      );
    const link = url(userCode);
    if (!/^https:\/\/[\w.-]+\.(feishu\.cn|larkoffice\.com)\//.test(link))
      throw new HttpError(
        502,
        "Lark returned an unexpected authorization link.",
      );
    const interval = Math.min(30, Math.max(2, Number(data.interval) || 5));
    const expiresIn = Math.min(
      3600,
      Math.max(60, Number(data.expires_in ?? data.expire_in) || 600),
    );
    return {
      phase,
      device_code: code,
      url: link,
      interval,
      expires_at: this.now() + expiresIn * 1000,
      next_poll_at: this.now(),
    };
  }

  // Polls the pending step once; returns the value to store, or undefined
  // when nothing changed.
  private async advance(value: Value): Promise<Value | undefined> {
    const setup = value.setup!;
    if (this.now() >= setup.expires_at)
      return { ...value, setup: undefined, error: "expired" };
    if (this.now() < setup.next_poll_at) return undefined;
    const later = (extra = 0) => ({
      ...value,
      setup: {
        ...setup,
        interval: Math.min(30, setup.interval + extra),
        next_poll_at: this.now() + (setup.interval + extra) * 1000,
      },
    });
    if (setup.phase === "app") {
      const { data } = await this.post(
        `${ACCOUNTS}/oauth/v1/app/registration`,
        form({ action: "poll", device_code: setup.device_code }),
        { "Content-Type": "application/x-www-form-urlencoded" },
      );
      if (
        typeof data.client_id === "string" &&
        typeof data.client_secret === "string"
      ) {
        const brand = (data.user_info as { tenant_brand?: unknown } | undefined)
          ?.tenant_brand;
        if (brand && brand !== "feishu")
          return { ...value, setup: undefined, error: "unsupported_brand" };
        const app = { id: data.client_id, secret: data.client_secret };
        return { app, setup: await this.beginUser(app) };
      }
      return this.pending(value, data, later);
    }
    const app = value.app!;
    const { data } = await this.post(
      `${ACCOUNTS}/oauth/v3/token`,
      form({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: setup.device_code,
        client_id: app.id,
        client_secret: app.secret,
      }),
      { "Content-Type": "application/x-www-form-urlencoded" },
    );
    if (typeof data.access_token === "string") {
      const user = await this.tokens(data);
      const me = await this.userInfo(user.access_token);
      return {
        app,
        user: { ...user, open_id: me.open_id, name: me.name },
      };
    }
    return this.pending(value, data, later);
  }

  private pending(
    value: Value,
    data: Record<string, unknown>,
    later: (extra?: number) => Value,
  ): Value {
    const error = String(data.error ?? "");
    if (error === "authorization_pending" || error === "") return later();
    if (error === "slow_down") return later(5);
    return {
      ...value,
      setup: undefined,
      error: error === "access_denied" ? "denied" : "expired",
    };
  }

  private async tokens(data: Record<string, unknown>) {
    const access = String(data.access_token);
    const refresh =
      typeof data.refresh_token === "string" ? data.refresh_token : "";
    if (!refresh)
      throw new HttpError(502, "Lark did not grant offline access.");
    return {
      access_token: access,
      access_expires_at: this.now() + (Number(data.expires_in) || 7200) * 1000,
      refresh_token: refresh,
      refresh_expires_at:
        this.now() + (Number(data.refresh_token_expires_in) || 604800) * 1000,
      scope: typeof data.scope === "string" ? data.scope : "",
    };
  }

  private async userInfo(accessToken: string) {
    const response = await this.fetcher(
      `${OPEN}/open-apis/authen/v1/user_info`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const body = (await response.json()) as {
      data?: { open_id?: unknown; name?: unknown };
    };
    const openId = body.data?.open_id;
    if (typeof openId !== "string")
      throw new HttpError(502, "Lark did not return the signed-in user.");
    return {
      open_id: openId,
      name: typeof body.data?.name === "string" ? body.data.name : undefined,
    };
  }

  private publicStatus(value: Value): LarkConnectionStatus {
    if (value.setup)
      return {
        phase: value.setup.phase,
        url: value.setup.url,
        expires_at: value.setup.expires_at,
      };
    if (value.user && value.user.refresh_expires_at > this.now())
      return {
        phase: "connected",
        name: value.user.name,
        scope: value.user.scope,
      };
    return value.error
      ? { phase: "none", error: value.error }
      : { phase: "none" };
  }

  // The connection as the app shows it; a step in progress is polled once.
  async status(): Promise<LarkConnectionStatus> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { revision, value } = await this.read();
      if (!value.setup) return this.publicStatus(value);
      const next = await this.advance(value);
      if (!next) return this.publicStatus(value);
      if (await this.write(revision, next)) return this.publicStatus(next);
    }
    return this.publicStatus((await this.read()).value);
  }

  // Starts setup: authorization only when the app is already known, app
  // registration first otherwise. A connection that works is left alone.
  async start(): Promise<LarkConnectionStatus> {
    const { revision, value } = await this.read();
    if (value.setup && value.setup.expires_at > this.now())
      return this.publicStatus(value);
    if (value.user && value.user.refresh_expires_at > this.now() + RENEW_AHEAD)
      return this.publicStatus(value);
    const next: Value = value.app
      ? { app: value.app, setup: await this.beginUser(value.app) }
      : { setup: await this.beginApp() };
    if (!(await this.write(revision, next)))
      throw new HttpError(
        409,
        "Lark setup changed at the same time; try again.",
      );
    return this.publicStatus(next);
  }

  // Forgets the user token and any setup; the app is kept for next time.
  async disconnect(): Promise<LarkConnectionStatus> {
    const { revision, value } = await this.read();
    if (revision === 0) return { phase: "none" };
    const next: Value = value.app ? { app: value.app } : {};
    await this.write(revision, next);
    return { phase: "none" };
  }

  // A user access token for a sandbox, renewed when close to expiry.
  async sandboxToken() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { revision, value } = await this.read();
      const { app, user } = value;
      if (!app || !user || user.refresh_expires_at <= this.now())
        throw new HttpError(404, "Lark is not connected for this account.");
      if (user.access_expires_at - this.now() > RENEW_AHEAD)
        return {
          app_id: app.id,
          brand: "feishu",
          open_id: user.open_id,
          access_token: user.access_token,
          expires_at: user.access_expires_at,
        };
      const { data } = await this.post(
        `${ACCOUNTS}/oauth/v3/token`,
        JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: user.refresh_token,
          client_id: app.id,
          client_secret: app.secret,
        }),
        { "Content-Type": "application/json; charset=utf-8" },
      );
      if (typeof data.access_token !== "string") {
        // A refresh token Lark no longer accepts ends the connection.
        if (["invalid_grant", "expired_token"].includes(String(data.error)))
          await this.write(revision, { app, error: "expired" });
        throw new HttpError(502, "Lark did not renew the user token.");
      }
      const renewed = { ...user, ...(await this.tokens(data)) };
      await this.write(revision, { app, user: renewed });
    }
    throw new HttpError(409, "The Lark connection changed; try again.");
  }
}
