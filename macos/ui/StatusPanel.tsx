import { formatLocale, t } from "../../shared/i18n";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Check,
  CircleUserRound,
  Fingerprint,
  Heart,
  List,
  Pencil,
  ShieldCheck,
  X,
  Zap,
  createLucideIcon,
} from "lucide-react";
import type {
  CompanionIdentity,
  IdentityDocumentName,
} from "../../shared/identity";
import type { AgentEvent } from "../../shared/types";
import { PermissionCard } from "../../src/PermissionCard";
import { Avatar, Empty } from "./Chrome";
import { statusTabLabel } from "./labels";
import { activityEvents, activityLabel } from "./model";

// Upcoming: a clock whose earlier half is still dashed.
const UpcomingIcon = createLucideIcon("clock-half-dashed", [
  ["path", { d: "M12 3a9 9 0 0 1 0 18", key: "done" }],
  [
    "path",
    { d: "M12 21a9 9 0 0 1 0-18", strokeDasharray: "2.2 2.6", key: "ahead" },
  ],
  ["path", { d: "M12 7.5V12H8.5", key: "hands" }],
]);

export type StatusTab = "activity" | "approvals" | "upcoming" | "identity";
const tabOrder: StatusTab[] = ["activity", "approvals", "upcoming", "identity"];

// Whether the person left the status panel open: a device-local presentation
// choice, closed until they open it.
const openKey = "open-muse.status-panel.open";
export function statusPanelOpenStored() {
  try {
    return localStorage.getItem(openKey) === "true";
  } catch {
    return false;
  }
}
export function storeStatusPanelOpen(open: boolean) {
  try {
    localStorage.setItem(openKey, String(open));
  } catch {
    // Private storage can refuse writes; the choice then lasts this session.
  }
}
export function fileDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date
        .toLocaleDateString(formatLocale(), {
          month: "2-digit",
          day: "2-digit",
          year: "2-digit",
        })
        .replaceAll("/", ".")
    : "";
}

export function IdentityCards({
  identity,
  onOpen,
  disabled,
}: {
  identity: CompanionIdentity;
  onOpen: (name: IdentityDocumentName) => void;
  disabled: boolean;
}) {
  return (
    <section className="desktop-identity" aria-label={t("Assistant identity")}>
      <div className="identity-summary">
        <h3>{identity.name}</h3>
        <button disabled={disabled} onClick={() => onOpen("IDENTITY.md")}>
          <Pencil size={14} />
          {t("Edit")}
        </button>
      </div>
      {identity.warning && (
        <p role="alert" className="error-text">
          {identity.warning}
        </p>
      )}
      <div className="identity-files">
        {(["SOUL.md", "MEMORY.md"] as const).map((name) => (
          <button
            key={name}
            className={`identity-file ${name === "SOUL.md" ? "soul" : "memory"}`}
            aria-label={t("Open {name}", { name })}
            disabled={disabled}
            onClick={() => onOpen(name)}
          >
            <span>
              <strong>{name === "SOUL.md" ? t("SOUL") : t("MEMORY")}</strong>
              <small>{t("ACCESS WITH CARE")}</small>
            </span>
            <footer>
              <time dateTime={identity.documents[name].updated_at}>
                {fileDate(identity.documents[name].updated_at)}
              </time>
              <Heart size={20} fill="currentColor" />
            </footer>
          </button>
        ))}
      </div>
    </section>
  );
}

