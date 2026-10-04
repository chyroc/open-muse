import { useState } from "react";
import { AppWindow, KeyRound, LoaderCircle } from "lucide-react";
import { t } from "../../shared/i18n";
import type { LarkConnection } from "../../src/background-client";
import { useLarkSetup, type LarkSetupService } from "../../src/lark-setup";

// Connecting Lark in Settings > Connectors, the same two steps as on iPhone:
// the Open Muse service registers or picks the Lark app, then the person
// approves their own access; each step finishes on a Lark page that opens in
// the browser, and this panel follows along until Lark confirms.
export function LarkSetupPanel({
  name,
  service,
  onConnected,
  onCancel,
}: {
  name: string;
  service: LarkSetupService;
  onConnected: (
    status: Extract<LarkConnection, { phase: "connected" }>,
  ) => void;
  onCancel: () => void;
}) {
  const { status, error, step, retry } = useLarkSetup(service, onConnected);
  const phase = status?.phase;
  const steps = [
    {
      id: "app" as const,
      Icon: AppWindow,
      title: t("Choose the Lark app"),
      detail: t(
        "Lark opens to create the app {name} uses, or to pick one you already have.",
        { name },
      ),
    },
    {
      id: "user" as const,
      Icon: KeyRound,
      title: t("Approve your access"),
      detail: t("Then approve what {name} can do in Lark as you.", { name }),
    },
  ];
  return (
    <div className="lark-setup" aria-live="polite">
      <ol>
        {steps.map(({ id, Icon, title, detail }) => (
          <li key={id} data-state={step(id)}>
            <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
            <div>
              <strong>{title}</strong>
              <p>{detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <div className="lark-setup-actions">
        <button className="settings-inline-button" onClick={onCancel}>
          {t("Cancel")}
        </button>
        {phase === "app" || phase === "user" ? (
          <a
            className="settings-primary-button"
            href={status!.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {phase === "app"
              ? t("Open Lark to choose the app")
              : t("Open Lark to approve")}
          </a>
        ) : error ? (
          <button className="settings-primary-button" onClick={retry}>
            {t("Try again")}
          </button>
        ) : (
          <button className="settings-primary-button" disabled>
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
            {t("Preparing…")}
          </button>
        )}
      </div>
      {(phase === "app" || phase === "user") && (
        <p className="lark-setup-note">
          {t("Come back here when Lark says you're done.")}
        </p>
      )}
    </div>
  );
}

// The Lark row's state: connected (by the person's Lark name), or not.
export type LarkAccount = { name?: string } | undefined;

export function useLarkAccount(
  service: Pick<LarkSetupService, "larkConnection">,
) {
  const [account, setAccount] = useState<LarkAccount | "unknown">("unknown");
  const read = () =>
    void service.larkConnection().then(
      (value) =>
        setAccount(
          value.phase === "connected" ? { name: value.name } : undefined,
        ),
      () => setAccount(undefined),
    );
  return { account, setAccount, read };
}
