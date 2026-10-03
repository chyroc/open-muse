import { digest } from "../../shared/crypto";
import { accountWorkspaceKey } from "../../shared/workspace-key";
import type { Client } from "../../src/api";
import { MA, MA_BASE_URL } from "../../src/direct/transport";

// The identity scope of this Mac's own local records: the same one the shared
// client uses. In account builds the verified account owner is part of it, so
// accounts sharing one Ark key never see each other's records. Records saved
// before an account signed in keep their old scope and are not attributed to it.
export function macOwner(client: Client) {
  const credentials = client.identity.value;
  if (!credentials) return "disconnected";
  const account = client.identity.accountOwner?.();
  return account
    ? accountWorkspaceKey(
        credentials.apiKey ?? "",
        credentials.project ?? "",
        account,
        MA,
      )
    : digest(
        JSON.stringify([
          MA_BASE_URL,
          credentials.apiKey,
          credentials.project ?? "",
        ]),
      );
}
