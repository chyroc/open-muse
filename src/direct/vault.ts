import { z } from "zod";
import { t } from "../../shared/i18n";
import { ApiError, type ArkClient } from "../../shared/ark";
import {
  MCD_CONNECTOR_KEY,
  MCD_CONNECTOR_VALUE,
  MCD_CREDENTIAL_NAME,
  MCD_MCP_URL,
  isMcdCredential,
} from "../../shared/mcd";
import type { LocalDatabase } from "./storage";

// Secure storage: one MA vault per personal workspace, holding secrets that
// MA injects into the agent's environment. Values go to MA once and are never
// read back. Conversations get the vault only when they are created.
type VaultRow = { vault_id?: string; pending?: boolean };
const vaultName = "Open Muse secure storage";
const secretName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$|^\d{1,3}(\.\d{1,3}){3}$/);
export const secureCredentialInput = z
  .object({
    name: secretName,
    value: z.string().min(1).max(4096),
    hosts: z.array(host).max(16).default([]),
  })
  .strict();
export type SecureCredentialInput = z.input<typeof secureCredentialInput>;
export type SecureCredential = {
  id: string;
  name: string;
  hosts: string[];
  created_at?: string;
};
type Remote = {
  id: string;
  display_name?: string;
  created_at?: string;
  metadata?: Record<string, string>;
  auth?: {
    type?: string;
    secret_name?: string;
    networking?: { type?: string; allowed_hosts?: string[] };
  };
};

export class DirectVault {
  private key: string;
  constructor(
    private ark: ArkClient,
    private db: LocalDatabase,
    private owner: string,
  ) {
    this.key = `${owner}:vault`;
  }
  private row() {
    return this.db.get<VaultRow>(this.key);
  }
  // The vault, if this workspace already has one. Never creates it.
  async existing() {
    return (await this.row())?.vault_id;
  }
  private async find() {
    const page = await this.ark.request<{ data?: Remote[] }>(
      "/vaults?limit=100",
    );
    return (page.data ?? []).find(
      (vault) => vault.metadata?.open_muse_workspace === this.owner,
    )?.id;
  }
  // An uncertain creation is settled by listing, never by creating again
  // blindly: a vault that exists is adopted, and only a confirmed absence
  // allows another create.
  private async ensure() {
    const stored = await this.existing();
    if (stored) return stored;
    const found = await this.find();
    if (found) {
      await this.db.set<VaultRow>(this.key, { vault_id: found });
      return found;
    }
    await this.db.set<VaultRow>(this.key, { pending: true });
    const created = await this.ark.request<Remote>("/vaults", {
      method: "POST",
      body: JSON.stringify({
        display_name: vaultName,
        metadata: { open_muse_workspace: this.owner },
      }),
    });
    if (!created.id || !/^[\w-]{1,200}$/.test(created.id))
      throw new ApiError(502, t("Ark did not return a vault ID."));
    await this.db.set<VaultRow>(this.key, { vault_id: created.id });
    return created.id;
  }
  async list(): Promise<SecureCredential[]> {
    const vault = (await this.existing()) ?? (await this.find());
    if (!vault) return [];
    await this.db.set<VaultRow>(this.key, { vault_id: vault });
    const page = await this.ark.request<{ data?: Remote[] }>(
      `/vaults/${encodeURIComponent(vault)}/credentials?limit=100`,
    );
    return (page.data ?? [])
      .filter((item) => item.auth?.type === "environment_variable")
      .map((item) => ({
        id: item.id,
        name: item.auth?.secret_name ?? item.display_name ?? "",
        hosts: item.auth?.networking?.allowed_hosts ?? [],
        created_at: item.created_at,
      }));
  }
  async add(input: SecureCredentialInput) {
    const value = secureCredentialInput.parse(input);
    const vault = await this.ensure();
    await this.ark.request(`/vaults/${encodeURIComponent(vault)}/credentials`, {
      method: "POST",
      body: JSON.stringify({
        display_name: value.name,
        auth: {
          type: "environment_variable",
          secret_name: value.name,
          secret_value: value.value,
          networking: value.hosts.length
            ? { type: "limited", allowed_hosts: value.hosts }
            : { type: "unrestricted" },
        },
      }),
    });
    return this.list();
  }
  async remove(id: string) {
    const vault = await this.existing();
    if (!vault || !/^[\w-]{1,200}$/.test(id)) return this.list();
    await this.ark.request(
      `/vaults/${encodeURIComponent(vault)}/credentials/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return this.list();
  }
  // The remote MCP connection the person set up, as a static-bearer credential
  // in the same workspace vault. Because the vault is attached to every new
  // conversation, its MCP tools become available there automatically. The
  // bearer token goes to MA once and is never read back.
  private async mcdCredential() {
    const vault = (await this.existing()) ?? (await this.find());
    if (!vault) return undefined;
    await this.db.set<VaultRow>(this.key, { vault_id: vault });
    const page = await this.ark.request<{ data?: Remote[] }>(
      `/vaults/${encodeURIComponent(vault)}/credentials?limit=100`,
    );
    return (page.data ?? []).find(isMcdCredential);
  }
  async hasMcd() {
    return Boolean(await this.mcdCredential());
  }
  async addMcd(token: string) {
    const value = z.string().trim().min(1).max(4096).parse(token);
    const vault = await this.ensure();
    // Only one connection: replace an existing one so the token stays current.
    const current = await this.mcdCredential();
    if (current?.id)
      await this.ark.request(
        `/vaults/${encodeURIComponent(vault)}/credentials/${encodeURIComponent(current.id)}`,
        { method: "DELETE" },
      );
    await this.ark.request(`/vaults/${encodeURIComponent(vault)}/credentials`, {
      method: "POST",
      body: JSON.stringify({
        display_name: MCD_CREDENTIAL_NAME,
        metadata: { [MCD_CONNECTOR_KEY]: MCD_CONNECTOR_VALUE },
        auth: {
          type: "static_bearer",
          mcp_server_url: MCD_MCP_URL,
          token: value,
        },
      }),
    });
  }
  async removeMcd() {
    const vault = await this.existing();
    const current = await this.mcdCredential();
    if (!vault || !current?.id) return;
    await this.ark.request(
      `/vaults/${encodeURIComponent(vault)}/credentials/${encodeURIComponent(current.id)}`,
      { method: "DELETE" },
    );
  }
}
