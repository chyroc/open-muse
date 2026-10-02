import { useCallback, useEffect, useState } from "react";
import { t } from "../../shared/i18n";
import { X } from "lucide-react";
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
  const lead = (
    <p className="settings-lead">
      {t(
        "When you ask, your assistant can look at this Mac's screen, open apps, click and type. Every action waits for your approval in the conversation, and nothing runs while this is off.",
      )}
    </p>
  );
  if (!available)
    return (
      <>
        {lead}
        <div className="settings-group">
          <div className="settings-row">
            <div>
              <strong>{t("Not connected")}</strong>
              <p>{t("Computer use needs the Open Muse Mac app.")}</p>
            </div>
          </div>
        </div>
      </>
    );
  const permission = (
    kind: "accessibility" | "screen",
    title: string,
    detail: string,
    granted?: boolean,
  ) => (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {granted ? (
        <span>{t("Allowed")}</span>
      ) : (
        <button
          className="settings-inline-button"
          disabled={!state}
          onClick={() =>
            void requestPermission(kind)
              .then((value) => value && setState(value))
              .catch(() => setError(t("Could not change the app settings.")))
          }
        >
          {t("Open System Settings")}
        </button>
      )}
    </div>
  );
  return (
    <>
      {lead}
      <div className="settings-group">
        <Switch
          label={t("Let your assistant use this Mac")}
          checked={state?.enabled ?? false}
          disabled={!state}
          onChange={(value) =>
            void enableComputer(value)
              .then((next) => next && setState(next))
              .catch(() => setError(t("Could not change the app settings.")))
          }
        />
      </div>
      <div className="settings-group">
        <Switch
          label={t("Keep screen awake while working")}
          detail={t("Your screen stays awake while your assistant works.")}
          checked={state?.keepAwake ?? false}
          disabled={!state}
          onChange={(value) => change(setKeepAwake(value))}
        />
      </div>
      <h2>{t("Manage permissions")}</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>{t("Computer control")}</strong>
            <p>
              {state?.policy === "allow"
                ? t(
                    "Screenshots, clicks, typing and opening apps run as soon as your assistant asks, while computer use is on. Calendar and Location still ask.",
                  )
                : t(
                    "Screenshots, clicks, typing and opening apps. Calendar and Location always ask.",
                  )}
            </p>
          </div>
          <select
            className="settings-select"
            aria-label={t("Computer control")}
            disabled={!state}
            value={state?.policy ?? "ask"}
            onChange={(event) =>
              change(setComputerPolicy(event.target.value as ComputerPolicy))
            }
          >
            <option value="ask">{t("Ask every time")}</option>
            <option value="allow">{t("Always allow")}</option>
            <option value="deny">{t("Always deny")}</option>
          </select>
        </div>
      </div>
      <h2>{t("macOS permissions")}</h2>
      <div className="settings-group">
        {permission(
          "screen",
          t("Screen Recording"),
          t("Lets your assistant see the screen when it asks to look."),
          state?.screen,
        )}
        {permission(
          "accessibility",
          t("Accessibility"),
          t("Lets your assistant click, type and press keys."),
          state?.accessibility,
        )}
      </div>
      <h2>{t("Blocked apps")}</h2>
      <div className="settings-group">
        {state?.blocked.map((app) => (
          <div className="settings-row settings-blocked-row" key={app.id}>
            <div>
              <strong>{app.name}</strong>
            </div>
            <button
              className="icon-button"
              aria-label={t("Unblock {name}", { name: app.name })}
              onClick={() => change(unblockApp(app.id))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <div className="settings-row">
          <div>
            <p>
              {t(
                "Your assistant can't see or use the apps you add here: they are left out of screenshots and app lists, and opening or acting on them is refused.",
              )}
            </p>
          </div>
          <button
            className="settings-inline-button"
            disabled={!state}
            onClick={() => change(blockApp())}
          >
            {t("Add app")}
          </button>
        </div>
      </div>
      <h2>{t("Rules")}</h2>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <strong>
              {state?.policy === "allow"
                ? t("Computer control runs without asking")
                : state?.policy === "deny"
                  ? t("Computer control is always declined")
                  : t("Every action asks first")}
            </strong>
            <p>
              {state?.policy === "allow"
                ? t(
                    "You chose Always allow, so each computer control request runs and is shown in the conversation. Change it above at any time.",
                  )
                : state?.policy === "deny"
                  ? t(
                      "You chose Always deny, so every computer control request is declined without asking, and your assistant is told not to try another way.",
                    )
                  : t(
                      "Each request shows what it will do. Allow it once, allow the rest of that conversation, or decline. A declined action is not tried another way.",
                    )}
            </p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>{t("Only while the app is open")}</strong>
            <p>
              {t(
                "Requests run in the workspace window of this Mac. Scheduled and background work never controls your Mac.",
              )}
            </p>
          </div>
        </div>
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
