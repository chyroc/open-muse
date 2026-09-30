import { t } from "../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { Editor } from "@tiptap/core";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  PanelLeft,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import type { Client } from "../../src/api";
import type {
  CompanionIdentity,
  IdentityDocument,
} from "../../shared/identity";
import { Markdown as MarkdownView } from "../../src/components";
import { Modal } from "./Chrome";
import { editorExtensions, sourceOnly } from "./markdown";

const descriptions = {
  "SOUL.md": t(
    "This file shapes your assistant's values, personality, and habits. You can edit it; the assistant also uses it as a guide in each conversation.",
  ),
  "MEMORY.md": t(
    "This file holds the facts, preferences, and commitments your assistant remembers. Editing it changes durable memory, not the text of earlier conversations.",
  ),
  "IDENTITY.md": t(
    "This file stores the assistant's name. The current MA identity format is a JSON object with a name property. Other persona details belong in SOUL.md.",
  ),
};

export function DocumentEditor({
  initial,
  client,
  connected,
  onSaved,
  onClose,
  onChat,
}: {
  initial: IdentityDocument;
  client: Pick<Client, "saveIdentityDocument" | "companionIdentity">;
  connected: boolean;
  onSaved: (identity: CompanionIdentity) => void;
  onClose: () => void;
  onChat: () => void;
}) {
  const [baseline, setBaseline] = useState(initial);
  const [content, setContent] = useState(initial.content);
  const [source, setSource] = useState(() =>
    sourceOnly(initial.content, initial.name),
  );
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<CompanionIdentity>();
  const [closeRequested, setCloseRequested] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [, redraw] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | undefined>(undefined);
  const contentRef = useRef(content);
  contentRef.current = content;
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const dirty = content.trim() !== baseline.content.trim();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    // The native window guard dispatches this only after its discard action.
    const discard = () => onClose();
    window.addEventListener("muse-discard-document", discard);
    return () => window.removeEventListener("muse-discard-document", discard);
  }, [onClose]);
  useEffect(() => {
    if (source || !host.current) return;
    const instance = new Editor({
      element: host.current,
      extensions: editorExtensions(),
      content: contentRef.current,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: "rich-document",
          role: "textbox",
          "aria-label": t("Edit {name}", { name: initial.name }),
          "aria-multiline": "true",
          spellcheck: "true",
        },
        handleKeyDown: (_view, event) => {
          if (event.metaKey && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void saveRef.current();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        setContent(editor.getMarkdown());
        setSaveStatus("");
      },
      onSelectionUpdate: () => redraw((value) => value + 1),
    });
    editor.current = instance;
    return () => {
      instance.destroy();
      editor.current = undefined;
    };
  }, [source, initial.name]);
  useEffect(() => {
    editor.current?.setEditable(!saving);
  }, [saving]);
  useEffect(() => {
    const desktopWindow = window as Window & {
      __OPEN_MUSE_HAS_UNSAVED_DOCUMENT__?: boolean;
      __OPEN_MUSE_DOCUMENT_SAVING__?: boolean;
    };
    desktopWindow.__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__ = dirty || saving;
    desktopWindow.__OPEN_MUSE_DOCUMENT_SAVING__ = saving;
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty || saving) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const shortcut = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("keydown", shortcut);
      desktopWindow.__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__ = false;
      desktopWindow.__OPEN_MUSE_DOCUMENT_SAVING__ = false;
    };
  }, [dirty, saving]);

  async function save() {
    if (busyRef.current || !dirty || !connected) return;
    busyRef.current = true;
    setSaving(true);
    setError("");
    setSaveStatus("");
    try {
      const identity = await client.saveIdentityDocument(
        initial.name,
        content,
        baseline.revision,
      );
      if (!mounted.current) return;
      const saved = identity.documents[initial.name];
      setBaseline(saved);
      setContent(saved.content);
      setSaveStatus(t("Saved and verified"));
      onSaved(identity);
      // Reflect server canonicalization without introducing a new edit.
      editor.current?.commands.setContent(saved.content, {
        contentType: "markdown",
        emitUpdate: false,
      });
    } catch (reason) {
      if (mounted.current) setError((reason as Error).message);
    } finally {
      busyRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  saveRef.current = save;
  async function inspectLatest() {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError("");
    try {
      const value = await client.companionIdentity();
      if (mounted.current) setLatest(value);
    } catch (reason) {
      if (mounted.current) setError((reason as Error).message);
    } finally {
      busyRef.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  function useLatest() {
    if (!latest) return;
    const doc = latest.documents[initial.name];
    setBaseline(doc);
    setContent(doc.content);
    onSaved(latest);
    setLatest(undefined);
    setSaveStatus("");
    if (sourceOnly(doc.content, doc.name)) setSource(true);
    else
      editor.current?.commands.setContent(doc.content, {
        contentType: "markdown",
        emitUpdate: false,
      });
  }
  const close = () => {
    if (saving) return;
    if (dirty) setCloseRequested(true);
    else onClose();
  };
  const format = (
    command: "bold" | "italic" | "bullet" | "ordered" | 1 | 2 | 3,
  ) => {
    const chain = editor.current?.chain().focus();
    if (!chain) return;
    if (typeof command === "number")
      chain.toggleHeading({ level: command }).run();
    else if (command === "bold") chain.toggleBold().run();
    else if (command === "italic") chain.toggleItalic().run();
    else if (command === "bullet") chain.toggleBulletList().run();
    else chain.toggleOrderedList().run();
    redraw((value) => value + 1);
  };
  const tools = [
    { label: t("Bold"), Icon: Bold, command: "bold" },
    { label: t("Italic"), Icon: Italic, command: "italic" },
    { label: t("Heading 1"), Icon: Heading1, command: 1 },
    { label: t("Heading 2"), Icon: Heading2, command: 2 },
    { label: t("Heading 3"), Icon: Heading3, command: 3 },
    { label: t("Bullet list"), Icon: List, command: "bullet" },
    { label: t("Numbered list"), Icon: ListOrdered, command: "ordered" },
  ] as const;

  return (
    <section
      className="document-workspace"
      aria-label={t("{name} editor", { name: initial.name })}
    >
      <header className="document-toolbar">
        <button
          className="icon-button"
          title={t("Return to chat")}
          aria-label={t("Return to chat")}
          disabled={saving}
          onClick={() => {
            if (dirty) setCloseRequested(true);
            else onChat();
          }}
        >
          <PanelLeft size={21} />
        </button>
        <strong>{initial.name}</strong>
        <div
          className="format-tools"
          role="toolbar"
          aria-label={t("Text formatting")}
        >
          {tools.map(({ label, Icon, command }) => (
            <button
              className="icon-button"
              key={label}
              aria-label={label}
              title={label}
              disabled={source || saving}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format(command)}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
        <div className="document-actions">
          <button
            className="icon-button"
            aria-label={t("View Markdown source")}
            title={t("View Markdown source")}
            aria-pressed={source}
            disabled={saving || sourceOnly(content, initial.name)}
            onClick={() => setSource((value) => !value)}
          >
            <Code size={19} />
          </button>
          <button
            className="icon-button"
            aria-label={t("Review latest cloud version")}
            title={t("Review latest cloud version")}
            disabled={saving || loading || !connected}
            onClick={() => void inspectLatest()}
          >
            <RefreshCw size={17} />
          </button>
          {dirty && (
            <button
              className="pill-button document-save"
              aria-label={t("Save document")}
              disabled={saving || !connected}
              onClick={() => void save()}
            >
              <Save size={15} />
              {saving ? t("Saving…") : t("Save")}
            </button>
          )}
          <button
            className="icon-button"
            aria-label={t("Close document")}
            disabled={saving}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div className="document-scroll">
        <div className="document-paper">
          <blockquote className="document-description">
            <strong>{t("About this file.")} </strong>
            {descriptions[initial.name]}{" "}
            <em>{t("This note is not part of the file.")}</em>
          </blockquote>
          {!connected && (
            <p className="document-notice">
              {t(
                "Not connected. You can inspect the template; connect in Settings before saving.",
              )}
            </p>
          )}
          {source ? (
            <textarea
              className="document-source"
              aria-label={t("Edit {name}", { name: initial.name })}
              spellCheck={false}
              disabled={saving}
              value={content}
              maxLength={64000}
              onChange={(event) => {
                setContent(event.target.value);
                setSaveStatus("");
              }}
            />
          ) : (
            <div ref={host} />
          )}
          {error && (
            <div role="alert" className="document-error">
              <p>{error}</p>
              <p>
                {t(
                  "Your draft is still here. Review the latest cloud version before trying again.",
                )}
              </p>
              <button
                className="pill-button"
                disabled={loading}
                onClick={() => void inspectLatest()}
              >
                {t("Review latest version")}
              </button>
            </div>
          )}
          <p role="status" className="document-save-status">
            {saving
              ? t("Saving and verifying in MA…")
              : dirty
                ? t("Unsaved changes · ⌘S to save")
                : saveStatus}
          </p>
        </div>
      </div>
      {closeRequested && (
        <Modal
          title={t("Unsaved changes")}
          onClose={() => setCloseRequested(false)}
        >
          <p>
            {t(
              "Keep editing, or close without saving your changes to {name}.",
              { name: initial.name },
            )}
          </p>
          <div className="document-confirm-actions">
            <button
              className="pill-button"
              onClick={() => setCloseRequested(false)}
            >
              {t("Keep editing")}
            </button>
            <button className="pill-button" onClick={onClose}>
              {t("Discard draft")}
            </button>
            <button
              className="button primary"
              disabled={!connected || saving}
              onClick={() => {
                setCloseRequested(false);
                void save();
              }}
            >
              {t("Save and keep open")}
            </button>
          </div>
        </Modal>
      )}
      {latest && (
        <Modal
          title={t("Latest cloud version")}
          wide
          onClose={() => setLatest(undefined)}
        >
          <p>
            {t(
              "Your draft has not been changed. This is the latest saved copy of {name}.",
              { name: initial.name },
            )}
          </p>
          <div className="latest-document">
            <MarkdownView text={latest.documents[initial.name].content} />
          </div>
          <div className="document-confirm-actions">
            <button
              className="pill-button"
              onClick={() => setLatest(undefined)}
            >
              {t("Keep my draft")}
            </button>
            <button className="button primary" onClick={useLatest}>
              {t("Replace draft with latest")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
