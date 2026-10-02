import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import "./popover-menu.css";

export type PopoverItem =
  | {
      kind: "item";
      label: string;
      icon?: ReactNode;
      checked?: boolean;
      onSelect: () => void;
    }
  | { kind: "header"; label: string }
  | { kind: "separator" };

// A menu that springs open from the header's trailing button: a glass card of
// rows with optional checkmarks, section headers, and separators. Choosing a
// row, tapping outside, or Escape closes it.
export function PopoverMenu({
  label,
  items,
  onClose,
}: {
  label: string;
  items: PopoverItem[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement;
    element.showModal();
    element.focus({ preventScroll: true });
    return () => {
      element.close();
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  const dismiss = (then?: () => void) => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      onClose();
      then?.();
    }, 160);
  };
  const checks = items.some(
    (item) => item.kind === "item" && item.checked !== undefined,
  );
  return (
    <dialog
      ref={dialog}
      className={`popover-menu${closing ? " closing" : ""}`}
      tabIndex={-1}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dismiss();
      }}
    >
      <div className="popover-menu-card" role="menu" aria-label={label}>
        {items.map((item, index) =>
          item.kind === "separator" ? (
            <hr key={index} />
          ) : item.kind === "header" ? (
            <p key={index} className="popover-menu-header">
              {item.label}
            </p>
          ) : (
            <button
              key={index}
              role={item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked={item.checked}
              className={checks ? "with-check" : undefined}
              onClick={() => dismiss(item.onSelect)}
            >
              {checks && (
                <span className="popover-menu-check" aria-hidden="true">
                  {item.checked && <Check size={18} strokeWidth={2.4} />}
                </span>
              )}
              {item.icon}
              <span>{item.label}</span>
            </button>
          ),
        )}
      </div>
    </dialog>
  );
}
