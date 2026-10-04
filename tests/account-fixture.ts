import type { AccountProvider } from "../src/direct/auth";
import type { AccountWorkspace } from "../shared/account-workspace";
import type { AccountCredential } from "../shared/account-credential";
import { MA } from "../src/direct/transport";
import { accountWorkspaceKey } from "../shared/workspace-key";
import {
  agentSpec,
  environmentSpec,
  memoryStoreName,
} from "../shared/workspace-spec";

// An Open Muse account for tests, kept in memory: a signed-in owner, the Ark
// key stored with the account, and the workspace the service creates for it.
// Like the service, it creates the agent, environment, and memory store in
// Ark (through the test's Ark stand-in) and applies agent and environment
// changes there, labelled with the account's workspace key.
export function testAccount(
  fetcher: typeof fetch,
  owner: string | undefined = "muse_user_test",
) {
  let current: string | undefined = owner;
  // One credential and workspace per owner, as the service keeps them.
  const credentials = new Map<
    string,
    { revision: number; credential?: AccountCredential }
  >();
  const workspaces = new Map<string, AccountWorkspace>();
  const ark = async <T>(path: string, init: RequestInit = {}) => {
    const stored = credentials.get(current!)!.credential!;
    const response = await fetcher(
      `https://ark.cn-beijing.volces.com/api/v3${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${stored.apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) throw new Error(`Ark ${path}: ${response.status}`);
    return (await response.json()) as T;
  };
  const signedIn = () => {
    if (!current) throw new Error("Sign in to your Open Muse account first.");
    return current;
  };
  const workspaceKey = () => {
    const stored = credentials.get(signedIn())?.credential;
    if (!stored) throw new Error("Add an Ark API key first.");
    return accountWorkspaceKey(stored.apiKey, stored.project, current!, MA);
  };
  const record = () => workspaces.get(workspaceKey());
  const account: AccountProvider = {
    accountConfigured: () => true,
    accountOwner: () => current,
    restore: async () => {},
    async accountCredential() {
      const stored = credentials.get(signedIn()) ?? { revision: 0 };
      return {
        configured: Boolean(stored.credential),
        revision: stored.revision,
        updatedAt: stored.credential ? 1 : null,
        ...(stored.credential ? { credential: stored.credential } : {}),
      };
    },
    async saveAccountCredential(credential) {
      const stored = credentials.get(signedIn()) ?? { revision: 0 };
      const next = { revision: stored.revision + 1, credential };
      credentials.set(current!, next);
      return { revision: next.revision };
    },
    async removeAccountCredential() {
      const stored = credentials.get(signedIn()) ?? { revision: 0 };
      credentials.set(current!, { revision: stored.revision + 1 });
      return { revision: stored.revision + 1 };
    },
    async accountWorkspace() {
      return { revision: 1, workspace: record(), unconfirmed: false };
    },
    async provisionAccountWorkspace() {
      const key = workspaceKey();
      let workspace = record();
      if (!workspace?.agentId) {
        const environment = await ark<{ id: string }>("/environments", {
          method: "POST",
          body: JSON.stringify({
            ...environmentSpec(),
            name: `open-muse-${key.slice(0, 18)}-environment`,
            metadata: { open_muse_workspace: key },
          }),
        });
        const agent = await ark<{ id: string }>("/agents", {
          method: "POST",
          body: JSON.stringify({
            ...agentSpec(MA.defaultModel, MA),
            name: `open-muse-${key.slice(0, 18)}-agent`,
            metadata: { open_muse_workspace: key },
          }),
        });
        const store = await ark<{ id: string }>("/memory_stores", {
          method: "POST",
          body: JSON.stringify({
            name: memoryStoreName,
            metadata: { open_muse_identity: key },
          }),
        });
        workspace = {
          agentId: agent.id,
          environmentId: environment.id,
          memoryStoreId: store.id,
          model: MA.defaultModel,
        };
        workspaces.set(key, workspace);
      }
      return { revision: 1, workspace, unconfirmed: false };
    },
    async updateAccountWorkspace(kind, changes) {
      const workspace = record()!;
      const id = kind === "agent" ? workspace.agentId : workspace.environmentId;
      await ark(`/${kind}s/${id}`, {
        method: "POST",
        body: JSON.stringify(changes),
      });
      return { revision: 1, workspace, unconfirmed: false };
    },
    async reconcileAccountWorkspace() {
      return { revision: 1, workspace: record(), unconfirmed: false };
    },
    async compareAccountWorkspace() {
      throw new Error("Nothing to compare in tests.");
    },
  };
  return {
    account,
    // Switches to another Open Muse account, or signs out with undefined.
    signIn(next: string | undefined) {
      current = next;
    },
  };
}
