import { createHash, randomBytes } from "node:crypto";
import { Signer } from "@volcengine/openapi";
import { ApiError } from "./ark";

const signin = "https://signin.volcengine.com/authorize/oauth";
const clientID = "trn:signin:::devtools/cross-device";
const scope = "Console:All:All";
export interface Credentials {
  accessKeyId: string;
  secretKey: string;
  sessionToken: string;
  refreshToken: string;
  expiresAt: number;
  apiKey?: string;
  apiKeyId?: string;
  project?: string;
  agentId?: string;
  environmentId?: string;
}
export interface APIKeyCredentials {
  kind: "api_key";
  apiKey: string;
  project?: string;
}
export type LoginCredentials = Credentials | APIKeyCredentials;
export function isSSOCredentials(
  value: LoginCredentials,
): value is Credentials {
  return !("kind" in value && value.kind === "api_key");
}
export function beginLogin() {
  const state = randomBytes(24).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: clientID,
    scope,
    response_type: "code",
    state,
    redirect_uri: `${signin}/authorize`,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  return { state, verifier, url: `${signin}/authorize?${query}` };
}
export function extractCode(pasted: string, state: string) {
  const input = pasted.trim().replace(/^`|`$/g, "");
  let query: URLSearchParams | undefined;
  if (/^https?:\/\//.test(input)) {
    const url = new URL(input);
    if (
      url.origin !== "https://signin.volcengine.com" ||
      url.pathname !== "/authorize/oauth/authorize"
    )
      throw new ApiError(400, "Incorrect authorization callback URL.");
    query = url.searchParams;
  } else if (input.startsWith("code=")) query = new URLSearchParams(input);
  else {
    const decoded = Buffer.from(input, "base64url").toString("utf8");
    if (decoded.includes("code=")) query = new URLSearchParams(decoded);
  }
  if (query) {
    if (query.get("state") !== state)
      throw new ApiError(
        400,
        "Authorization state mismatch; please start the login over.",
      );
    const code = query.get("code");
    if (!code) throw new ApiError(400, "Authorization code is empty.");
    return code;
  }
  // Volcano also supports a bare authorization code; this form is bound to a single server-side transaction and the PKCE verifier.
  if (!input || input.length > 8192 || /\s/.test(input))
    throw new ApiError(400, "Invalid authorization code format.");
  return input;
}

export class OAuthProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  private async token(form: Record<string, string>): Promise<Credentials> {
    const response = await this.fetcher(`${signin}/token`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ client_id: clientID, ...form }),
    });
    if (!response.ok)
      throw new ApiError(
        401,
        "Volcano authorization failed or expired; please sign in again.",
      );
    const body = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    try {
      let sts = JSON.parse(body.access_token);
      if (typeof sts === "string") sts = JSON.parse(sts);
      sts = sts.data ?? sts;
      if (!sts.access_key_id || !sts.secret_access_key || !sts.session_token)
        throw new Error();
      return {
        accessKeyId: sts.access_key_id,
        secretKey: sts.secret_access_key,
        sessionToken: sts.session_token,
        refreshToken: body.refresh_token ?? "",
        expiresAt: Date.now() + (body.expires_in || 900) * 1000,
      };
    } catch {
      throw new ApiError(
        502,
        "The authorization response did not contain valid STS credentials.",
      );
    }
  }
  exchange(code: string, verifier: string) {
    return this.token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: `${signin}/authorize`,
    });
  }
  async refresh(credentials: Credentials) {
    if (credentials.expiresAt > Date.now() + 60_000) return;
    if (!credentials.refreshToken)
      throw new ApiError(401, "SSO login has expired; please sign in again.");
    const fresh = await this.token({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      scope,
    });
    Object.assign(credentials, fresh, {
      refreshToken: fresh.refreshToken || credentials.refreshToken,
    });
  }
  async action(
    credentials: Credentials,
    action: string,
    input: object,
    iam = false,
  ): Promise<Record<string, unknown>> {
    await this.refresh(credentials);
    const host = iam ? "iam.volcengineapi.com" : "open.volcengineapi.com";
    const params = {
      Action: action,
      Version: iam ? "2021-08-01" : "2024-01-01",
    };
    const body = JSON.stringify(input);
    const request = {
      region: iam ? "cn-north-1" : "cn-beijing",
      method: "POST",
      pathname: "/",
      params,
      headers: { Host: host, "Content-Type": "application/json" },
      body,
    };
    new Signer(request, iam ? "iam" : "ark").addAuthorization(credentials);
    const response = await this.fetcher(
      `https://${host}/?${new URLSearchParams(params)}`,
      {
        method: "POST",
        headers: request.headers,
        body,
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    const data = (await response.json()) as {
      ResponseMetadata?: { Error?: unknown };
      Result?: Record<string, unknown>;
    };
    if (!response.ok || data.ResponseMetadata?.Error)
      throw new ApiError(
        response.status === 429 ? 429 : 502,
        `${action} request failed; check project permissions or try again later.`,
      );
    // Some MA TOP list responses return Items/Data at the top level of the envelope.
    return data.Result ?? (data as Record<string, unknown>);
  }
  async projects(credentials: Credentials) {
    const names = new Set<string>();
    for (let offset = 0; offset <= 10000; offset += 100) {
      const data = await this.action(
        credentials,
        "ListProjects",
        { Limit: 100, Offset: offset },
        true,
      );
      const rows = (data.ProjectList ??
        data.Projects ??
        data.Items ??
        data.List ??
        []) as Record<string, unknown>[];
      for (const row of rows) {
        if (row.Status && !["active", "Active"].includes(String(row.Status)))
          continue;
        const name = row.ProjectName ?? row.Name;
        if (typeof name === "string") names.add(name);
      }
      if (rows.length < 100) return [...names];
    }
    throw new ApiError(
      502,
      "The project list is too long; ask an administrator to narrow the permission scope.",
    );
  }
  async mintKey(credentials: Credentials, project: string) {
    const created = await this.action(credentials, "CreateApiKey", {
      Name: `open-muse-${randomBytes(6).toString("hex")}`,
      ProjectName: project,
      ResourceInstances: [{ ResourceType: "all", ResourceId: "*" }],
      AccessControlInfo: { AllowAll: true },
      IPWhiteListInfo: { Enabled: false },
    });
    const id = created.Id ?? created.ID ?? created.ApiKeyId;
    if (!id)
      throw new ApiError(
        502,
        "The API Key creation result did not include an ID; check the Ark console and do not create it again.",
      );
    // Record the ID first so a GetRawApiKey failure can retry the read instead of creating a duplicate key.
    credentials.apiKeyId = String(id);
    credentials.project = project;
    await this.readKey(credentials);
  }
  async readKey(credentials: Credentials) {
    const id = credentials.apiKeyId!;
    const data = await this.action(credentials, "GetRawApiKey", {
      Id:
        /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : id,
      ProjectName: credentials.project,
    });
    const key =
      data.ApiKey ?? data.RawApiKey ?? data.api_key ?? data.Key ?? data.Secret;
    if (typeof key !== "string" || !key)
      throw new ApiError(
        502,
        "Could not read the newly created API Key; please try again later.",
      );
    credentials.apiKey = key;
  }
}
