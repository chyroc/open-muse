// Follow the system's accessibility text sizes in the iOS web view. WebKit
// resolves `-apple-system-body` to the body size of the current content size
// category. The everyday sizes, up to the largest standard one (23pt body),
// keep the app's own type scale; the larger accessibility sizes enlarge text
// by how far they exceed it, while fixed layout metrics stay put.
const largestStandardBody = 23;
const adjust = "-webkit-text-size-adjust";

// The text scale for a measured system body size, within sane bounds.
export function textScale(bodySize: number) {
  if (!Number.isFinite(bodySize) || bodySize <= 0) return 1;
  return Math.min(Math.max(bodySize / largestStandardBody, 1), 3);
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

// Android hands the page its text scale, computed from the system font size
// the same way; the WebView enlarges the text itself, so only the layout
// metrics that follow --type-scale need it.
export function followAndroidTextScale(
  root: Root = document.documentElement,
  scale: unknown = (globalThis as { __OPEN_MUSE_TYPE_SCALE__?: unknown })
    .__OPEN_MUSE_TYPE_SCALE__,
) {
  if (typeof scale !== "number" || !Number.isFinite(scale)) return;
  root.style.setProperty(
    "--type-scale",
    String(Math.min(Math.max(scale, 1), 3)),
  );
}
