import { useEffect, useRef, type ReactNode } from "react";
import { ChartColumnIncreasing, Eye, ToggleRight } from "lucide-react";
import { t } from "../shared/i18n";
import { ContinuousSurface } from "./ContinuousSurface";
import { animateAway, useDragToDismiss } from "./gesture";
import "./health-connect.css";

// The first time the companion asks for Health data, a floating sheet says
// what connecting Health means before the system's own permission sheet.
// Continue connects, so this and later requests are read without asking;
// Cancel leaves the request in the conversation to answer later.
export function HealthConnectSheet({
  name,
  onContinue,
  onClose,
}: {
  name: string;
  onContinue: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
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
  return (
    <dialog
      ref={dialog}
      className="health-connect"
      tabIndex={-1}
      aria-labelledby="health-connect-title"
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
          <span className="health-connect-app" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30">
              <defs>
                <linearGradient id="health-heart" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ff6b8f" />
                  <stop offset="1" stopColor="#ff2d55" />
                </linearGradient>
              </defs>
              <path
                fill="url(#health-heart)"
                d="M12 21.2 10.6 20C5.4 15.3 2 12.2 2 8.4 2 5.3 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1C13.2 3.8 14.9 3 16.6 3 19.6 3 22 5.3 22 8.4c0 3.8-3.4 6.9-8.6 11.6L12 21.2Z"
              />
            </svg>
          </span>
          <h2 id="health-connect-title">{t("Health")}</h2>
          <p>{t("Get insights from the Health data on your iPhone")}</p>
        </div>
        <ul className="health-connect-rows">
          {row(
            <ChartColumnIncreasing size={22} strokeWidth={2} />,
            t("Read only when you ask"),
            t(
              "When you ask about activity, workouts, sleep, heart rate or weight, {name} reads just that data from Health and shares a summary with your MA agent.",
              { name },
            ),
          )}
          {row(
            <ToggleRight size={22} strokeWidth={2} />,
            t("You choose what {name} can read", { name }),
            t(
              "Once connected, {name} reads Health when you ask, without asking each time. Change or turn off access in the Health app, or disconnect in Connectors.",
              { name },
            ),
          )}
          {row(
            <Eye size={22} strokeWidth={2} />,
            t("Keep an eye on it"),
            t(
              "{name} can make mistakes. Check anything about your health carefully.",
              { name },
            ),
          )}
        </ul>
        <p className="health-connect-note">
          {t(
            "Summaries you share become part of the conversation and are kept in your Ark account.",
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
