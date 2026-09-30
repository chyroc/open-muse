import type { Client } from "../../src/api";

export const connectionReady = "muse-connection-ready";

// Restoring the Keychain login can wait on an OS authorization dialog, and the
// user may deny it. Neither case may hold the workspace or the settings window
// hostage, and neither writes to secure storage: a failed read only clears the
// in-memory value, so the saved credential survives a cancelled dialog.
export function restoreInBackground(client: Client) {
  return client
    .restore()
    .then(() => "")
    .catch((error: Error) => error.message || "Could not restore the login")
    .then((error) => {
      window.dispatchEvent(new CustomEvent(connectionReady, { detail: error }));
      return error;
    });
}

export function connectionError(event: Event) {
  const detail = (event as CustomEvent).detail;
  return typeof detail === "string" ? detail : "";
}
