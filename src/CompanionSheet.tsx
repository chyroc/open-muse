import { systemLanguage, t } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  CircleUserRound,
  Fingerprint,
  Globe,
  Heart,
  List,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Monitor,
  Pencil,
  Share,
  ShieldCheck,
  SquarePen,
  X,
} from "lucide-react";
import type {
  CompanionIdentity,
  IdentityDocument,
  IdentityDocumentName,
} from "../shared/identity";
import {
  eventText,
  pendingCustomTools,
  type AgentEvent,
} from "../shared/types";
import type { Client } from "./api";
import { CompanionAvatar } from "./ChatUI";
import { Markdown, PermissionCard } from "./components";
import { ActivityList } from "./ActivityList";
import { animateAway, useDragToDismiss } from "./gesture";
import { activityTurns } from "../shared/activity";
import { UpcomingPanel } from "./UpcomingPanel";
import { BrowserTasks, BrowserViewer } from "./BrowserViewer";
import { ApprovalHistory } from "./ApprovalHistory";
import { AvatarShareSheet } from "./AvatarShareSheet";
import { approvalHistory } from "../shared/approvals";
import "./identity.css";

// Scheduled work: a clock whose face is drawn as dashes.
function UpcomingIcon({
  size = 23,
  strokeWidth = 1.8,
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 1-8.5 6" strokeDasharray="2.6 2.6" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

const tabs = [
  { name: "Activity", icon: List },
  { name: "Approvals", icon: ShieldCheck },
  { name: "Desktop", icon: Monitor },
  { name: "Upcoming", icon: UpcomingIcon },
  { name: "Identity", icon: Fingerprint },
] as const;

// Chinese names these tabs differently from the shared wording; English keeps
// the shared source strings, so other clients are unaffected.
function tabLabel(name: (typeof tabs)[number]["name"]) {
  if (systemLanguage() !== "zh-CN") return t(name);
  if (name === "Approvals") return t("Approvals tab");
  if (name === "Desktop") return t("Desktop tab");
  if (name === "Upcoming") return t("Upcoming tab");
  return t(name);
}

export function IdentityCards({
  identity,
  disabled,
  onOpen,
}: {
  identity: CompanionIdentity;
  disabled: boolean;
  onOpen: (name: IdentityDocumentName) => void;
}) {
  return (
    <section className="identity-overview" aria-label={t("Personal identity")}>
      <h2>{identity.name}</h2>
      {identity.warning && (
        <p className="inline-error" role="alert">
          {identity.warning}
        </p>
      )}
      <button
        className="identity-edit"
        disabled={disabled}
        onClick={() => onOpen("IDENTITY.md")}
      >
        <Pencil size={21} /> {t("Edit")}
      </button>
      <div className="identity-cards">
        {(["SOUL.md", "MEMORY.md"] as const).map((name) => {
          const doc = identity.documents[name];
          const date = doc.updated_at ? new Date(doc.updated_at) : undefined;
          return (
            <button
              key={name}
              className={`identity-card ${name === "SOUL.md" ? "soul" : "memory"}`}
              disabled={disabled}
              aria-label={t("Open {name}", { name })}
              onClick={() => onOpen(name)}
            >
              <strong>{name === "SOUL.md" ? "SOUL" : t("Memory")}</strong>
              <span>{t("ACCESS WITH CARE")}</span>
              <footer>
                <time>
                  {date && Number.isFinite(date.getTime())
                    ? [
                        date.getMonth() + 1,
                        date.getDate(),
                        date.getFullYear() % 100,
                      ]
                        .map((part) => String(part).padStart(2, "0"))
                        .join(".")
                    : doc.id
                      ? t("Saved")
                      : t("Not saved yet")}
                </time>
                {name === "SOUL.md" ? (
                  <Heart fill="currentColor" strokeWidth={0} size={26} />
                ) : (
                  <MessageSquare
                    fill="currentColor"
                    strokeWidth={0}
                    size={28}
                  />
                )}
              </footer>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function CompanionSheet({
  client,
  identity,
  onIdentity,
  onClose,
  status,
  sessionId,
  events,
  permissions,
  busy,
  onConfirm,
  onNew,
  onRename,
  onChangeAvatar,
  prepareSession,
  isMain = false,
}: {
  client: Client;
  identity: CompanionIdentity;
  onIdentity: (identity: CompanionIdentity) => void;
  onClose: () => void;
  status: string;
  sessionId?: string;
  events: AgentEvent[];
  permissions: AgentEvent[];
  busy: boolean;
  onConfirm: (result: "allow" | "deny", event: AgentEvent) => void;
  onNew: () => void;
  // Starts a message asking the companion to take a new name.
  onRename?: () => void;
  // Starts a message asking the companion to change how it looks.
  onChangeAvatar?: () => void;
  // The conversation to use now, continuing the main chat when it needs to.
  prepareSession?: () => Promise<string>;
  isMain?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]["name"]>("Activity");
  const [selected, setSelected] = useState<IdentityDocumentName>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState<boolean>();
  const [sharing, setSharing] = useState(false);
  const [menu, setMenu] = useState(false);
  // The cloud browser task: being started, or its view's ID. A browser left
  // running from before shows as the task again.
  const [browser, setBrowser] = useState(() => client.activeBrowserView());
  // The browser itself, taken over or watched.
  const [viewer, setViewer] = useState<"control" | "watch">();
  const [browserError, setBrowserError] = useState("");
  // A browser just started is shown as soon as its first picture arrives.
  const presentWhenReady = useRef(false);
  const browserReady = Boolean(sessionId) && client.browserViewSupported();
  // A request waiting in the chat, such as an approval or a health share,
  // holds the conversation, so the browser cannot be started until it is
  // answered; a browser already running can still be shown.
  const waitingInChat =
    permissions.length > 0 || pendingCustomTools(events).length > 0;
  // The agent may report that this conversation cannot run the browser
  // before the browser is ever shown; the task ends with that reason.
  const browserRefused =
    Boolean(browser && browser !== "starting" && !viewer) &&
    browserUnavailable(events, browser!);
  useEffect(() => {
    if (!browserRefused || !browser) return;
    void client.closeBrowserView(browser).catch(() => {});
    presentWhenReady.current = false;
    setBrowser(undefined);
    setBrowserError(
      t(
        "This conversation cannot run the cloud browser. Start a new chat and try again.",
      ),
    );
  }, [browserRefused, browser, client]);
  async function openBrowser(replacing?: string) {
    if (!sessionId || (browser && !replacing)) return;
    setBrowser("starting");
    setBrowserError("");
    if (replacing) await client.closeBrowserView(replacing).catch(() => {});
    try {
      // The browser runs in the sandbox of the conversation the person will
      // talk in, so the main chat is brought up to date first.
      const target = (await prepareSession?.()) ?? sessionId;
      const view = await client.startBrowserView(target);
      presentWhenReady.current = true;
      setBrowser(view);
    } catch (reason) {
      setBrowser(undefined);
      setBrowserError((reason as Error).message);
    }
  }
  const closing = useRef(false);
  // Slides down and away, then reports closed.
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    animateAway(dialog.current, "y", 1, onClose);
  };
  const drag = useDragToDismiss({
    target: dialog,
    axis: "y",
    direction: 1,
    onDismiss: dismiss,
  });
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    element.showModal();
    element.focus();
    return () => {
      element.close();
      if (focused instanceof HTMLElement) focused.focus();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setMounted(undefined);
    void Promise.all([
      client.companionIdentity(),
      sessionId && client.signedIn()
        ? client.identityMounted(sessionId)
        : Promise.resolve(undefined),
    ])
      .then(([value, attached]) => {
        if (active) {
          onIdentity(value);
          setMounted(attached);
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, sessionId, onIdentity]);
  return (
    <dialog
      ref={dialog}
      className="companion-sheet"
      tabIndex={-1}
      aria-label={t("Companion details")}
      onCancel={(e) => {
        e.preventDefault();
        if (!selected) dismiss();
      }}
    >
      <header className="identity-header" {...drag}>
        <button
          className="glass-button identity-dismiss"
          aria-label={t("Close companion details")}
          onClick={dismiss}
        >
          <X size={23} />
        </button>
        <div className="identity-avatar">
          <CompanionAvatar alive />
          <button
            className="glass-button"
            aria-label={t("Edit companion name")}
            disabled={loading || Boolean(error) || !client.signedIn()}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(true)}
          >
            <Pencil size={20} />
          </button>
        </div>
        {menu && (
          <>
            <div
              className="identity-menu-scrim"
              onClick={() => setMenu(false)}
            />
            <div className="identity-menu" role="menu">
              {onChangeAvatar && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    const element = dialog.current;
                    if (!element) return;
                    element.close();
                    element.show();
                    onChangeAvatar();
                    dismiss();
                  }}
                >
                  <CircleUserRound size={21} />
                  {t("Change avatar")}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  // Ask in the chat, as with any other change. The composer
                  // takes focus within this tap so the keyboard can rise, so
                  // the sheet stops being modal before it slides away.
                  const element = dialog.current;
                  if (onRename && element) {
                    element.close();
                    element.show();
                    onRename();
                    dismiss();
                  } else setSelected("IDENTITY.md");
                }}
              >
                <Pencil size={21} />
                {t("Edit name")}
              </button>
            </div>
          </>
        )}
        <h1>{identity.name}</h1>
        <span className="identity-connection">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {status === t("Connected") ? (
              <>
                <circle cx="10" cy="10" r="10" fill="currentColor" />
                <path d="M11.2 3.8 6 11h3.6l-.8 5.2L14 9h-3.6z" fill="#fff" />
              </>
            ) : (
              <path
                d="M11.2 3.8 6 11h3.6l-.8 5.2L14 9h-3.6z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            )}
          </svg>
          {status}
        </span>
        <button
          className="glass-button identity-share"
          aria-label={t("Share avatar")}
          onClick={() => setSharing(true)}
        >
          <Share size={21} />
        </button>
      </header>
      <nav
        className="companion-tabs"
        role="tablist"
        aria-label={t("Companion information")}
      >
        {tabs.map(({ name, icon: Icon }) => (
          <button
            key={name}
            role="tab"
            aria-label={tabLabel(name)}
            aria-selected={tab === name}
            aria-controls="companion-tab-content"
            onClick={() => setTab(name)}
          >
            <Icon size={23} strokeWidth={1.8} />
          </button>
        ))}
      </nav>
      <div
        className="companion-tab-content"
        id="companion-tab-content"
        role="tabpanel"
        aria-label={tabLabel(tab)}
      >
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {tab === "Identity" && (
          <>
            <IdentityCards
              identity={identity}
              disabled={loading || Boolean(error)}
              onOpen={setSelected}
            />
            {!client.signedIn() && (
              <p className="identity-note">
                {t("These are starting templates.")}{" "}
                <a href="#/settings" onClick={onClose}>
                  {t("Connect to MA")}
                </a>{" "}
                {t("to save your personal identity.")}
              </p>
            )}
            {mounted === false && (
              <aside className="identity-note">
                {isMain
                  ? t(
                      "Personal memory will be connected with your next message. Your main chat keeps its earlier messages and context.",
                    )
                  : t(
                      "This older side chat does not have personal memory attached. Its history is unchanged. New side chats can use your saved identity and memory.",
                    )}
                {!isMain && (
                  <button
                    onClick={() => {
                      onClose();
                      onNew();
                    }}
                  >
                    {t("Start a side chat with memory")}
                  </button>
                )}
              </aside>
            )}
          </>
        )}
        {tab === "Activity" && (
          <section className="companion-activity">
            {activityTurns(events).length ? (
              <ActivityList
                client={client}
                events={events}
                running={status === t("Replying")}
              />
            ) : (
              <div className="companion-empty">
                <List size={29} />
                <h3>
                  {status === t("Replying")
                    ? t("Thinking things through")
                    : t("Nothing in progress")}
                </h3>
                <p>{t("Tool activity from this conversation appears here.")}</p>
              </div>
            )}
          </section>
        )}
        {tab === "Approvals" && (
          <section className="companion-approvals">
            {permissions.map((event) => (
              <PermissionCard
                key={event.id}
                event={event}
                busy={busy}
                onConfirm={onConfirm}
              />
            ))}
            <ApprovalHistory events={events} />
            {!permissions.length && !approvalHistory(events).length && (
              <div className="companion-empty centered">
                <h3>{tabLabel("Approvals")}</h3>
                <p>{t("No approvals yet")}</p>
              </div>
            )}
          </section>
        )}
        {tab === "Upcoming" && (
          <UpcomingPanel client={client} name={identity.name} />
        )}
        {tab === "Desktop" && (
          <section className="companion-desktop">
            {browser ? (
              <BrowserTasks
                client={client}
                view={browser}
                paused={Boolean(viewer)}
                onReady={() => {
                  if (!presentWhenReady.current) return;
                  presentWhenReady.current = false;
                  setViewer("control");
                }}
                onOpen={() => setViewer("watch")}
                onNew={() => {
                  if (!waitingInChat) void openBrowser(browser);
                  else
                    setBrowserError(
                      t(
                        "Answer the request waiting in the chat first, then open the browser.",
                      ),
                    );
                }}
                onEnded={(reason) => {
                  presentWhenReady.current = false;
                  setBrowser(undefined);
                  setViewer(undefined);
                  if (reason) setBrowserError(reason);
                }}
              />
            ) : (
              <div className="desktop-stage">
                <div className="desktop-card" aria-hidden="true">
                  <span className="desktop-menubar">{identity.name}</span>
                  <span className="desktop-window">
                    <i />
                    <Globe size={20} strokeWidth={1.4} />
                    <b />
                  </span>
                </div>
                {browserReady ? (
                  <button
                    type="button"
                    className="desktop-open"
                    disabled={waitingInChat}
                    onClick={() => void openBrowser()}
                  >
                    {t("Open browser")}
                    <Maximize2 size={13} strokeWidth={2} />
                  </button>
                ) : (
                  <a
                    className="desktop-open"
                    href="#/studio"
                    aria-label={t("View workspace in MA Studio")}
                    onClick={onClose}
                  >
                    {t("Open workspace")}
                    <Maximize2 size={13} strokeWidth={2} />
                  </a>
                )}
              </div>
            )}
            {browserReady && waitingInChat && !browser && !browserError && (
              <p className="desktop-note">
                {t(
                  "Answer the request waiting in the chat first, then open the browser.",
                )}
              </p>
            )}
            {browserError && (
              <p className="inline-error" role="alert">
                {browserError}
              </p>
            )}
          </section>
        )}
      </div>
      {browser && browser !== "starting" && viewer && (
        <BrowserViewer
          client={client}
          view={browser}
          unavailable={browserUnavailable(events, browser)}
          initialMode={viewer}
          onClose={() => setViewer(undefined)}
          onStopped={() => {
            setViewer(undefined);
            setBrowser(undefined);
          }}
        />
      )}
      {sharing && (
        <AvatarShareSheet
          name={identity.name}
          onClose={() => setSharing(false)}
        />
      )}
      {selected && (
        <IdentityEditor
          key={selected}
          document={identity.documents[selected]}
          name={identity.name}
          signedIn={client.signedIn()}
          client={client}
          onSaved={onIdentity}
          onClose={() => setSelected(undefined)}
        />
      )}
    </dialog>
  );
}

function IdentityEditor({
  document: initial,
  name,
  signedIn,
  client,
  onSaved,
  onClose,
}: {
  document: IdentityDocument;
  name: string;
  signedIn: boolean;
  client: Client;
  onSaved: (identity: CompanionIdentity) => void;
  onClose: () => void;
}) {
  const isName = initial.name === "IDENTITY.md";
  const ref = useRef<HTMLDialogElement>(null);
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(isName ? name : initial.content);
  const [editing, setEditing] = useState(isName && signedIn);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<IdentityDocument>();
  const [discard, setDiscard] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  const originalName = (() => {
    try {
      return JSON.parse(baseline.content).name;
    } catch {
      return name;
    }
  })();
  const dirty = draft !== (isName ? originalName : baseline.content);
  // Other identity fields, such as the avatar, are kept when renaming.
  const savedProfile = () => {
    try {
      const value: unknown = JSON.parse(baseline.content);
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  };
  useEffect(() => {
    alive.current = true;
    const dialog = ref.current!;
    const focused = document.activeElement;
    dialog.showModal();
    dialog.focus();
    return () => {
      alive.current = false;
      dialog.close();
      if (focused instanceof HTMLElement) focused.focus();
    };
  }, []);
  function close() {
    if (pending) return;
    if (editing && dirty) setDiscard(true);
    else onClose();
  }
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    setSaved(false);
    try {
      const result = await client.saveIdentityDocument(
        initial.name,
        isName ? JSON.stringify({ ...savedProfile(), name: draft }) : draft,
        baseline.revision,
      );
      if (!alive.current) return;
      onSaved(result);
      setBaseline(result.documents[initial.name]);
      setDraft(isName ? result.name : result.documents[initial.name].content);
      setEditing(false);
      setSaved(true);
      setLatest(undefined);
    } catch (reason) {
      if (alive.current) setError((reason as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function review() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      const result = await client.companionIdentity();
      if (alive.current) {
        onSaved(result);
        setLatest(result.documents[initial.name]);
      }
    } catch (reason) {
      if (alive.current) setError((reason as Error).message);
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="identity-document"
      tabIndex={-1}
      aria-label={isName ? t("Edit identity") : initial.name}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <button
          className="glass-button"
          aria-label={t("Close identity document")}
          disabled={pending}
          onClick={close}
        >
          <ChevronDown size={22} />
        </button>
        <h2>{isName ? t("Identity") : initial.name}</h2>
        {editing ? (
          <button
            className="document-save"
            aria-label={pending ? t("Saving and verifying") : t("Save")}
            disabled={pending || !signedIn}
            onClick={() => void save()}
          >
            {pending ? <LoaderCircle size={19} className="spin" /> : t("Save")}
          </button>
        ) : (
          <button
            className="glass-button"
            aria-label={t("Edit {name}", { name: initial.name })}
            disabled={!signedIn}
            onClick={() => {
              setEditing(true);
              setSaved(false);
            }}
          >
            <SquarePen size={23} />
          </button>
        )}
      </header>
      <div className={`identity-document-body ${editing ? "editing" : ""}`}>
        {!editing && (
          <aside className="document-about">
            <strong>{t("About this file.")}</strong>{" "}
            {isName
              ? t(
                  "This is your assistant’s name. It is saved with your personal identity and used by conversations with memory attached.",
                )
              : initial.name === "SOUL.md"
                ? t(
                    "This is {name}’s persona: the values and habits that shape each conversation. You can edit it at any time. If your assistant refines it, it should tell you what changed. This note is not part of the file.",
                    { name },
                  )
                : t(
                    "This is {name}’s long-term memory: facts, preferences, and commitments. Conversations with personal memory attached read this file and can update it. Removing an entry does not delete it from earlier conversations. This note is not part of the file.",
                    { name },
                  )}
          </aside>
        )}
        {!editing && !baseline.id && (
          <p className="identity-note">
            {t("Starting template — not saved to the cloud yet.")}
          </p>
        )}
        {saved && (
          <p className="document-saved" role="status">
            {t("Saved and verified in MA")}
          </p>
        )}
        {error && (
          <div className="inline-error" role="alert">
            <p>{error}</p>
            <button disabled={pending} onClick={() => void review()}>
              {t("Review latest saved version")}
            </button>
          </div>
        )}
        {latest && (
          <section className="document-conflict">
            <h3>{t("Latest saved version")}</h3>
            <pre>{latest.content}</pre>
            <p>{t("Your draft below has not changed.")}</p>
            <button
              disabled={pending}
              onClick={() => {
                setBaseline(latest);
                setDraft(
                  isName
                    ? (() => {
                        try {
                          return JSON.parse(latest.content).name ?? "";
                        } catch {
                          return "";
                        }
                      })()
                    : latest.content,
                );
                setLatest(undefined);
                setError("");
              }}
            >
              {t("Replace draft with latest")}
            </button>
          </section>
        )}
        {editing ? (
          <label className="document-field">
            {isName ? t("Name") : t("Document content")}
            {isName ? (
              <input
                aria-label={t("Companion name")}
                autoComplete="off"
                maxLength={40}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={pending}
              />
            ) : (
              <textarea
                aria-label={t("Edit {name} content", { name: initial.name })}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                maxLength={64000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={pending}
              />
            )}
          </label>
        ) : isName ? (
          <h2 className="document-name">{originalName}</h2>
        ) : (
          <Markdown text={baseline.content} />
        )}
        {editing && (
          <button
            className="document-cancel"
            disabled={pending}
            onClick={() => {
              if (dirty) setDiscard(true);
              else {
                setEditing(false);
                setError("");
              }
            }}
          >
            {t("Cancel editing")}
          </button>
        )}
      </div>
      {discard && (
        <div className="document-discard" role="alert">
          <p>{t("Discard your unsaved changes?")}</p>
          <button onClick={() => setDiscard(false)}>{t("Keep editing")}</button>
          <button onClick={onClose}>{t("Discard changes")}</button>
        </div>
      )}
    </dialog>
  );
}

// Whether the agent answered the request that started this view by saying
// this conversation cannot run the cloud browser. The request names the view.
function browserUnavailable(events: AgentEvent[], view: string) {
  let start = -1;
  for (let index = events.length - 1; index >= 0; index--)
    if (
      events[index].app_initiation === "browser" &&
      eventText(events[index]).includes(view)
    ) {
      start = index;
      break;
    }
  if (start < 0) return false;
  return events
    .slice(start + 1)
    .some(
      (event, index, rest) =>
        event.type === "agent.message" &&
        !rest
          .slice(0, index)
          .some((earlier) => earlier.type === "user.message") &&
        /^\s*UNAVAILABLE\b/.test(eventText(event)),
    );
}
