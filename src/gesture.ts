import { useRef, type PointerEvent, type RefObject } from "react";

// A token's number, with times in milliseconds. CSS minification rewrites
// `320ms` as `.32s`, so seconds are converted rather than read as a bare
// number.
export function tokenNumber(value: string, fallback: number) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  const unit = value.trim().replace(/^[-+.\d]+/, "");
  return unit === "s" ? number * 1000 : number;
}

// Reads a numeric token from motion.css.
export function motionToken(name: string, fallback: number) {
  return tokenNumber(
    getComputedStyle(document.documentElement).getPropertyValue(name),
    fallback,
  );
}

export function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

type Axis = "x" | "y";

function offset(axis: Axis, distance: number) {
  return axis === "x"
    ? `translateX(${distance}px)`
    : `translateY(${distance}px)`;
}

// Moves a panel off screen along `axis` toward `direction` (1 or -1), or fades
// it under Reduce Motion, then calls `done`.
export function animateAway(
  element: HTMLElement | null,
  axis: Axis,
  direction: 1 | -1,
  done: () => void,
  // Sheets leave on the sheet spring; the sidebar on the quicker push spring.
  motion: "sheet" | "push" = "sheet",
) {
  if (!element) return done();
  const duration =
    motion === "push"
      ? motionToken("--motion-push-duration", 320)
      : motionToken("--motion-sheet-dismiss-duration", 300);
  const easing = getComputedStyle(document.documentElement)
    .getPropertyValue(
      motion === "push" ? "--motion-push-ease" : "--motion-sheet-ease",
    )
    .trim();
  element.classList.add("closing");
  // An explicit animation from where the panel is now (including a finger's
  // offset); a CSS transition set in the same frame may not start in WebKit.
  const from = getComputedStyle(element).transform;
  const to =
    axis === "x"
      ? `translateX(${direction * 100}%)`
      : `translateY(${direction * 100}%)`;
  element.style.transition = "none";
  const animation = element.animate(
    reducedMotion()
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [{ transform: from === "none" ? "none" : from }, { transform: to }],
    { duration, easing: easing || "ease-out", fill: "forwards" },
  );
  animation.onfinish = done;
  animation.oncancel = done;
}

// Brings a panel in from off screen along `axis` from `direction` (1 or -1),
// or fades it in under Reduce Motion. Scripted rather than a CSS animation,
// so a later transform from a finger or a dismissal still takes effect.
export function animateIn(
  element: HTMLElement | null,
  axis: Axis,
  direction: 1 | -1,
  motion: "sheet" | "push" = "sheet",
) {
  if (!element) return;
  const duration =
    motion === "push"
      ? motionToken("--motion-push-duration", 320)
      : motionToken("--motion-sheet-duration", 450);
  const easing = getComputedStyle(document.documentElement)
    .getPropertyValue(
      motion === "push" ? "--motion-push-ease" : "--motion-sheet-ease",
    )
    .trim();
  const from =
    axis === "x"
      ? `translateX(${direction * 100}%)`
      : `translateY(${direction * 100}%)`;
  element.animate(
    reducedMotion()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ transform: from }, { transform: "none" }],
    { duration, easing: easing || "ease-out" },
  );
}

// Lets a finger pull a panel along `axis` toward `direction`. The panel tracks
// the finger, resists the other way, and on release either leaves (past the
// distance or flick-speed tokens) or springs back to rest.
export function useDragToDismiss({
  target,
  axis,
  direction,
  onDismiss,
  onProgress,
}: {
  target: RefObject<HTMLElement | null>;
  axis: Axis;
  direction: 1 | -1;
  onDismiss: () => void;
  // How far the panel has been pulled, 0 to 1 of its size, while a finger
  // holds it (dragging true) and when it is let go (dragging false).
  onProgress?: (progress: number, dragging: boolean) => void;
}) {
  const drag = useRef<{
    start: number;
    cross: number;
    time: number;
    distance: number;
    velocity: number;
    active: boolean;
  }>(undefined);
  const main = (event: PointerEvent) =>
    axis === "x" ? event.clientX : event.clientY;
  const cross = (event: PointerEvent) =>
    axis === "x" ? event.clientY : event.clientX;
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("input, textarea")) return;
      drag.current = {
        start: main(event),
        cross: cross(event),
        time: event.timeStamp,
        distance: 0,
        velocity: 0,
        active: false,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const state = drag.current;
      const element = target.current;
      if (!state || !element) return;
      const raw = (main(event) - state.start) * direction;
      if (!state.active) {
        // Start only once the movement is clearly along this axis.
        const across = Math.abs(cross(event) - state.cross);
        if (Math.abs(raw) < 8 || Math.abs(raw) < across) {
          if (across > 12) drag.current = undefined;
          return;
        }
        state.active = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        element.style.transition = "none";
      }
      // The other way resists, as a rubber band.
      const distance = raw < 0 ? -Math.sqrt(-raw) * 2 : raw;
      const elapsed = Math.max(event.timeStamp - state.time, 1);
      state.velocity = (distance - state.distance) / elapsed;
      state.distance = distance;
      state.time = event.timeStamp;
      element.style.transform = offset(axis, distance * direction);
      const size = axis === "x" ? element.offsetWidth : element.offsetHeight;
      onProgress?.(Math.min(Math.max(distance / (size || 1), 0), 1), true);
    },
    onPointerUp: release,
    onPointerCancel: release,
  };
  function release() {
    const state = drag.current;
    drag.current = undefined;
    const element = target.current;
    if (!state?.active || !element) return;
    if (
      state.distance > motionToken("--motion-dismiss-distance", 120) ||
      state.velocity > motionToken("--motion-dismiss-velocity", 0.5)
    ) {
      onProgress?.(1, false);
      onDismiss();
      return;
    }
    onProgress?.(0, false);
    element.style.transition =
      "transform var(--motion-release-duration) var(--motion-release-ease)";
    element.style.transform = "";
  }
}
