import { useRef, type PointerEvent, type RefObject } from "react";

// Reads a numeric token from motion.css.
export function motionToken(name: string, fallback: number) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
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
) {
  if (!element) return done();
  const duration = motionToken("--motion-sheet-dismiss-duration", 340);
  element.classList.add("closing");
  if (reducedMotion()) {
    element.style.transition = `opacity ${duration}ms ease-out`;
    element.style.opacity = "0";
  } else {
    element.style.transition = `transform ${duration}ms var(--motion-sheet-ease)`;
    element.style.transform =
      axis === "x"
        ? `translateX(${direction * 100}%)`
        : `translateY(${direction * 100}%)`;
  }
  window.setTimeout(done, duration);
}

// Lets a finger pull a panel along `axis` toward `direction`. The panel tracks
// the finger, resists the other way, and on release either leaves (past the
// distance or flick-speed tokens) or springs back to rest.
export function useDragToDismiss({
  target,
  axis,
  direction,
  onDismiss,
}: {
  target: RefObject<HTMLElement | null>;
  axis: Axis;
  direction: 1 | -1;
  onDismiss: () => void;
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
      onDismiss();
      return;
    }
    element.style.transition =
      "transform var(--motion-release-duration) var(--motion-release-ease)";
    element.style.transform = "";
  }
}
