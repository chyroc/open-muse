import { t } from "../../shared/i18n";
import { z } from "zod";
import { ArkClient, ApiError } from "../../shared/ark";
import {
  beginLogin,
  extractCode,
  OAuthProvider,
  isSSOCredentials,
  type LoginCredentials,
  type Credentials,
} from "../../shared/oauth";
import { uuid } from "../../shared/crypto";
import { credentials as defaultVault, type CredentialStore } from "./storage";
import { ARK_BASE_URL, directFetch } from "./transport";

const projectName = z
  .string()
  .trim()
  .max(128)
  .regex(/^[^\r\n]*$/);
const apiKey = z
  .string()
  .trim()
  .min(16)
  .max(1024)
  .regex(/^[\x21-\x7e]+$/);
const stored = z.union([
  z.object({
    kind: z.literal("api_key"),
    apiKey,
    project: projectName.optional(),
  }),
  z.object({
    accessKeyId: z.string().min(1),
    secretKey: z.string().min(1),
    sessionToken: z.string().min(1),
    refreshToken: z.string(),
    expiresAt: z.number(),
    apiKey: apiKey.optional(),
    apiKeyId: z.string().optional(),
    project: projectName.optional(),
    keyCreationPending: z.boolean().optional(),
  }),
]);
export class DirectAuth {
  value?: LoginCredentials & { keyCreationPending?: boolean };
  private pending?: ReturnType<typeof beginLogin> & {
    transaction: string;
    expiresAt: number;
  };
  private busy = false;
  readonly provider: OAuthProvider;
  constructor(
    private vault: CredentialStore = defaultVault,
    private fetcher: typeof fetch = directFetch,
  ) {
    this.provider = new OAuthProvider(fetcher);
  }
  async restore() {
    const raw = await this.vault.read();
    if (!raw) {
      this.value = undefined;
      return;
    }
    const parsed = stored.safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw new Error(
        t(
          "Saved login is invalid. Clear this app's credentials and sign in again.",
        ),
      );
    this.value = parsed.data;
  }
  status() {
    const c = this.value;
    return {
      loggedIn: Boolean(c),
      ready: Boolean(c?.apiKey),
      method: c ? (isSSOCredentials(c) ? "sso" : "api_key") : undefined,
      project: c?.project,
      apiKeyId: c && isSSOCredentials(c) ? c.apiKeyId : undefined,
    };
  }
  private async save(value: typeof this.value) {
    await this.vault.write(value ? JSON.stringify(value) : "");
    this.value = value;
  }
  private sso(): Credentials {
    if (!this.value || !isSSOCredentials(this.value))
      throw new ApiError(
        401,
        t("This control-plane operation requires SSO sign-in."),
      );
    return this.value;
  }
  async action(action: string, body: object) {
    const c = this.sso();
    return this.serial(async () => {
      try {
        return await this.provider.action(c, action, body);
      } finally {
        await this.save(c);
      }
    });
  }
  private async serial<T>(fn: () => Promise<T>) {
    if (this.busy)
      throw new ApiError(
        409,
        t("A sign-in operation is already in progress. Please wait."),
      );
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  async execute(path: string, body: unknown = {}) {
    if (path === "status") return this.status();
    return this.serial(async () => {
      if (path === "logout") {
        await this.save(undefined);
        this.pending = undefined;
        return { ok: true };
      }
      if (path === "projects") {
        const c = this.sso();
        try {
          return { projects: await this.provider.projects(c) };
        } finally {
          await this.save(c);
        }
      }
      if (path === "project") {
        const { project } = z
          .object({ project: projectName.min(1), confirm: z.literal(true) })
          .strict()
          .parse(body);
        const c = this.sso() as Credentials & { keyCreationPending?: boolean };
        if (
          (c.apiKey || c.apiKeyId || c.keyCreationPending) &&
          c.project !== project
        )
          throw new ApiError(
            409,
            t("Sign out before switching to another project."),
          );
        try {
          if (c.apiKey) return { ready: true, project };
          if (c.apiKeyId) await this.provider.readKey(c);
          else {
            if (c.keyCreationPending)
              throw new ApiError(
                409,
                t(
                  "The previous key creation is unconfirmed. Check the Ark console; sign out and connect with the existing key instead of creating another one.",
                ),
              );
            if (!(await this.provider.projects(c)).includes(project))
              throw new ApiError(403, t("No access to the selected project."));
            c.project = project;
            c.keyCreationPending = true;
            await this.save(c);
            await this.provider.mintKey(c, project);
          }
          c.keyCreationPending = false;
          return { ready: true, project };
        } finally {
          await this.save(c);
        }
      }
      if (this.value)
        throw new ApiError(
          409,
          t("Sign out before connecting another account."),
        );
      if (path === "api-key") {
        const input = z
          .object({
            apiKey,
            project: projectName.default(""),
            confirm: z.literal(true),
          })
          .strict()
          .parse(body);
        const value = {
          kind: "api_key" as const,
          apiKey: input.apiKey,
          project: input.project,
        };
        // Validate access to MA itself. The inference /models endpoint has a
        // different CORS policy and must not gate browser or WebView sign-in.
        await new ArkClient(
          {
            arkBaseUrl: ARK_BASE_URL,
            arkKey: value.apiKey,
            project: value.project,
          },
          this.fetcher,
        ).request("/agents?limit=1");
        await this.save(value);
        return { ready: true };
      }
      if (path === "begin") {
        this.pending = {
          ...beginLogin(),
          transaction: uuid(),
          expiresAt: Date.now() + 600_000,
        };
        return {
          transaction: this.pending.transaction,
          authorizeUrl: this.pending.url,
          expiresIn: 600,
        };
      }
      if (path === "complete") {
        const input = z
          .object({
            transaction: z.string(),
            code: z.string().min(1).max(8192),
          })
          .strict()
          .parse(body);
        const pending = this.pending;
        if (
          !pending ||
          pending.transaction !== input.transaction ||
          pending.expiresAt < Date.now()
        )
          throw new ApiError(
            400,
            t("The authorization transaction expired. Start sign-in again."),
          );
        const code = extractCode(input.code, pending.state);
        this.pending = undefined;
        await this.save(await this.provider.exchange(code, pending.verifier));
        return { loggedIn: true };
      }
      throw new ApiError(404, t("Unknown sign-in operation."));
    });
  }
}
