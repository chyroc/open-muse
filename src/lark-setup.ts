import { useEffect, useState } from "react";
import { t } from "../shared/i18n";
import type { BackgroundClient, LarkConnection } from "./background-client";

// How often a step in progress is checked while setup is on screen.
const POLL_MS = 3000;

export type LarkSetupService = Pick<
  BackgroundClient,
  "larkConnection" | "startLarkConnection"
>;

// Connecting Lark through the Open Muse service, shared by the iPhone sheet
// and the Mac settings: starts (or resumes) setup, then follows it, checking
// every few seconds and as soon as the person comes back from the Lark page,
// until Lark confirms. `retry` starts again after a failure.
export function useLarkSetup(
  service: LarkSetupService,
  onConnected: (
    status: Extract<LarkConnection, { phase: "connected" }>,
  ) => void,
) {
  const [status, setStatus] = useState<LarkConnection>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (next: LarkConnection) => {
      if (!active) return;
      // A check that failed earlier is superseded by this answer.
      setError("");
      setStatus(next);
      if (next.phase === "connected") onConnected(next);
      else if (next.phase !== "none") timer = setTimeout(poll, POLL_MS);
    };
    const fail = (reason: Error) => active && setError(reason.message);
    const poll = () => void service.larkConnection().then(show, fail);
    // Back from the Lark page: check at once.
    const back = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      poll();
    };
    setError("");
    setStatus(undefined);
    void service.startLarkConnection().then(show, fail);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [attempt]);
  const phase = status?.phase;
  const failed =
    phase === "none"
      ? status?.error === "denied"
        ? t("Lark authorization was declined.")
        : status?.error === "unsupported_brand"
          ? t("Only Feishu accounts can be connected here.")
          : t("The Lark page expired before setup finished.")
      : "";
  // Where each of the two steps stands.
  const step = (which: "app" | "user") =>
    phase === "connected" || (which === "app" && phase === "user")
      ? ("done" as const)
      : phase === which
        ? ("active" as const)
        : undefined;
  return {
    status,
    error: error || failed,
    step,
    retry: () => setAttempt((value) => value + 1),
  };
}
