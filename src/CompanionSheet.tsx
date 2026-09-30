import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Fingerprint,
  Heart,
  History,
  List,
  LoaderCircle,
  MessageCircle,
  Monitor,
  Pencil,
  RefreshCw,
  ShieldCheck,
  SquarePen,
  X,
  Zap,
} from "lucide-react";
import type {
  CompanionIdentity,
  IdentityDocument,
  IdentityDocumentName,
} from "../shared/identity";
import type { AgentEvent, Session } from "../shared/types";
import type { Client } from "./api";
import { CompanionAvatar } from "./ChatUI";
import { Activity, Markdown, PermissionCard } from "./components";
import "./identity.css";

const tabs = [
  { name: "Activity", icon: List },
  { name: "Approvals", icon: ShieldCheck },
  { name: "Desktop", icon: Monitor },
  { name: "Recent", icon: History },
  { name: "Identity", icon: Fingerprint },
] as const;

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
    <section className="identity-overview" aria-label="Personal identity">
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
        <Pencil size={21} /> Edit
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
              aria-label={`Open ${name}`}
              onClick={() => onOpen(name)}
            >
              <strong>{name === "SOUL.md" ? "SOUL" : "Memory"}</strong>
              <span>ACCESS WITH CARE</span>
              <footer>
                <time>
                  {date && Number.isFinite(date.getTime())
                    ? date
                        .toLocaleDateString("en-US", {
                          month: "2-digit",
                          day: "2-digit",
                          year: "2-digit",
                        })
                        .replaceAll("/", ".")
                    : doc.id
                      ? "Saved"
                      : "Not saved yet"}
                </time>
                {name === "SOUL.md" ? (
                  <Heart fill="currentColor" size={25} />
                ) : (
                  <MessageCircle fill="currentColor" size={25} />
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
  sessions,
  events,
  permissions,
  busy,
  onConfirm,
  onNew,
  isMain = false,
}: {
  client: Client;
  identity: CompanionIdentity;
  onIdentity: (identity: CompanionIdentity) => void;
  onClose: () => void;
  status: string;
  sessionId?: string;
  sessions: Session[];
  events: AgentEvent[];
  permissions: AgentEvent[];
  busy: boolean;
  onConfirm: (result: "allow" | "deny", event: AgentEvent) => void;
  onNew: () => void;
  isMain?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]["name"]>("Activity");
  const [selected, setSelected] = useState<IdentityDocumentName>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState<boolean>();
  const [refresh, setRefresh] = useState(0);
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
  }, [client, sessionId, refresh, onIdentity]);
  return (
    <dialog
      ref={dialog}
      className="companion-sheet"
      tabIndex={-1}
      aria-label="Companion details"
      onCancel={(e) => {
        e.preventDefault();
        if (!selected) onClose();
      }}
    >
      <header className="identity-header">
        <button
          className="glass-button identity-dismiss"
          aria-label="Close companion details"
          onClick={onClose}
        >
          <X size={23} />
        </button>
        <div className="identity-avatar">
          <CompanionAvatar />
          <button
            className="glass-button"
            aria-label="Edit companion name"
            disabled={loading || Boolean(error) || !client.signedIn()}
            onClick={() => setSelected("IDENTITY.md")}
          >
            <Pencil size={20} />
          </button>
        </div>
        <h1>{identity.name}</h1>
        <span className="identity-connection">
          <Zap
            size={19}
            fill={status === "Connected" ? "currentColor" : "none"}
          />
          {status}
        </span>
        <button
          className="glass-button identity-refresh"
          aria-label="Refresh companion details"
          disabled={loading}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw size={21} className={loading ? "spin" : undefined} />
        </button>
      </header>
      <nav
        className="companion-tabs"
        role="tablist"
        aria-label="Companion information"
      >
        {tabs.map(({ name, icon: Icon }) => (
          <button
            key={name}
            role="tab"
            aria-label={name}
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
        aria-label={tab}
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
                These are starting templates.{" "}
                <a href="#/settings" onClick={onClose}>
                  Connect to MA
                </a>{" "}
                to save your personal identity.
              </p>
            )}
            {mounted === false && (
              <aside className="identity-note">
                {isMain
                  ? "Personal memory will be connected with your next message. Your main chat keeps its earlier messages and context."
                  : "This older side chat does not have personal memory attached. Its history is unchanged. New side chats can use your saved identity and memory."}
                {!isMain && (
                  <button
                    onClick={() => {
                      onClose();
                      onNew();
                    }}
                  >
                    Start a side chat with memory
                  </button>
                )}
              </aside>
            )}
            {mounted === true && (
              <p className="identity-note">
                Personal memory is attached to this conversation.
              </p>
            )}
          </>
        )}
        {tab === "Activity" && (
          <section className="companion-activity">
            <h2>Activity</h2>
            {events.some((e) => e.type === "agent.tool_use") ? (
              <Activity events={events} running={status === "Replying"} />
            ) : (
              <div className="companion-empty">
                <List size={29} />
                <h3>
                  {status === "Replying"
                    ? "Thinking things through"
                    : "Nothing in progress"}
                </h3>
                <p>Tool activity from this conversation appears here.</p>
              </div>
            )}
          </section>
        )}
        {tab === "Approvals" && (
          <section className="companion-approvals">
            <h2>Approvals</h2>
            {permissions.length ? (
              permissions.map((event) => (
                <PermissionCard
                  key={event.id}
                  event={event}
                  busy={busy}
                  onConfirm={onConfirm}
                />
              ))
            ) : (
              <div className="companion-empty">
                <ShieldCheck size={31} />
                <h3>You’re all caught up</h3>
                <p>
                  No actions are waiting for your approval in this conversation.
                </p>
              </div>
            )}
          </section>
        )}
        {tab === "Desktop" && (
          <section className="companion-empty">
            <Monitor size={32} />
            <h2>Cloud workspace</h2>
            <p>
              Your assistant’s tools run in its MA environment, not on this
              device. An interactive remote desktop is not connected.
            </p>
            <a href="#/studio" onClick={onClose}>
              View workspace in MA Studio
            </a>
          </section>
        )}
        {tab === "Recent" && (
          <section className="companion-recent">
            <h2>Recent conversations</h2>
            {sessions.length ? (
              sessions.slice(0, 20).map((session) => (
                <a
                  href={`#/task/${session.id}`}
                  key={session.id}
                  onClick={onClose}
                >
                  <MessageCircle size={21} />
                  <span>{session.title || "Untitled conversation"}</span>
                </a>
              ))
            ) : (
              <div className="companion-empty">
                <History size={30} />
                <h3>No conversations yet</h3>
              </div>
            )}
          </section>
        )}
      </div>
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
        isName ? JSON.stringify({ name: draft }) : draft,
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
      aria-label={isName ? "Edit identity" : initial.name}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <button
          className="glass-button"
          aria-label="Close identity document"
          disabled={pending}
          onClick={close}
        >
          <ChevronDown size={22} />
        </button>
        <h2>{isName ? "Identity" : initial.name}</h2>
        {editing ? (
          <button
            className="document-save"
            aria-label={pending ? "Saving and verifying" : "Save"}
            disabled={pending || !signedIn}
            onClick={() => void save()}
          >
            {pending ? <LoaderCircle size={19} className="spin" /> : "Save"}
          </button>
        ) : (
          <button
            className="glass-button"
            aria-label={`Edit ${initial.name}`}
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
            <strong>About this file.</strong>{" "}
            {isName
              ? "This is your assistant’s name. It is saved with your personal identity and used by conversations with memory attached."
              : initial.name === "SOUL.md"
                ? `This is ${name}’s persona: the values and habits that shape each conversation. You can edit it at any time. If your assistant refines it, it should tell you what changed. This note is not part of the file.`
                : `This is ${name}’s long-term memory: facts, preferences, and commitments. Conversations with personal memory attached read this file and can update it. Removing an entry does not delete it from earlier conversations. This note is not part of the file.`}
          </aside>
        )}
        {!editing && !baseline.id && (
          <p className="identity-note">
            Starting template — not saved to the cloud yet.
          </p>
        )}
        {saved && (
          <p className="document-saved" role="status">
            Saved and verified in MA
          </p>
        )}
        {error && (
          <div className="inline-error" role="alert">
            <p>{error}</p>
            <button disabled={pending} onClick={() => void review()}>
              Review latest saved version
            </button>
          </div>
        )}
        {latest && (
          <section className="document-conflict">
            <h3>Latest saved version</h3>
            <pre>{latest.content}</pre>
            <p>Your draft below has not changed.</p>
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
              Replace draft with latest
            </button>
          </section>
        )}
        {editing ? (
          <label className="document-field">
            {isName ? "Name" : "Document content"}
            {isName ? (
              <input
                aria-label="Companion name"
                autoComplete="off"
                maxLength={40}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={pending}
              />
            ) : (
              <textarea
                aria-label={`Edit ${initial.name} content`}
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
            Cancel editing
          </button>
        )}
      </div>
      {discard && (
        <div className="document-discard" role="alert">
          <p>Discard your unsaved changes?</p>
          <button onClick={() => setDiscard(false)}>Keep editing</button>
          <button onClick={onClose}>Discard changes</button>
        </div>
      )}
    </dialog>
  );
}
