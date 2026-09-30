import { t } from "../../shared/i18n";
import { z } from "zod";
import { ArkClient, ApiError } from "../../shared/ark";
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
const apiKeyLogin = z.object({
  kind: z.literal("api_key"),
  apiKey,
  project: projectName.optional(),
});
// Earlier releases could also save a Volcano SSO session. Volcano SSO sign-in is
// no longer supported: such a record is kept untouched until the user removes
// it, and none of its credentials is ever used.
const legacySSO = z
  .object({
    accessKeyId: z.string().min(1),
    secretKey: z.string().min(1),
    sessionToken: z.string().min(1),
  })
  .passthrough();
export type APIKeyLogin = z.infer<typeof apiKeyLogin>;

export class DirectAuth {
  value?: APIKeyLogin;
  legacy?: "sso";
  private busy = false;
  constructor(
    private vault: CredentialStore = defaultVault,
    private fetcher: typeof fetch = directFetch,
  ) {}
  async restore() {
    const raw = await this.vault.read();
    this.value = this.legacy = undefined;
    if (!raw) return;
    const saved = JSON.parse(raw);
    const login = apiKeyLogin.safeParse(saved);
    if (login.success) this.value = login.data;
    else if (legacySSO.safeParse(saved).success) this.legacy = "sso";
    else
      throw new Error(
        t(
          "Saved login is invalid. Clear this app's credentials and sign in again.",
        ),
      );
  }
  status() {
    const c = this.value;
    return {
      loggedIn: Boolean(c),
      ready: Boolean(c),
      method: c ? ("api_key" as const) : undefined,
      project: c?.project,
      legacy: this.legacy,
    };
  }
  private async save(value: APIKeyLogin | undefined) {
    await this.vault.write(value ? JSON.stringify(value) : "");
    this.value = value;
    this.legacy = undefined;
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
        return { ok: true };
      }
      if (path !== "api-key")
        throw new ApiError(404, t("Unknown sign-in operation."));
      if (this.value)
        throw new ApiError(
          409,
          t("Sign out before connecting another account."),
        );
      if (this.legacy)
        throw new ApiError(
          409,
          t(
            "Remove the saved Volcano SSO sign-in before connecting with an API key.",
          ),
        );
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
    });
  }
}
