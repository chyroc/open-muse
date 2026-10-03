import { useEffect, useState } from "react";
import { t } from "../shared/i18n";
import type { UpcomingDelivery } from "../shared/upcoming";
import type { Client } from "./api";

export type ClosedFollowUp = "checkins" | "goal_followups";

// Check-ins and goal follow-ups the Open Muse service sends while the apps
// are closed. They are account settings, off by default, and offered only
// once the account delivers reminders while closed.
export function useClosedFollowUps(client: Client) {
  const supported = client.upcomingDeliverySupported();
  const [delivery, setDelivery] = useState<UpcomingDelivery>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supported) return;
    let active = true;
    void client
      .upcomingDelivery()
      .then((value) => {
        if (active) setDelivery(value);
      })
      .catch(() => {
        // Without the service's answer, the switches stay hidden.
      });
    return () => {
      active = false;
    };
  }, [client, supported]);
  const set = (kind: ClosedFollowUp, value: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    void client
      .setClosedFollowUps({ [kind]: value })
      .then(setDelivery)
      .catch((failure: Error) => setError(failure.message))
      .finally(() => setBusy(false));
  };
  return {
    visible: Boolean(supported && delivery?.enabled),
    checkins: Boolean(delivery?.checkins),
    goals: Boolean(delivery?.goal_followups),
    busy,
    error,
    set,
  };
}

export const closedFollowUpCopy = () => ({
  checkins: t("Check in even when Open Muse is closed"),
  checkinsDetail: t(
    "The Open Muse service may start the day's check-in in your main chat while every app is closed, with the same quiet hours and limits, in your time zone. Each one is a real Ark request with your saved key and may be billed.",
  ),
  goals: t("Follow up on goals"),
  goalsDetail: t(
    "When an active goal has had no progress for a week, the service may ask about it in your main chat, at most once every three days and in place of that day's check-in. Each follow-up is a real Ark request and may be billed.",
  ),
});

// The iPhone settings rows, below the check-in switch.
export function ClosedFollowUpSwitches({ client }: { client: Client }) {
  const state = useClosedFollowUps(client);
  if (!state.visible) return null;
  const copy = closedFollowUpCopy();
  const row = (
    kind: ClosedFollowUp,
    label: string,
    detail: string,
    checked: boolean,
  ) => (
    <>
      <label className="settings-switch-row">
        <span>{label}</span>
        <input
          type="checkbox"
          role="switch"
          className="ios-switch"
          checked={checked}
          disabled={state.busy}
          onChange={(event) => state.set(kind, event.target.checked)}
        />
      </label>
      <p className="settings-footnote">{detail}</p>
    </>
  );
  return (
    <div className="settings-switch-section">
      {row("checkins", copy.checkins, copy.checkinsDetail, state.checkins)}
      {row("goal_followups", copy.goals, copy.goalsDetail, state.goals)}
      {state.error && (
        <p className="settings-footnote" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
