import { useEffect, useRef, type ReactNode } from "react";
import {
  BookUser,
  CalendarDays,
  Hand,
  ListTodo,
  ShieldCheck,
  SquareCheck,
} from "lucide-react";
import { t } from "../shared/i18n";
import { onAndroid } from "./platform";
import type { IphoneSource } from "../shared/iphone-tools";
import { ContinuousSurface } from "./ContinuousSurface";
import { animateAway, useDragToDismiss } from "./gesture";
import "./health-connect.css";

const sources = {
  calendar: {
    Icon: CalendarDays,
    color: "#ff3b30",
    title: "Calendar",
    lead: "Plan around the schedule on your iPhone",
    androidLead: "Plan around the schedule on this phone",
    use: "When you ask about your schedule or free time, {name} asks to read just those events and shares them with your MA agent.",
  },
  reminders: {
    Icon: ListTodo,
    color: "#007aff",
    title: "Reminders",
    lead: "Keep track of the to-dos on your iPhone",
    androidLead: "Keep track of the to-dos on your iPhone",
    use: "When you ask about your to-dos, {name} asks to read your open reminders and shares them with your MA agent.",
  },
  contacts: {
    Icon: BookUser,
    color: "#8e8e93",
    title: "Contacts",
    lead: "Find the people you mention",
    androidLead: "Find the people you mention",
    use: "When you mention someone, {name} asks to look them up and shares only the matching names, numbers and emails with your MA agent.",
  },
} as const;

// What connecting Calendar, Reminders, or Contacts means, shown before the
// system's own permission prompt, in the same floating sheet as Health.
// Continue asks the system for access; every later read still asks the
// person.
export function PersonalConnectSheet({
  source,
  name,
  onContinue,
  onClose,
}: {
  source: IphoneSource;
  name: string;
  onContinue: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const copy = sources[source];
  const dismiss = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    dialog.current?.classList.add("closing");
    animateAway(dialog.current, "y", 1, () => {
      onClose();
      then?.();
    });
  };
  const drag = useDragToDismiss({
    target: dialog,
    axis: "y",
    direction: 1,
    onDismiss: () => dismiss(),
  });
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    element.showModal();
    element.focus({ preventScroll: true });
    return () => {
      element.close();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  const row = (icon: ReactNode, title: string, detail: string) => (
    <li>
      <span className="health-connect-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </li>
  );
  const titleId = `personal-connect-${source}`;
  return (
    <dialog
      ref={dialog}
      className="health-connect"
      tabIndex={-1}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dismiss();
      }}
    >
      <ContinuousSurface />
      <div className="health-connect-content">
        <div className="health-connect-top" {...drag}>
          <div className="health-connect-grip" aria-hidden="true" />
          <span
            className="health-connect-app"
            aria-hidden="true"
            style={{ color: copy.color }}
          >
            <copy.Icon size={30} strokeWidth={2} />
          </span>
          <h2 id={titleId}>{t(copy.title)}</h2>
          <p>{t(onAndroid() ? copy.androidLead : copy.lead)}</p>
        </div>
        <ul className="health-connect-rows">
          {row(
            <SquareCheck size={22} strokeWidth={2} />,
            t("Read only when you ask"),
            t(copy.use, { name }),
          )}
          {row(
            <Hand size={22} strokeWidth={2} />,
            t("You approve every read"),
            onAndroid()
              ? t(
                  "Each request shows in the chat first, and nothing is read until you tap Share. Change access in Android Settings at any time.",
                )
              : t(
                  "Each request shows in the chat first, and nothing is read until you tap Share. Change access in iOS Settings at any time.",
                ),
          )}
          {row(
            <ShieldCheck size={22} strokeWidth={2} />,
            t("Read only"),
            t("{name} never creates, changes or deletes anything here.", {
              name,
            }),
          )}
        </ul>
        <p className="health-connect-note">
          {t(
            "What you share becomes part of the conversation and is kept in your Ark account.",
          )}
        </p>
        <button
          type="button"
          className="health-connect-continue"
          onClick={() => dismiss(onContinue)}
        >
          {t("Continue")}
        </button>
        <button
          type="button"
          className="health-connect-cancel"
          onClick={() => dismiss()}
        >
          {t("Cancel")}
        </button>
      </div>
    </dialog>
  );
}
