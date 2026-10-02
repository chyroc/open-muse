// Follow the system text size (Dynamic Type) in the iOS web view. WebKit
// resolves `-apple-system-body` to the body size of the current content size
// category; text scales by that ratio while fixed layout metrics stay put, as
// native text styles do.
const defaultBodySize = 17;
const adjust = "-webkit-text-size-adjust";

// The text scale for a measured system body size, within sane bounds.
export function textScale(bodySize: number) {
  if (!Number.isFinite(bodySize) || bodySize <= 0) return 1;
  return Math.min(Math.max(bodySize / defaultBodySize, 0.8), 3);
}

function measureBodySize() {
  const probe = document.createElement("span");
  probe.style.font = "-apple-system-body";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.append(probe);
  const size = Number.parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return size;
}

type Root = Pick<HTMLElement, "style">;
type Visibility = Pick<Document, "addEventListener" | "visibilityState">;

export function followDynamicType(
  root: Root = document.documentElement,
  measure: () => number = measureBodySize,
  visibility: Visibility = document,
) {
  const apply = () => {
    // WebKit applies the current adjustment to computed sizes, so measure
    // without it; otherwise each return to the app would compound the scale.
    root.style.removeProperty(adjust);
    const scale = textScale(measure());
    root.style.setProperty("--type-scale", String(scale));
    root.style.setProperty(adjust, `${Math.round(scale * 100)}%`);
  };
  apply();
  // The category can change while the app is in the background.
  visibility.addEventListener("visibilitychange", () => {
    if (visibility.visibilityState === "visible") apply();
  });
}
