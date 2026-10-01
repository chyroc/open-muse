import { t } from "../../shared/i18n";
import { Modal } from "./Chrome";

// Every shortcut this workspace answers, in the order people reach for them.
export const shortcuts: { keys: string; label: string }[] = [
  { keys: "⌘K", label: "Search chats" },
  { keys: "⌘N", label: "New side chat" },
  { keys: "⌘1", label: "Main chat" },
  { keys: "⌘J", label: "Jump to the main chat" },
  { keys: "⌘F", label: "Find in the chat" },
  { keys: "⌘,", label: "Settings" },
  { keys: "⌘/", label: "Keyboard shortcuts" },
  { keys: "⇧⎋", label: "Focus the message field" },
  { keys: "⎋", label: "Stop the response" },
  { keys: "↩", label: "Send" },
  { keys: "⇧↩", label: "New line" },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title={t("Keyboard shortcuts")}
      className="shortcuts-dialog"
      onClose={onClose}
    >
      <dl>
        {shortcuts.map(({ keys, label }) => (
          <div key={keys}>
            <dt>{t(label)}</dt>
            <dd>
              <kbd>{keys}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
