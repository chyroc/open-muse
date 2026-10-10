import { useEffect, useRef, useState } from "react";
import { t } from "../shared/i18n";
import type { Client } from "./api";
import { backgroundClient, type BackgroundClient } from "./background-client";
import { exportText } from "./platform";

export interface ArkKeyStatus {
  ready: boolean;
  project?: string;
}

// A signed-in Open Muse account and what can be done with it: the Ark API key
// it keeps, exporting its data, signing out, and deleting it. Shared by the
// iPhone account page and the Mac settings. Removing things asks the system
// to confirm first; one action runs at a time.
export function useAccount({
  client,
  onChanged,
  onSignedOut,
  service = backgroundClient,
}: {
  client: Client;
  onChanged: () => void;
  // After a sign-out the account service confirmed.
  onSignedOut?: () => void;
  service?: BackgroundClient;
}) {
  const [status, setStatus] = useState<ArkKeyStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const owner = service.accountOwner();
  const email = service.accountEmail();
  const refresh = async () =>
    setStatus(await client.auth<ArkKeyStatus>("status"));
  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [client]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // Whatever happened at the service, the app must not keep running with the
  // previous account's key or workspace.
  async function switched() {
    try {
      await client.accountChanged();
    } finally {
      onChanged();
    }
  }
  // Saves a new key for the account; resolves whether it was saved.
  async function saveKey(apiKey: string) {
    let saved = false;
    await run(async () => {
      await client.auth("api-key", { apiKey: apiKey.trim(), confirm: true });
      saved = true;
      await refresh();
      onChanged();
    });
    return saved;
  }
  const signOut = () =>
    run(async () => {
      let revoked = false;
      try {
        revoked = (await service.signOutAccount()).revoked;
      } finally {
        await switched();
      }
      if (!revoked)
        setNotice(
          t(
            "Signed out on this device. The account service could not confirm ending the session; it expires on its own.",
          ),
        );
      else onSignedOut?.();
    });
  const removeKey = () => {
    if (
      !confirm(
        t(
          "Remove the key from my Open Muse account on all devices and stop background work that uses it. The key stays valid at Ark until you revoke it there.",
        ),
      )
    )
      return;
    void run(async () => {
      await client.auth("logout", { confirm: true });
      await refresh();
      onChanged();
    });
  };
  const deleteAccount = () => {
    if (
      !confirm(
        t(
          "Permanently delete my Open Muse account with its saved Ark API key, workspace settings, devices, background work, and reminder delivery. Conversations, memory, and the agent stay in your Ark account. This cannot be undone.",
        ),
      )
    )
      return;
    void run(async () => {
      await service.deleteAccount();
      await switched();
      setNotice(t("Your Open Muse account was deleted."));
    });
  };
  const exportData = () =>
    run(async () => {
      const data = await service.exportAccount();
      const day = new Date(data.exportedAt).toISOString().slice(0, 10);
      setNotice(
        await exportText(
          `open-muse-account-${day}.json`,
          JSON.stringify(data, null, 2),
          {
            saved: t("Your data was saved"),
            dialogTitle: t("Export my data"),
            downloaded: t("Your data download started"),
            type: "application/json;charset=utf-8",
          },
        ),
      );
    });
  return {
    status,
    // Reads the key's status again, for a caller that learns the login
    // settled after this first asked.
    refresh,
    owner,
    email,
    busy,
    error,
    notice,
    saveKey,
    signOut,
    removeKey,
    deleteAccount,
    exportData,
  };
}

// The account ID as shown to the person, without its internal prefix.
export const shownAccountId = (owner: string) =>
  owner.slice("muse_user_".length);
