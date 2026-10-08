import { useEffect, useState } from "react";
import { ConnectorIcon } from "./AppIcons";
import {
  BookUser,
  CalendarDays,
  ChevronsUpDown,
  HeartPulse,
  ListTodo,
} from "lucide-react";
import { t } from "../shared/i18n";
import type { Client, DevicePermission, DevicePermissionSource } from "./api";
import { healthSupported } from "./health";
import { personalSources, personalSupported } from "./personal";
import { onAndroid } from "./platform";
import { Sheet } from "./MusePages";
import { RowChevron } from "./SettingsHome";
import "./connectors.css";
import "./permissions-sheet.css";

const sources: Record<
  DevicePermissionSource,
  { name: string; read: string; Icon: typeof HeartPulse }
> = {
  health: {
    // Health Connect on Android.
    get name() {
      return onAndroid() ? "Health Connect" : "Apple Health";
    },
    read: "View health data",
    Icon: HeartPulse,
  },
  calendar: {
    name: "Calendar",
    read: "View calendar events",
    Icon: CalendarDays,
  },
  reminders: { name: "Reminders", read: "View reminders", Icon: ListTodo },
  contacts: { name: "Contacts", read: "Look up contacts", Icon: BookUser },
};
const permissionNames: Record<DevicePermission, string> = {
  allow: "Allow",
  ask: "Ask",
  deny: "Deny",
};

// The sources on this iPhone the companion can ask to read.
function deviceSources(): DevicePermissionSource[] {
  return [
    ...(healthSupported() ? (["health"] as const) : []),
    ...(personalSupported() ? personalSources() : []),
  ];
}

type PermissionClient = Pick<
  Client,
  "devicePermission" | "setDevicePermission"
>;

// Settings > Permissions: how the companion's requests to read this
// iPhone's data are answered, per connector. Apple Health can be allowed
// without asking; every source can be asked each time or declined. iOS's
// own access stays in the system Settings, linked from each page.
export function PermissionsSheet({
  client,
  onClose,
}: {
  client: PermissionClient;
  onClose: () => void;
}) {
  const [connectors, setConnectors] = useState(false);
  const available = deviceSources();
  return (
    <Sheet title={t("Permissions")} onClose={onClose} grouped>
      <h3 className="permissions-heading">{t("Manage permissions")}</h3>
      <ul className="settings-list">
        <li>
          <button
            className="settings-list-row permissions-row"
            onClick={() => setConnectors(true)}
          >
            <span>{t("Connectors")}</span>
            <span className="settings-row-value">{available.length}</span>
            <RowChevron />
          </button>
        </li>
      </ul>
      {connectors && (
        <ConnectorPermissions
          client={client}
          available={available}
          onClose={() => setConnectors(false)}
        />
      )}
    </Sheet>
  );
}

function ConnectorPermissions({
  client,
  available,
  onClose,
}: {
  client: PermissionClient;
  available: DevicePermissionSource[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState<DevicePermissionSource>();
  return (
    <Sheet title={t("Connectors")} onClose={onClose} grouped>
      {available.length ? (
        <>
          <h3 className="permissions-heading">{t("Connected")}</h3>
          <ul className="settings-list">
            {available.map((source) => {
              const { name, Icon } = sources[source];
              return (
                <li key={source}>
                  <button
                    className="settings-list-row permissions-row"
                    onClick={() => setOpen(source)}
                  >
                    <ConnectorIcon id={source} Icon={Icon} size={18} />
                    <span>{t(name)}</span>
                    <RowChevron />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="settings-footnote">
          {t("Nothing on this device is connected.")}
        </p>
      )}
      {open && (
        <SourcePermission
          client={client}
          source={open}
          onClose={() => setOpen(undefined)}
        />
      )}
    </Sheet>
  );
}

function SourcePermission({
  client,
  source,
  onClose,
}: {
  client: PermissionClient;
  source: DevicePermissionSource;
  onClose: () => void;
}) {
  const [permission, setPermission] = useState<DevicePermission>();
  const [error, setError] = useState("");
  useEffect(() => {
    void client
      .devicePermission(source)
      .then(setPermission, (reason: Error) => setError(reason.message));
  }, [source]);
  const choices: DevicePermission[] =
    source === "health" ? ["allow", "ask", "deny"] : ["ask", "deny"];
  return (
    <Sheet title={t(sources[source].name)} onClose={onClose} grouped>
      <ul className="settings-list">
        <li>
          <a
            className="settings-list-row permissions-manage"
            href="app-settings:"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Manage")}
          </a>
        </li>
      </ul>
      <p className="settings-footnote">
        {onAndroid()
          ? t(
              "You can manage what Open Muse can access in Android's Settings.",
            )
          : t(
              "You can manage what Open Muse can access in the iPhone's Settings.",
            )}
      </p>
      <h3 className="permissions-heading">{t("Read permission")}</h3>
      <ul className="settings-list">
        <li>
          <label className="settings-list-row permissions-row permissions-picker">
            <span>{t(sources[source].read)}</span>
            <span className="settings-row-value">
              {permission ? t(permissionNames[permission]) : ""}
            </span>
            <ChevronsUpDown size={16} aria-hidden="true" />
            <select
              aria-label={t(sources[source].read)}
              value={permission ?? "ask"}
              disabled={!permission}
              onChange={(event) => {
                const next = event.target.value as DevicePermission;
                setError("");
                void client.setDevicePermission(source, next).then(
                  () => setPermission(next),
                  (reason: Error) => setError(reason.message),
                );
              }}
            >
              {choices.map((choice) => (
                <option key={choice} value={choice}>
                  {t(permissionNames[choice])}
                </option>
              ))}
            </select>
          </label>
        </li>
      </ul>
      <p className="settings-footnote">
        {source === "health"
          ? t(
              "Allow shares what your assistant asks for without asking each time. Deny refuses every request.",
            )
          : t(
              "Your assistant asks before every read here. Deny refuses every request without asking.",
            )}
      </p>
      {error && (
        <p className="settings-footnote" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
