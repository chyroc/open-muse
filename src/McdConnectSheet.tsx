import { useEffect, useRef, type ReactNode } from "react";
import { Beef, Hand, ShieldCheck, SquareCheck } from "lucide-react";
import { t } from "../shared/i18n";
import { ContinuousSurface } from "./ContinuousSurface";
import { animateAway, useDragToDismiss } from "./gesture";
import "./health-connect.css";

// What connecting McDonald's means, shown before the sign-in page opens. The
// person signs in on McDonald's own page with their phone number and the code
// it texts; the app keeps the resulting token on this device and gives it to
// your MA agent so it can order, find restaurants, and check coupons.
export function McdConnectSheet({
  name,
  onContinue,
  onClose,
}: {
  name: string;
  // Opens McDonald's sign-in page; resolves true once connected.
  onContinue: () => Promise<boolean>;
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
  const titleId = "mcd-connect";
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
            style={{ color: "#ffc72c" }}
          >
            <Beef size={30} strokeWidth={2} />
          </span>
          <h2 id={titleId}>{t("McDonald's")}</h2>
          <p>{t("Order and manage McDonald's from your chat")}</p>
        </div>
        <ul className="health-connect-rows">
          {row(
            <SquareCheck size={22} strokeWidth={2} />,
            t("Sign in on McDonald's page"),
            t(
              "Enter your phone number and the code McDonald's texts you. The sign-in happens on McDonald's own page.",
            ),
          )}
          {row(
            <Hand size={22} strokeWidth={2} />,
            t("Ask in chat"),
            t(
              "{name} can then order food, find nearby restaurants, collect coupons and check points when you ask.",
              { name },
            ),
          )}
          {row(
            <ShieldCheck size={22} strokeWidth={2} />,
            t("You confirm what matters"),
            t(
              "Orders and other changes are confirmed in the chat before they happen.",
            ),
          )}
        </ul>
        <p className="health-connect-note">
          {t(
            "Your McDonald's access token is kept on this iPhone and given to your MA agent so it can reach McDonald's for you.",
          )}
        </p>
        <button
          type="button"
          className="health-connect-continue"
          onClick={() => dismiss(() => void onContinue())}
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
