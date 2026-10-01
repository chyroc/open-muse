import { formatLocale, t } from "../../shared/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Clock3,
  CircleUserRound,
  Fingerprint,
  Heart,
  List,
  Pencil,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  CompanionIdentity,
  IdentityDocumentName,
} from "../../shared/identity";
import type { AgentEvent } from "../../shared/types";
import { PermissionCard } from "../../src/PermissionCard";
import { Avatar, Empty } from "./Chrome";
import { statusTabLabel } from "./labels";
import { activityEvents } from "./model";

export type StatusTab = "activity" | "approvals" | "upcoming" | "identity";
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
  const tabs = [
    { id: "activity", label: statusTabLabel("activity"), Icon: List },
    { id: "approvals", label: statusTabLabel("approvals"), Icon: ShieldCheck },
    { id: "upcoming", label: t("Upcoming"), Icon: Clock3 },
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
        <p className="subtle">{status}</p>
      </div>
      <div
        className="status-tabs"
        role="tablist"
        aria-label={t("Assistant information")}
      >
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
            <Icon size={17} />
          </button>
        ))}
      </div>
      <div
        id="status-content"
        className="status-content"
        role="tabpanel"
        aria-labelledby={`status-${tab}`}
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
                    <span>{event.name ?? t("Tool call")}</span>
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
    </aside>
  );
}
