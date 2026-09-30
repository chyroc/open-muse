import { t } from "../shared/i18n";
import { LoaderCircle } from "lucide-react";
import type { WelcomeState } from "./direct/welcome";

export function WelcomeStatus({
  state,
  busy,
  error,
  onCheck,
}: {
  state?: WelcomeState;
  busy: boolean;
  error: string;
  onCheck: () => void;
}) {
  if (
    !busy &&
    !error &&
    (!state || ["confirmed", "skipped"].includes(state.phase))
  )
    return null;
  const unconfirmed =
    state?.phase === "unconfirmed" || state?.phase === "sending";
  return (
    <div
      className={
        error || unconfirmed || state?.phase === "rejected"
          ? "inline-error"
          : "chat-loading"
      }
      role={error ? "alert" : "status"}
    >
      {busy ? (
        <>
          <LoaderCircle size={22} className="spin" />
          <span>{t("Preparing your companion…")}</span>
        </>
      ) : (
        <>
          <p>
            {error ||
              (unconfirmed
                ? t(
                    "The welcome request is unconfirmed. Check history; it will not be sent again.",
                  )
                : state?.phase === "rejected"
                  ? t(
                      "The welcome request was not accepted. You can try again.",
                    )
                  : t(
                      "First-conversation setup was interrupted. Continue to verify the existing resources.",
                    ))}
          </p>
          <button onClick={onCheck}>
            {unconfirmed ? t("Check welcome status") : t("Continue welcome")}
          </button>
        </>
      )}
    </div>
  );
}
