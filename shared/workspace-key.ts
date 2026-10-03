import { digest } from "./crypto";
import { arkProvider, type MAProvider } from "./ma-provider";

// Scopes an account's MA agent, environment, memory store, and local records.
// The verified account owner is part of the key, so accounts sharing one Ark
// key never adopt each other's resources. The Worker recomputes the same value
// from the stored credential to check resource ownership metadata.
export function accountWorkspaceKey(
  apiKey: string,
  project: string,
  owner: string,
  // Part of the key, so one key on two backends never shares a workspace.
  provider: MAProvider = arkProvider,
) {
  return digest(
    JSON.stringify([provider.baseUrl, apiKey, project, "muse-account", owner]),
  );
}
