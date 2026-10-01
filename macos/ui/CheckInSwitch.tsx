import { useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import type { Client } from "../../src/api";
import { Switch } from "./SettingsSwitch";

// Device-local preference for app-initiated check-ins in the main chat. Each
// one is a real Ark request, so the switch says so.
export function CheckInSwitch({ client }: { client: Client }) {
  const signedIn = client.signedIn();
  const [enabled, setEnabled] = useState<boolean>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    void client
      .checkInState()
      .then((state) => active && setEnabled(state.enabled))
      .catch((failure: Error) => active && setError(failure.message));
    return () => {
      active = false;
    };
  }, [client, signedIn]);
  if (!signedIn) return null;
  return (
    <>
      <div className="settings-group">
        <Switch
          label={t("Ask me something when I come back")}
          detail={t(
            "After a quiet day, opening the main chat may start one short question based on your memory and goals. At most once a day, only while the app is open. Each check-in is a real Ark request and may be billed.",
          )}
          checked={enabled ?? false}
          disabled={enabled === undefined}
          onChange={(next) => {
            setEnabled(next);
            setError("");
            void client.setCheckIn(next).catch((failure: Error) => {
              setEnabled(!next);
              setError(failure.message);
            });
          }}
        />
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
