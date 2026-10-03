// The pages draw under the window's transparent title bar, so the shell cannot
// see a title bar to drag. Pressing an empty part of the top strip asks the
// shell to move the window, and double-clicking it zooms or minimizes the
// window as the system's title-bar setting says. Controls in the strip keep
// working as before.
export const titleStripHeight = 52;

const interactive = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "dialog",
  "[contenteditable]",
  "[role=button]",
  "[role=tab]",
  "[role=menu]",
  "[role=menuitem]",
  "[role=switch]",
  "[role=slider]",
  "[role=separator]",
  "[data-no-window-drag]",
].join(",");

export function startsWindowDrag(
  event: Pick<MouseEvent, "button" | "clientY" | "target">,
) {
  if (event.button !== 0 || event.clientY > titleStripHeight) return false;
  const target = event.target;
  return !(target instanceof Element && target.closest(interactive));
}

function post(name: "window-drag" | "window-zoom") {
  (
    window as unknown as {
      webkit?: {
        messageHandlers?: { museWindow?: { postMessage: (v: object) => void } };
      };
    }
  ).webkit?.messageHandlers?.museWindow?.postMessage({ name });
}

export function installWindowDrag(target: Document = document) {
  const down = (event: MouseEvent) => {
    if (startsWindowDrag(event)) post("window-drag");
  };
  const double = (event: MouseEvent) => {
    if (startsWindowDrag(event)) post("window-zoom");
  };
  target.addEventListener("mousedown", down, true);
  target.addEventListener("dblclick", double, true);
  return () => {
    target.removeEventListener("mousedown", down, true);
    target.removeEventListener("dblclick", double, true);
  };
}
