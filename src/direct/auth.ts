import { t } from "../../shared/i18n";
import { z } from "zod";
import { ArkClient, ApiError } from "../../shared/ark";
import type {
  AccountCredential,
  AccountCredentialResponse,
} from "../../shared/account-credential";
import type {
  AccountWorkspaceComparison,
  AccountWorkspaceResponse,
} from "../../shared/account-workspace";
import type { UpcomingDelivery } from "../../shared/upcoming";
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
// Earlier releases could also save a Volcano SSO session. Sign-in is API-key
// only now: such a record is kept untouched on this device but is never used.
function retiredSSO(value: unknown) {
  if (typeof value !== "object" || value === null) return false;
  const { accessKeyId, secretKey, sessionToken } = value as Record<
    string,
    unknown
  >;
  return (
    typeof accessKeyId === "string" &&
    typeof secretKey === "string" &&
    typeof sessionToken === "string"
  );
}
export type APIKeyLogin = z.infer<typeof apiKeyLogin> & {
  // Set for keys stored in an Open Muse account: the verified owner and the stored
  // credential revision they were read at.
  owner?: string;
  revision?: number;
};
// The signed-in Open Muse account, its server-side Ark credential, and the
// workspace the service created for it.
export interface AccountProvider {
  accountConfigured(): boolean;
  // Service delivery of Upcoming reminders; absent where it is unsupported.
  upcomingDelivery?(): Promise<UpcomingDelivery>;
  saveUpcomingDelivery?(input: {
    session_id: string;
    language: "en" | "zh-CN";
    enabled: boolean;
    revision: number;
  }): Promise<UpcomingDelivery>;
  accountOwner(): string | undefined;
  restore(): Promise<void>;
  accountCredential(): Promise<AccountCredentialResponse>;
  saveAccountCredential(
    credential: AccountCredential,
    revision: number,
  ): Promise<{ revision: number }>;
  removeAccountCredential(revision: number): Promise<{ revision: number }>;
  accountWorkspace(): Promise<AccountWorkspaceResponse>;
  provisionAccountWorkspace(
    credentialRevision: number,
    replaceUnconfirmed?: boolean,
    resetSettings?: boolean,
  ): Promise<AccountWorkspaceResponse>;
  reconcileAccountWorkspace(
    revision: number,
    credentialRevision: number,
    mode?: "adopt" | "discard",
    expected?: string,
  ): Promise<AccountWorkspaceResponse>;
  compareAccountWorkspace(
    revision: number,
    credentialRevision: number,
  ): Promise<AccountWorkspaceComparison>;
  updateAccountWorkspace(
    kind: "agent" | "environment",
    changes: Record<string, unknown>,
    revision: number,
    credentialRevision: number,
  ): Promise<AccountWorkspaceResponse>;
}

export class DirectAuth {
  value?: APIKeyLogin;
  private revision = 0;
  private owner?: string;
  private busy = false;
  constructor(
    private vault: CredentialStore = defaultVault,
    private fetcher: typeof fetch = directFetch,
    readonly account?: AccountProvider,
  ) {}
  // Builds configured with an Open Muse account service use the account as the
  // user's identity; the Ark key is only the model-service credential.
  accountMode() {
    return Boolean(this.account?.accountConfigured());
  }
  accountOwner() {
    return this.accountMode() ? this.account!.accountOwner() : undefined;
  }
  // The account and credential revision the current value was read for.
  syncedOwner() {
    return this.owner;
  }
  storedRevision() {
    return this.revision;
  }
  async restore() {
    const raw = await this.vault.read();
    this.value = undefined;
    if (raw) {
      const saved = JSON.parse(raw);
      const login = apiKeyLogin.safeParse(saved);
      // In account builds the key comes from the account. A key saved on this
      // device by a local build is left untouched and never used.
      if (login.success) {
        if (!this.accountMode()) this.value = login.data;
      } else if (!retiredSSO(saved))
        throw new Error(
          t(
            "Saved login is invalid. Clear this app's credentials and sign in again.",
          ),
        );
    }
    if (this.accountMode()) await this.sync();
  }
  // Reads the signed-in account's key from the service. Called on launch and
  // whenever the account changes; nothing is kept for a signed-out account.
  async sync() {
    this.value = undefined;
    this.revision = 0;
    this.owner = this.accountOwner();
    if (!this.owner) return;
    const owner = this.owner;
    const stored = await this.account!.accountCredential();
    if (this.accountOwner() !== owner)
      throw new ApiError(
        409,
        t("The Open Muse account changed. Reload before continuing."),
      );
    this.revision = stored.revision;
    if (stored.credential)
      this.value = {
        kind: "api_key",
        ...stored.credential,
        owner,
        revision: stored.revision,
      };
  }
  status() {
    const c = this.value;
    return {
      loggedIn: Boolean(c),
      ready: Boolean(c),
      method: c ? ("api_key" as const) : undefined,
      project: c?.project,
      ...(this.accountMode()
        ? { account: { signedIn: Boolean(this.accountOwner()) } }
        : {}),
    };
  }
  private async save(value: APIKeyLogin | undefined) {
    await this.vault.write(value ? JSON.stringify(value) : "");
    this.value = value;
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
  // Validate access to MA itself. The inference /models endpoint has a
  // different CORS policy and must not gate browser or WebView sign-in.
  private async verify(credential: AccountCredential) {
    await new ArkClient(
      {
        arkBaseUrl: ARK_BASE_URL,
        arkKey: credential.apiKey,
        project: credential.project,
      },
      this.fetcher,
    ).request("/agents?limit=1");
  }
  private signedInOwner() {
    const owner = this.accountOwner();
    if (!owner || owner !== this.owner)
      throw new ApiError(401, t("Sign in to your Open Muse account first."));
    return owner;
  }
  // Stores the key in the signed-in account, replacing any earlier key. The
  // service revokes background access tied to the previous key.
  private async store(credential: AccountCredential) {
    const owner = this.signedInOwner();
    await this.verify(credential);
    const result = await this.account!.saveAccountCredential(
      credential,
      this.revision,
    );
    this.revision = result.revision;
    this.value = {
      kind: "api_key",
      ...credential,
      owner,
      revision: result.revision,
    };
    return { ready: true };
  }
  async execute(path: string, body: unknown = {}) {
    if (path === "status") return this.status();
    const confirmed = z.object({ confirm: z.literal(true) }).strict();
    return this.serial(async () => {
      if (this.accountMode()) {
        if (path === "logout") {
          confirmed.parse(body);
          this.signedInOwner();
          const result = await this.account!.removeAccountCredential(
            this.revision,
          );
          this.revision = result.revision;
          this.value = undefined;
          return { ok: true };
        }
      } else if (path === "logout") {
        await this.save(undefined);
        return { ok: true };
      }
      if (path !== "api-key")
        throw new ApiError(404, t("Unknown sign-in operation."));
      const input = z
        .object({
          apiKey,
          project: projectName.default(""),
          confirm: z.literal(true),
        })
        .strict()
        .parse(body);
      if (this.accountMode())
        return this.store({ apiKey: input.apiKey, project: input.project });
      if (this.value)
        throw new ApiError(
          409,
          t("Sign out before connecting another account."),
        );
      const value = {
        kind: "api_key" as const,
        apiKey: input.apiKey,
        project: input.project,
      };
      await this.verify(value);
      await this.save(value);
      return { ready: true };
    });
  }
}
