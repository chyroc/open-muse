import { useEffect, useState } from "react";
import { MessageCircleHeart } from "lucide-react";
import { t } from "../shared/i18n";
import type { Client } from "./api";

// Device-local preference for app-initiated check-ins in the main chat.
export function CheckInSettings({ client }: { client: Client }) {
  const signedIn = client.signedIn();
  const [enabled, setEnabled] = useState<boolean>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    void client
      .checkInState()
      .then((state) => {
        if (active) setEnabled(state.enabled);
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [client, signedIn]);
  if (!signedIn) return null;
  return (
    <section
      className="settings-card checkin-panel"
      aria-label={t("Check-ins")}
    >
      <div className="settings-card-heading">
        <div className="settings-symbol">
          <MessageCircleHeart size={21} />
        </div>
        <div>
          <h2>{t("Check-ins")}</h2>
          <p>{t("Your companion can start the conversation")}</p>
        </div>
      </div>
      <label className="background-toggle">
        <input
          type="checkbox"
          checked={enabled ?? false}
          disabled={enabled === undefined}
          onChange={(event) => {
            const next = event.target.checked;
            setEnabled(next);
            setError("");
            void client.setCheckIn(next).catch((error: Error) => {
              setEnabled(!next);
              setError(error.message);
            });
          }}
        />
        {t("Ask me something when I come back")}
      </label>
      <p className="background-note">
        {t(
          "After a quiet day, opening the main chat may start one short question based on your memory and goals. At most once a day, only while the app is open. Each check-in is a real Ark request and may be billed.",
        )}
      </p>
      {error && (
        <p className="background-note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
