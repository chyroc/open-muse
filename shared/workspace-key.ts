import { digest } from "./crypto";

export const ARK_API_BASE = "https://ark.cn-beijing.volces.com/api/v3";

// Scopes an account's MA agent, environment, memory store, and local records.
// The verified account owner is part of the key, so accounts sharing one Ark
// key never adopt each other's resources. The Worker recomputes the same value
// from the stored credential to check resource ownership metadata.
export function accountWorkspaceKey(
  apiKey: string,
  project: string,
  owner: string,
) {
  return digest(
    JSON.stringify([ARK_API_BASE, apiKey, project, "muse-account", owner]),
  );
}
