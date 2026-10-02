import { useCallback, useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import { ChevronDown, X, createLucideIcon } from "lucide-react";
import {
  blockApp,
  computerAvailable,
  computerChanged,
  enableComputer,
  readComputer,
  requestPermission,
  setComputerPolicy,
  setKeepAwake,
  unblockApp,
  type ComputerPolicy,
  type ComputerState,
} from "./computer";
import { Switch } from "./SettingsSwitch";

// A display with a pointer stands for Accessibility; overlapping screens for
// Screen Recording.
const MonitorCursor = createLucideIcon("monitor-cursor", [
  [
    "rect",
    { x: "2", y: "3", width: "20", height: "14", rx: "2", key: "screen" },
  ],
  ["path", { d: "M8 21h8", key: "base" }],
  ["path", { d: "M12 17v4", key: "stand" }],
  ["path", { d: "m9 7 6 2.5-2.5 1-1 2.5z", key: "pointer" }],
]);
const ScreenShare = createLucideIcon("screen-share-stack", [
  [
    "rect",
    { x: "8", y: "8", width: "14", height: "14", rx: "2", key: "front" },
  ],
  [
    "path",
    {
      d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
      key: "back",
    },
  ],
]);

// One macOS permission: its icon and name, and a link that opens it in System
// Settings, worded for whether it is already granted.
export function PermissionRow({
  icon: Icon,
  title,
  granted,
  disabled,
  onOpen,
}: {
  icon: typeof X;
  title: string;
  granted?: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="computer-permission-row">
      <span className="computer-permission-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.6} />
      </span>
      <span className="computer-permission-title">{title}</span>
      <button
        className="settings-link"
        disabled={disabled}
        aria-label={
          granted
            ? t("Turn off in System Settings: {permission}", {
                permission: title,
              })
            : t("Open System Settings: {permission}", { permission: title })
        }
        onClick={onOpen}
      >
        {granted ? t("Turn off in System Settings") : t("Open System Settings")}
      </button>
      <span role="status" className="sr-only">
        {granted && t("{permission} granted", { permission: title })}
      </span>
    </div>
  );
}

// Computer use is a device permission: off by default, held by the native
// shell, and paired with the two macOS permissions it depends on.
export function ComputerSettings() {
  const [state, setState] = useState<ComputerState>();
  const [error, setError] = useState("");
  const available = computerAvailable();
  const refresh = useCallback(
    () =>
      void readComputer()
        .then((value) => value && setState(value))
        .catch(() => setError(t("Could not read the app settings."))),
    [],
  );
  useEffect(() => {
    if (!available) return;
    refresh();
    // Permissions are granted in System Settings, so re-read on return.
    window.addEventListener("focus", refresh);
    window.addEventListener(computerChanged, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(computerChanged, refresh);
    };
  }, [available, refresh]);
  const change = (request: Promise<ComputerState | undefined>) =>
    void request
      .then((value) => value && setState(value))
      .catch(() => setError(t("Could not change the app settings.")));
  if (!available)
    return (
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>{t("Not connected")}</strong>
            <p>{t("Computer use needs the Open Muse Mac app.")}</p>
          </div>
        </div>
      </div>
    );
  // Everything below the permissions waits until macOS grants both.
  const ready = Boolean(state?.accessibility && state.screen);
  const permission = (
    kind: "accessibility" | "screen",
    title: string,
    granted?: boolean,
  ) => (
    <PermissionRow
      icon={kind === "screen" ? ScreenShare : MonitorCursor}
      title={title}
      granted={granted}
      disabled={!state}
      onOpen={() =>
        void requestPermission(kind)
          .then((value) => value && setState(value))
          .catch(() => setError(t("Could not change the app settings.")))
      }
    />
  );
  return (
    <>
      <section>
        <h2>{t("Permissions required")}</h2>
        <div className="settings-group computer-permissions">
          {permission(
            "accessibility",
            t("Accessibility"),
            state?.accessibility,
          )}
          {permission("screen", t("Screen Recording"), state?.screen)}
        </div>
        <p className="settings-footnote">
          {t(
            "Computer use enables Open Muse to click, type and use apps on your computer.",
          )}
        </p>
      </section>
      <div className="permission-settings-controls" data-disabled={!ready}>
        <div className="settings-group">
          <Switch
            label={t("Let your assistant use this Mac")}
            detail={t(
              "Every action still waits for your approval in the chat.",
            )}
            checked={state?.enabled ?? false}
            disabled={!state || !ready}
            onChange={(value) =>
              void enableComputer(value)
                .then((next) => next && setState(next))
                .catch(() => setError(t("Could not change the app settings.")))
            }
          />
          <Switch
            label={t("Keep screen awake while working")}
            detail={t("Your screen stays awake while your assistant works.")}
            checked={state?.keepAwake ?? false}
            disabled={!state || !ready}
            onChange={(value) => change(setKeepAwake(value))}
          />
        </div>
        <section>
          <h2>{t("Manage permissions")}</h2>
          <div className="settings-group">
            <div className="settings-row settings-dropdown-row">
              <span className="settings-dropdown-label">
                {t("Computer control")}
              </span>
              <span className="settings-dropdown">
                <select
                  aria-label={t("Computer control")}
                  disabled={!state || !ready}
                  value={state?.policy ?? "ask"}
                  onChange={(event) =>
                    change(
                      setComputerPolicy(event.target.value as ComputerPolicy),
                    )
                  }
                >
                  <option value="ask">{t("Ask every time")}</option>
                  <option value="allow">{t("Always allow")}</option>
                  <option value="deny">{t("Always deny")}</option>
                </select>
                <ChevronDown size={16} aria-hidden="true" />
              </span>
            </div>
          </div>
          <p className="settings-footnote">
            {state?.policy === "allow"
              ? t(
                  "Screenshots, clicks, typing and opening apps run as soon as your assistant asks. Calendar and Location still ask.",
                )
              : state?.policy === "deny"
                ? t(
                    "Every computer control request is declined, and your assistant is told not to try another way.",
                  )
                : t(
                    "Each request shows what it will do. Allow it once, allow the rest of that conversation, or decline.",
                  )}
          </p>
        </section>
        <section>
          <h2>{t("Blocked apps")}</h2>
          <div className="settings-group computer-blocked">
            {state?.blocked.map((app) => (
              <div className="computer-blocked-row" key={app.id}>
                <span>{app.name}</span>
                <button
                  className="icon-button"
                  disabled={!ready}
                  aria-label={t("Unblock {name}", { name: app.name })}
                  onClick={() => change(unblockApp(app.id))}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            <button
              className="computer-add-app"
              disabled={!state || !ready}
              onClick={() => change(blockApp())}
            >
              {t("Add app")}
            </button>
          </div>
          <p className="settings-footnote">
            {t("Open Muse can't see or use apps you add here.")}
          </p>
        </section>
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