export function StatusPanel({
  identity,
  status,
  tab,
  onTab,
  onClose,
  events,
  approvals,
  busy,
  onConfirm,
  onDocument,
  onPrefill,
  upcoming,
  tone = "offline",
}: {
  identity: CompanionIdentity;
  status: string;
  tab: StatusTab;
  onTab: (tab: StatusTab) => void;
  onClose: () => void;
  events: AgentEvent[];
  approvals: AgentEvent[];
  busy: boolean;
  onConfirm: (result: "allow" | "deny", event: AgentEvent) => void;
  onDocument: (name: IdentityDocumentName) => void;
  onPrefill: (text: string) => void;
  upcoming?: ReactNode;
  // Green while connected, amber while working, grey otherwise.
  tone?: "online" | "busy" | "offline";
}) {
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<HTMLDivElement>(null);
  // Opening with the keyboard lands on the first entry.
  useEffect(() => {
    if (menu) items.current?.querySelector("button")?.focus();
  }, [menu]);
  function closeMenu(restoreFocus: boolean) {
    setMenu(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function moveFocus(step: number) {
    const buttons = [...(items.current?.querySelectorAll("button") ?? [])];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  }
  // The menu closes the same way the other desktop menus do.
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        // Escape hands focus back to the control that opened the menu.
        trigger.current?.focus();
        setMenu(false);
        return;
      }
      if (
        event.type === "click" &&
        event.target instanceof Element &&
        event.target.closest(".status-menu-anchor")
      )
        return;
      setMenu(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("click", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("click", close);
    };
  }, [menu]);
  // A newly chosen tab slides in from the side it sits on in the tab bar.
  const shown = useRef(tab);
  const slide = useRef(0);
  if (shown.current !== tab) {
    slide.current =
      tabOrder.indexOf(tab) > tabOrder.indexOf(shown.current) ? 1 : -1;
    shown.current = tab;
  }
  const from = slide.current;
  const tabs = [
    { id: "activity", label: statusTabLabel("activity"), Icon: List },
    { id: "approvals", label: statusTabLabel("approvals"), Icon: ShieldCheck },
    { id: "upcoming", label: t("Upcoming"), Icon: UpcomingIcon },
    { id: "identity", label: t("Identity"), Icon: Fingerprint },
  ] as const;
  return (
    <aside className="status-panel" aria-label={t("Assistant status")}>
      <button
        className="status-close icon-button"
        aria-label={t("Close panel")}
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <div className="status-profile">
        <Avatar large />
        <div className="edit-profile status-menu-anchor">
          <button
            className="icon-button"
            aria-label={t("Edit avatar and name")}
            aria-haspopup="menu"
            aria-expanded={menu}
            ref={trigger}
            onClick={() => setMenu((open) => !open)}
          >
            <Pencil size={13} />
          </button>
          {menu && (
            <div
              className="status-menu"
              role="menu"
              ref={items}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveFocus(event.key === "ArrowDown" ? 1 : -1);
                }
              }}
            >
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onPrefill(`${t("Change your avatar to")} `);
                }}
              >
                <CircleUserRound size={16} />
                {t("Change avatar")}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onPrefill(`${t("Change your name to")} `);
                }}
              >
                <Pencil size={16} />
                {t("Edit name")}
              </button>
            </div>
          )}
        </div>
        <h2>{identity.name}</h2>
        <p className={`status-line is-${tone}`}>
          <span className="status-dot" aria-hidden="true">
            {tone === "online" && <Zap size={9} fill="currentColor" />}
          </span>
          {status}
        </p>
      </div>
      <div
        className="status-tabs"
        role="tablist"
        aria-label={t("Assistant information")}
        style={
          {
            "--count": tabs.length,
            "--index": Math.max(
              0,
              tabs.findIndex((item) => item.id === tab),
            ),
          } as CSSProperties
        }
      >
        <span className="status-tabs-pill" aria-hidden="true" />
        {tabs.map(({ id, label, Icon }) => (
          <button
            role="tab"
            key={id}
            id={`status-${id}`}
            aria-controls="status-content"
            aria-label={label}
            aria-selected={tab === id}
            title={label}
            onClick={() => onTab(id)}
          >
            <Icon size={18} strokeWidth={1.7} />
          </button>
        ))}
      </div>
      <div
        id="status-content"
        className="status-content"
        role="tabpanel"
        aria-labelledby={`status-${tab}`}
      >
        <div
          key={tab}
          className="status-tab-body"
          data-from={from === 0 ? undefined : from > 0 ? "end" : "start"}
        >
          {tab === "identity" && (
            <IdentityCards
              identity={identity}
              disabled={busy}
              onOpen={onDocument}
            />
          )}
          {tab === "upcoming" && upcoming}
          {tab === "upcoming" && !upcoming && (
            <Empty title={t("Upcoming tasks")}>
              <p>
                {t(
                  "Background scheduling is not connected in this desktop build yet. Chat messages do not create reminders automatically.",
                )}
              </p>
            </Empty>
          )}
          {tab === "approvals" &&
            (approvals.length ? (
              approvals.map((event) => (
                <PermissionCard
                  key={event.id}
                  event={event}
                  busy={busy}
                  onConfirm={onConfirm}
                />
              ))
            ) : (
              <Empty title={t("No approvals needed")}>
                <p>{t("Requests for permission appear here.")}</p>
              </Empty>
            ))}
          {tab === "activity" && (
            <>
              <h3>{statusTabLabel("activity")}</h3>
              {activityEvents(events)
                .slice(-30)
                .reverse()
                .map((event) => (
                  <details className="activity-item" key={event.id}>
                    <summary>
                      <Check size={18} />
                      <span title={event.name}>
                        {activityLabel(event.name)}
                      </span>
                    </summary>
                    <pre>
                      {JSON.stringify(
                        event.input ?? event.content ?? {},
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                ))}
              {!activityEvents(events).length && (
                <Empty title={t("No activity yet")}>
                  <p>{t("Your assistant's work will appear here.")}</p>
                </Empty>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
