import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Plus,
  ClipboardPaste,
  Copy,
  CornerDownLeft,
  Globe,
  Hand,
  Keyboard,
  Lock,
  Square,
  X,
} from "lucide-react";
import { t } from "../shared/i18n";
import type { BrowserEvent } from "../shared/remote-view";
import type { Client } from "./api";
import { animateAway } from "./gesture";
import "./browser-viewer.css";

// How often the view is refreshed while open.
const pollInterval = 600;
// How often a running task's picture is refreshed in the list.
const thumbnailInterval = 2000;
// A helper that has not sent a frame by then is not coming.
const startTimeout = 6 * 60 * 1000;
// Pinching zooms the page in place up to this much.
const maxZoom = 3;

// The latest picture of each view, for its row in the task list.
const thumbnails = new Map<string, string>();
const keepThumbnail = (view: string, image: string) =>
  thumbnails.set(view, `data:image/jpeg;base64,${image}`);

// The running browser as a task: a row with the latest picture of the page
// that reopens the browser, under a header counting the tasks with a button
// for a fresh browser. While the helper starts, the row says so and the
// header spins; the first picture reports the browser ready.
export function BrowserTasks({
  client,
  view,
  paused,
  onReady,
  onOpen,
  onNew,
  onEnded,
}: {
  client: Client;
  // The view's ID, or "starting" while it is being opened.
  view: string;
  // The browser itself is showing and keeps the picture fresh.
  paused: boolean;
  onReady: () => void;
  onOpen: () => void;
  onNew: () => void;
  onEnded: (error?: string) => void;
}) {
  const [thumbnail, setThumbnail] = useState(() => thumbnails.get(view));
  const ready = Boolean(thumbnail);
  const callbacks = useRef({ onReady, onEnded });
  callbacks.current = { onReady, onEnded };
  useEffect(() => {
    setThumbnail(thumbnails.get(view));
    if (view === "starting" || paused) return;
    let active = true;
    let after = 0;
    let shown = thumbnails.has(view);
    const started = Date.now();
    const tick = async () => {
      try {
        const next = await client.browserFrame(view, after);
        if (!active) return;
        if (next.image) {
          after = next.seq;
          keepThumbnail(view, next.image);
          setThumbnail(thumbnails.get(view));
          if (!shown) callbacks.current.onReady();
          shown = true;
        }
        if (!next.open) {
          thumbnails.delete(view);
          callbacks.current.onEnded();
          return;
        }
        if (!shown && Date.now() - started > startTimeout) {
          void client.closeBrowserView(view).catch(() => {});
          callbacks.current.onEnded(
            t("The cloud browser did not start. Try again in a new chat."),
          );
          return;
        }
      } catch (reason) {
        if (!active) return;
        if (!shown) {
          callbacks.current.onEnded((reason as Error).message);
          return;
        }
      }
      if (active)
        timer = setTimeout(tick, shown ? thumbnailInterval : pollInterval);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, view, paused]);
  return (
    <section className="browser-tasks" aria-label={t("Browser tasks")}>
      <header>
        <h3>{t("1 browser task")}</h3>
        {ready ? (
          <button
            type="button"
            className="browser-tasks-new"
            aria-label={t("New browser session")}
            onClick={onNew}
          >
            <Plus size={22} strokeWidth={1.8} />
          </button>
        ) : (
          <span className="browser-tasks-new" role="progressbar">
            <LoaderCircle size={20} className="spin" aria-hidden="true" />
          </span>
        )}
      </header>
      <button
        type="button"
        className="browser-task"
        disabled={!ready}
        onClick={onOpen}
      >
        <span className="browser-task-thumbnail">
          {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : null}
        </span>
        <span className="browser-task-title">
          {ready
            ? t("You can control the browser")
            : t("Starting the browser…")}
        </span>
      </button>
    </section>
  );
}

// The cloud browser, live, in two modes. In control the person's taps, drags
// and typing go to the page; done hands it back and shows the browser with a
// button to take control again and one to stop the task. Closing leaves the
// browser running for the companion; stopping ends the view after asking.
export function BrowserViewer({
  client,
  view,
  unavailable,
  initialMode = "control",
  onClose,
  onStopped,
}: {
  client: Client;
  view: string;
  // The agent reported that this conversation cannot run the browser.
  unavailable: boolean;
  initialMode?: "control" | "watch";
  onClose: () => void;
  onStopped: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const closing = useRef(false);
  const [mode, setMode] = useState(initialMode);
  const [frame, setFrame] = useState<{
    src: string;
    title: string;
    url: string;
  }>();
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [typing, setTyping] = useState<"text" | "address">();
  const [draft, setDraft] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  // Pan and zoom: pinching zooms the picture, and a zoomed picture follows a
  // drag instead of scrolling the page.
  const [panZoom, setPanZoom] = useState(true);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "tap"; x: number; y: number; id: number }
    | { kind: "pan"; x: number; y: number; from: typeof zoom }
    | { kind: "pinch"; distance: number; from: typeof zoom }
    | undefined
  >(undefined);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.focus({ preventScroll: true });
    return () => element.close();
  }, []);
  useEffect(() => {
    let active = true;
    let after = 0;
    const tick = async () => {
      try {
        const next = await client.browserFrame(view, after);
        if (!active) return;
        if (next.image) {
          after = next.seq;
          keepThumbnail(view, next.image);
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
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 1800);
    return () => clearTimeout(timer);
  }, [notice]);
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
  const put = (dismissal: () => void) => {
    if (closing.current) return;
    closing.current = true;
    dialog.current?.classList.add("closing");
    animateAway(dialog.current, "y", 1, dismissal);
  };
  // Closing keeps the browser running; an ended view is also cleaned up.
  const close = () => {
    if (ended) void client.closeBrowserView(view).catch(() => {});
    put(onClose);
  };
  const stop = () => {
    setConfirmStop(false);
    thumbnails.delete(view);
    void client.closeBrowserView(view).catch(() => {});
    put(onStopped);
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
  const copy = () => {
    if (!frame?.url || frame.url === "about:blank") return;
    void navigator.clipboard
      .writeText(frame.url)
      .then(() => setNotice(t("Page link copied")))
      .catch((reason: Error) => setError(reason.message));
  };
  const paste = () => {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (text) send({ type: "text", text });
      })
      .catch((reason: Error) => setError(reason.message));
  };
  const clampZoom = (next: typeof zoom) => {
    const scale = Math.min(maxZoom, Math.max(1, next.scale));
    if (scale === 1) return { scale, x: 0, y: 0 };
    const rect = image.current?.parentElement?.getBoundingClientRect();
    const limitX = rect ? (rect.width * (scale - 1)) / 2 : 0;
    const limitY = rect ? (rect.height * (scale - 1)) / 2 : 0;
    return {
      scale,
      x: Math.min(limitX, Math.max(-limitX, next.x)),
      y: Math.min(limitY, Math.max(-limitY, next.y)),
    };
  };
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onDown = (event: PointerEvent<HTMLImageElement>) => {
    if (mode !== "control") return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (panZoom && pointers.current.size === 2)
      gesture.current = { kind: "pinch", distance: spread(), from: zoom };
    else if (pointers.current.size === 1)
      gesture.current = {
        kind: "tap",
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
      };
  };
  const onMove = (event: PointerEvent<HTMLImageElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const now = gesture.current;
    if (now?.kind === "pinch" && pointers.current.size === 2) {
      setZoom(
        clampZoom({
          ...now.from,
          scale: (now.from.scale * spread()) / now.distance,
        }),
      );
    } else if (
      now?.kind === "tap" &&
      panZoom &&
      zoom.scale > 1 &&
      Math.hypot(event.clientX - now.x, event.clientY - now.y) >= 8
    )
      gesture.current = { kind: "pan", x: now.x, y: now.y, from: zoom };
    else if (now?.kind === "pan")
      setZoom(
        clampZoom({
          ...now.from,
          x: now.from.x + event.clientX - now.x,
          y: now.from.y + event.clientY - now.y,
        }),
      );
  };
  const onUp = (event: PointerEvent<HTMLImageElement>) => {
    pointers.current.delete(event.pointerId);
    const now = gesture.current;
    if (pointers.current.size) return;
    gesture.current = undefined;
    if (now?.kind !== "tap" || now.id !== event.pointerId) return;
    const moved = event.clientY - now.y;
    const point = at(now.x, now.y);
    if (Math.abs(moved) < 8 && Math.abs(event.clientX - now.x) < 8)
      send({ type: "click", x: point.x, y: point.y });
    else
      send({
        type: "scroll",
        x: point.x,
        y: point.y,
        dy: Math.max(-5000, Math.min(5000, -moved * point.scale)),
      });
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
      className={`browser-viewer ${mode}`}
      tabIndex={-1}
      aria-label={t("Cloud browser")}
      onCancel={(event) => {
        event.preventDefault();
        if (confirmStop) setConfirmStop(false);
        else if (mode === "control") setMode("watch");
        else close();
      }}
    >
      <header>
        {mode === "control" ? (
          <h2>{t("You’re in control")}</h2>
        ) : (
          <hgroup>
            <h2>{t("You can control the browser")}</h2>
            <p>{t("Controlled by you")}</p>
          </hgroup>
        )}
        {mode === "control" ? (
          <button
            type="button"
            className="browser-viewer-round"
            aria-label={t("Done controlling the browser")}
            onClick={() => {
              setTyping(undefined);
              setZoom({ scale: 1, x: 0, y: 0 });
              setMode("watch");
            }}
          >
            <Check size={24} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            className="browser-viewer-round"
            aria-label={t("Close")}
            onClick={close}
          >
            <X size={22} strokeWidth={2} />
          </button>
        )}
      </header>
      <div className="browser-viewer-stage">
        {frame && (
          <div
            className="browser-viewer-window"
            style={{
              transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            }}
          >
            <div className="browser-viewer-tabs" aria-hidden="true">
              <span className="browser-viewer-tab">
                <Globe size={11} strokeWidth={2} />
                <span>{frame.title || t("New tab")}</span>
              </span>
            </div>
            <div className="browser-viewer-bar">
              <button
                type="button"
                className="browser-viewer-back"
                aria-label={t("Back")}
                disabled={mode !== "control"}
                onClick={() => send({ type: "back" })}
              >
                <ArrowLeft size={13} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className="browser-viewer-address"
                aria-label={t("Go to address")}
                disabled={mode !== "control"}
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
            </div>
            <img
              ref={image}
              src={frame.src}
              alt={frame.title || t("Cloud browser")}
              draggable={false}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={(event) => {
                pointers.current.delete(event.pointerId);
                gesture.current = undefined;
              }}
            />
          </div>
        )}
        {(status || notice) && (
          <p className="browser-viewer-status" role="status">
            {status || notice}
          </p>
        )}
      </div>
      {typing && mode === "control" && (
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
      {mode === "control" ? (
        <footer>
          <button
            type="button"
            className="browser-viewer-round browser-viewer-stop"
            aria-label={t("Stop task")}
            onClick={() => setConfirmStop(true)}
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
              aria-label={t("Pan and zoom")}
              aria-pressed={panZoom}
              disabled={!frame}
              onClick={() => {
                if (panZoom) setZoom({ scale: 1, x: 0, y: 0 });
                setPanZoom(!panZoom);
              }}
            >
              <Hand size={24} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              aria-label={t("Copy")}
              disabled={!frame?.url || frame.url === "about:blank"}
              onClick={copy}
            >
              <Copy size={22} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              aria-label={t("Paste")}
              disabled={!frame}
              onClick={paste}
            >
              <ClipboardPaste size={22} strokeWidth={1.7} />
            </button>
          </nav>
        </footer>
      ) : (
        <footer className="browser-viewer-actions">
          <button
            type="button"
            className="browser-viewer-take"
            disabled={ended || unavailable}
            onClick={() => setMode("control")}
          >
            {t("Control the browser")}
          </button>
          <button
            type="button"
            className="browser-viewer-end"
            onClick={() => (ended ? stop() : setConfirmStop(true))}
          >
            {t("Stop task")}
          </button>
        </footer>
      )}
      {confirmStop && (
        <div className="browser-viewer-alert-scrim">
          <div
            className="browser-viewer-alert"
            role="alertdialog"
            aria-labelledby="browser-stop-title"
          >
            <h3 id="browser-stop-title">{t("Stop this task?")}</h3>
            <p>
              {t("Your assistant stops where it is. Nothing else changes.")}
            </p>
            <div>
              <button type="button" onClick={() => setConfirmStop(false)}>
                {t("Cancel")}
              </button>
              <button type="button" className="danger" onClick={stop}>
                {t("Stop task")}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
