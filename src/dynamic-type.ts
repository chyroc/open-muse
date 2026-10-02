// Follow the system text size (Dynamic Type) in the iOS web view. WebKit
// resolves `-apple-system-body` to the body size of the current content size
// category; text scales by that ratio while fixed layout metrics stay put, as
// native text styles do.
const defaultBodySize = 17;

export function systemTextScale() {
  const probe = document.createElement("span");
  probe.style.font = "-apple-system-body";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.append(probe);
  const size = Number.parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  if (!Number.isFinite(size) || size <= 0) return 1;
  return Math.min(Math.max(size / defaultBodySize, 0.8), 3);
}

export function followDynamicType(root = document.documentElement) {
  const apply = () => {
    const scale = systemTextScale();
    root.style.setProperty("--type-scale", String(scale));
    root.style.setProperty(
      "-webkit-text-size-adjust",
      `${Math.round(scale * 100)}%`,
    );
  };
  apply();
  // The category can change while the app is in the background.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") apply();
  });
}
