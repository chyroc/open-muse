import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  Check,
  KeyRound,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { t } from "../../shared/i18n";
import type { LarkConnection } from "../../src/background-client";
import { useLarkSetup, type LarkSetupService } from "../../src/lark-setup";

// Opens a Lark page in the browser without a click: the Mac shell opens
// Feishu's pages; elsewhere the browser may allow a new tab.
function openLark(url: string) {
  const shell = (
    window as unknown as {
      webkit?: {
        messageHandlers?: { museWindow?: { postMessage: (v: object) => void } };
      };
    }
  ).webkit?.messageHandlers?.museWindow;
  if (shell) shell.postMessage({ name: "open-lark", value: url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

// Connecting Lark in Settings > Connectors, the same two steps as on iPhone:
// the Open Muse service registers or picks the Lark app, then the person
// approves their own access. Each step's Lark page opens in the browser on
// its own, and the step shows a spinner until Lark confirms it, then a check.
// Setup can start over, forgetting the chosen app.
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
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const phase = status?.phase;
  const url = phase === "app" || phase === "user" ? status!.url : undefined;
  // Each step's page opens once, as soon as it is known.
  const opened = useRef(new Set<string>());
  useEffect(() => {
    if (!url || opened.current.has(url)) return;
    opened.current.add(url);
    openLark(url);
  }, [url]);
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
  // Before the first page is known, the first step is getting ready.
  const stateOf = (id: "app" | "user") =>
    step(id) ?? (!status && !error && id === "app" ? "active" : undefined);
  const startOver = () => {
    if (!service.resetLarkConnection || resetting) return;
    setResetting(true);
    setResetError("");
    opened.current.clear();
    void service
      .resetLarkConnection()
      .then(retry, (failure: Error) => setResetError(failure.message))
      .finally(() => setResetting(false));
  };
  return (
    <div className="lark-setup" aria-live="polite">
      <ol>
        {steps.map(({ id, Icon, title, detail }) => {
          const state = stateOf(id);
          return (
            <li key={id} data-state={state}>
              <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
              <div>
                <strong>{title}</strong>
                <p>{detail}</p>
                {state === "active" && url && phase === id && (
                  <button
                    type="button"
                    className="lark-setup-reopen"
                    onClick={() => openLark(url)}
                  >
                    {t("Lark didn't open? Open it again")}
                  </button>
                )}
              </div>
              <span className="lark-setup-mark">
                {state === "active" && !error ? (
                  <LoaderCircle
                    size={16}
                    className="spin"
                    aria-label={t("Waiting for Lark")}
                  />
                ) : state === "done" ? (
                  <Check size={16} strokeWidth={2.4} aria-label={t("Done")} />
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      {(error || resetError) && (
        <p className="settings-error" role="alert">
          {resetError || error}
        </p>
      )}
      <div className="lark-setup-actions">
        {service.resetLarkConnection && (phase === "user" || error) && (
          <button
            className="settings-inline-button lark-setup-reset"
            disabled={resetting}
            onClick={startOver}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {t("Clear Lark setup and start over")}
          </button>
        )}
        <button className="settings-inline-button" onClick={onCancel}>
          {t("Cancel")}
        </button>
        {error && (
          <button className="settings-primary-button" onClick={retry}>
            {t("Try again")}
          </button>
        )}
      </div>
      {url && !error && (
        <p className="lark-setup-note">
          {t(
            "Lark opened in your browser. This updates on its own when you finish there.",
          )}
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
