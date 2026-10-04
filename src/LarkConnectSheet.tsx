import { useEffect, useRef, type ReactNode } from "react";
import {
  AppWindow,
  KeyRound,
  LoaderCircle,
  MessagesSquare,
  ShieldCheck,
} from "lucide-react";
import { t } from "../shared/i18n";
import type { LarkConnection } from "./background-client";
import { useLarkSetup, type LarkSetupService } from "./lark-setup";
import { ContinuousSurface } from "./ContinuousSurface";
import { animateAway, useDragToDismiss } from "./gesture";
import "./health-connect.css";

// Connecting Lark, in the same floating sheet as the other connectors. The
// Open Muse service sets the connection up: first the Lark app the assistant
// uses (created on a Lark page, or one the person already has), then the
// person's own authorization. Each step finishes on a Lark page the person
// opens from here; the sheet follows along and closes the loop once Lark
// confirms. The assistant's cloud environment then works as the person.
export function LarkConnectSheet({
  name,
  service,
  onConnected,
  onClose,
}: {
  name: string;
  service: LarkSetupService;
  onConnected: (
    status: Extract<LarkConnection, { phase: "connected" }>,
  ) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const { status, error, step, retry } = useLarkSetup(service, onConnected);
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
  const row = (
    icon: ReactNode,
    title: string,
    detail: string,
    state?: "active" | "done",
  ) => (
    <li data-state={state}>
      <span className="health-connect-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </li>
  );
  const phase = status?.phase;
  const stepState = step;
  return (
    <dialog
      ref={dialog}
      className="health-connect lark-connect"
      tabIndex={-1}
      aria-labelledby="lark-connect-title"
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
            style={{ color: "#3370ff" }}
          >
            <MessagesSquare size={30} strokeWidth={2} />
          </span>
          <h2 id="lark-connect-title">{t("Lark")}</h2>
          <p>{t("Let {name} work in your Lark account", { name })}</p>
        </div>
        <ul className="health-connect-rows">
          {row(
            <AppWindow size={22} strokeWidth={2} />,
            t("Choose the Lark app"),
            t(
              "Lark opens to create the app {name} uses, or to pick one you already have.",
              { name },
            ),
            stepState("app"),
          )}
          {row(
            <KeyRound size={22} strokeWidth={2} />,
            t("Approve your access"),
            t("Then approve what {name} can do in Lark as you.", { name }),
            stepState("user"),
          )}
          {row(
            <ShieldCheck size={22} strokeWidth={2} />,
            t("Kept with your account"),
            t(
              "Your assistant's cloud environment only receives a short-lived token. Disconnect at any time in Connectors.",
            ),
          )}
        </ul>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {phase === "app" || phase === "user" ? (
          <a
            className="health-connect-continue"
            href={status!.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {phase === "app"
              ? t("Open Lark to choose the app")
              : t("Open Lark to approve")}
          </a>
        ) : phase === "connected" ? (
          <button
            type="button"
            className="health-connect-continue"
            onClick={() => dismiss()}
          >
            {t("Close")}
          </button>
        ) : error ? (
          <button
            type="button"
            className="health-connect-continue"
            onClick={retry}
          >
            {t("Try again")}
          </button>
        ) : (
          <button type="button" className="health-connect-continue" disabled>
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
            <span>{t("Preparing…")}</span>
          </button>
        )}
        {(phase === "app" || phase === "user") && (
          <p className="health-connect-note" aria-live="polite">
            {t("Come back here when Lark says you're done.")}
          </p>
        )}
        {status?.phase === "connected" ? (
          <p className="health-connect-note" aria-live="polite">
            {status.name
              ? t("Connected as {name}.", { name: status.name })
              : t("Connected.")}
          </p>
        ) : (
          <button
            type="button"
            className="health-connect-cancel"
            onClick={() => dismiss()}
          >
            {t("Cancel")}
          </button>
        )}
      </div>
    </dialog>
  );
}
