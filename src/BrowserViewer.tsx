import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CornerDownLeft,
  Globe,
  Keyboard,
  LoaderCircle,
  Lock,
  Square,
} from "lucide-react";
import { t } from "../shared/i18n";
import type { BrowserEvent } from "../shared/remote-view";
import type { Client } from "./api";
import { animateAway } from "./gesture";
import "./browser-viewer.css";

// How often the view is refreshed while open.
const pollInterval = 600;
// A helper that has not sent a frame by then is not coming.
const startTimeout = 6 * 60 * 1000;

// The cloud browser, live: what the helper in the sandbox shows, with taps,
// drags, typing and addresses sent back to it. Closing ends the view, which
// stops the helper.
export function BrowserViewer({
  client,
  view,
  unavailable,
  onClose,
}: {
  client: Client;
  view: string;
  // The agent reported that this conversation cannot run the browser.
  unavailable: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const closing = useRef(false);
  const [frame, setFrame] = useState<{
    src: string;
    title: string;
    url: string;
  }>();
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState("");
  const [typing, setTyping] = useState<"text" | "address">();
  const [draft, setDraft] = useState("");
  const pointer = useRef<{ x: number; y: number; id: number } | undefined>(
    undefined,
  );
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.focus({ preventScroll: true });
    return () => element.close();
  }, []);
  useEffect(() => {
    let active = true;
    let after = 0;
    let shown = false;
    const started = Date.now();
    const tick = async () => {
      try {
        const next = await client.browserFrame(view, after);
        if (!active) return;
        if (next.image) {
          after = next.seq;
          shown = true;
          setFrame({
            src: `data:image/jpeg;base64,${next.image}`,
            title: next.title ?? "",
            url: next.url ?? "",
          });
        }
        if (!next.open) {
          setEnded(true);
          return;
        }
        if (!shown && Date.now() - started > startTimeout) {
          setError(
            t("The cloud browser did not start. Try again in a new chat."),
          );
          return;
        }
      } catch (reason) {
        if (active) setError((reason as Error).message);
      }
      if (active) timer = setTimeout(tick, pollInterval);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, view]);
  const send = (...events: BrowserEvent[]) => {
    void client.browserInput(view, events).catch((reason: Error) => {
      setError(reason.message);
    });
  };
  // A point on the frame, as fractions of its width and height.
  const at = (clientX: number, clientY: number) => {
    const rect = image.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      scale: image.current!.naturalWidth / rect.width,
    };
  };
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    void client.closeBrowserView(view).catch(() => {});
    dialog.current?.classList.add("closing");
    animateAway(dialog.current, "y", 1, onClose);
  };
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (typing === "address") {
      const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      send({ type: "navigate", url });
      setTyping(undefined);
    } else send({ type: "text", text: draft });
    setDraft("");
  };
  const status = unavailable
    ? t(
        "This conversation cannot run the cloud browser. Start a new chat and try again.",
      )
    : error ||
      (ended
        ? t("The cloud browser view has ended.")
        : !frame
          ? t("Starting the browser…")
          : "");
  return (
    <dialog
      ref={dialog}
      className="browser-viewer"
      tabIndex={-1}
      aria-label={t("Cloud browser")}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <header>
        <h2>{t("You’re in control")}</h2>
        <button
          type="button"
          className="browser-viewer-round"
          aria-label={t("Done controlling the browser")}
          onClick={dismiss}
        >
          <Check size={24} strokeWidth={2} />
        </button>
      </header>
      <div className="browser-viewer-stage">
        {frame && (
          <div className="browser-viewer-window">
            <div className="browser-viewer-tabs" aria-hidden="true">
              <span className="browser-viewer-tab">
                <Globe size={11} strokeWidth={2} />
                <span>{frame.title || t("New tab")}</span>
              </span>
            </div>
            <button
              type="button"
              className="browser-viewer-address"
              aria-label={t("Go to address")}
              onClick={() => setTyping("address")}
            >
              {frame.url.startsWith("https://") && (
                <Lock size={11} strokeWidth={2.2} />
              )}
              <span>
                {frame.url && frame.url !== "about:blank"
                  ? frame.url.replace(/^https?:\/\//, "").replace(/\/$/, "")
                  : t("Search or type a web address")}
              </span>
            </button>
            <img
              ref={image}
              src={frame.src}
              alt={frame.title || t("Cloud browser")}
              draggable={false}
              onPointerDown={(event) => {
                pointer.current = {
                  x: event.clientX,
                  y: event.clientY,
                  id: event.pointerId,
                };
              }}
              onPointerUp={(event) => {
                const start = pointer.current;
                pointer.current = undefined;
                if (!start || start.id !== event.pointerId) return;
                const moved = event.clientY - start.y;
                const point = at(start.x, start.y);
                if (
                  Math.abs(moved) < 8 &&
                  Math.abs(event.clientX - start.x) < 8
                )
                  send({ type: "click", x: point.x, y: point.y });
                else
                  send({
                    type: "scroll",
                    x: point.x,
                    y: point.y,
                    dy: Math.max(-5000, Math.min(5000, -moved * point.scale)),
                  });
              }}
            />
          </div>
        )}
        {status && (
          <p className="browser-viewer-status" role="status">
            {!frame && !error && !ended && !unavailable && (
              <LoaderCircle size={18} className="spin" />
            )}
            {status}
          </p>
        )}
      </div>
      {typing && (
        <form
          className="browser-viewer-entry"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            value={draft}
            inputMode={typing === "address" ? "url" : "text"}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={
              typing === "address" ? t("Go to address") : t("Type in the page")
            }
            aria-label={
              typing === "address" ? t("Go to address") : t("Type in the page")
            }
            onChange={(event) => setDraft(event.target.value)}
          />
          {typing === "text" && (
            <button
              type="button"
              aria-label={t("Return key")}
              onClick={() => send({ type: "key", key: "Enter" })}
            >
              <CornerDownLeft size={20} />
            </button>
          )}
        </form>
      )}
      <footer>
        <button
          type="button"
          className="browser-viewer-round browser-viewer-stop"
          aria-label={t("End the cloud browser")}
          onClick={dismiss}
        >
          <Square size={14} fill="currentColor" strokeWidth={0} />
        </button>
        <nav className="browser-viewer-tools">
          <button
            type="button"
            aria-label={t("Keyboard")}
            aria-pressed={typing === "text"}
            disabled={!frame}
            onClick={() => setTyping(typing === "text" ? undefined : "text")}
          >
            <Keyboard size={24} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            aria-label={t("Back")}
            disabled={!frame}
            onClick={() => send({ type: "back" })}
          >
            <ArrowLeft size={24} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            aria-label={t("Go to address")}
            aria-pressed={typing === "address"}
            disabled={!frame}
            onClick={() =>
              setTyping(typing === "address" ? undefined : "address")
            }
          >
            <Globe size={23} strokeWidth={1.7} />
          </button>
        </nav>
      </footer>
    </dialog>
  );
}
