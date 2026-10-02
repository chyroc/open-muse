import { useCallback, useEffect, useRef, type PointerEvent } from "react";

// Motion and gesture numbers for a side panel pulled in or pushed out from
// its edge. The panel follows the pointer while dragging; a release past the
// threshold settles it, anything shorter springs back.
export const panelEdge = {
  // A press that moves less than this is a click on the edge.
  clickSlop: 4,
  // Pulling a closed panel this far in opens it on release.
  openThreshold: 64,
  // A pulled-in panel is fully opaque after this share of its width.
  fadeEnd: 0.3,
  // Pushing an open panel out closes it once less than this much is left.
  closeRemainder: 20,
  closeOvershoot: 48,
  // Settling after a release.
  settleMs: 220,
  settleEase: "cubic-bezier(0.15, 1, 0.4, 1)",
};

export const panelCloseRemainder = (width: number) =>
  Math.min(
    panelEdge.closeRemainder,
    Math.max(0, width - panelEdge.closeOvershoot),
  );

// How much of a right-side panel a drag from `startX` to `clientX` reveals.
export const panelReveal = (startX: number, clientX: number, width: number) =>
  Math.min(width, Math.max(0, startX - clientX));

export const panelOpacity = (reveal: number, width: number) =>
  width <= 0 ? 1 : Math.min(1, Math.max(0, reveal / width) / panelEdge.fadeEnd);

// Whether pushing an open panel from `startX` to `clientX` leaves so little of
// it that letting go closes it.
export const panelClosePreview = (
  startX: number,
  clientX: number,
  width: number,
) => width + (startX - clientX) <= panelCloseRemainder(width);

export type PanelDrag =
  | { kind: "idle" }
  | { kind: "opening"; reveal: number }
  | { kind: "closing"; preview: boolean };

// A thin strip on the panel's edge: click it to toggle, or drag it.
export function PanelEdgeHandle({
  mode,
  width,
  label,
  onDrag,
  onCommit,
}: {
  mode: "open" | "close";
  width: number;
  label: string;
  onDrag: (drag: PanelDrag) => void;
  onCommit: (open: boolean) => void;
}) {
  const gesture = useRef<{ x: number; y: number; moved: boolean }>(undefined);
  const latest = useRef({ onDrag, onCommit, width });
  latest.current = { onDrag, onCommit, width };
  useEffect(() => () => latest.current.onDrag({ kind: "idle" }), []);
  const move = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const start = gesture.current;
      if (!start) return;
      if (
        Math.abs(event.clientX - start.x) > panelEdge.clickSlop ||
        Math.abs(event.clientY - start.y) > panelEdge.clickSlop
      )
        start.moved = true;
      if (!start.moved) return;
      const { width: size, onDrag: drag } = latest.current;
      drag(
        mode === "open"
          ? {
              kind: "opening",
              reveal: panelReveal(start.x, event.clientX, size),
            }
          : {
              kind: "closing",
              preview: panelClosePreview(start.x, event.clientX, size),
            },
      );
    },
    [mode],
  );
  const end = useCallback(
    (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
      const start = gesture.current;
      if (!start) return;
      gesture.current = undefined;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      const { width: size, onDrag: drag, onCommit: commit } = latest.current;
      drag({ kind: "idle" });
      if (cancelled) return;
      if (!start.moved) return commit(mode === "open");
      if (mode === "open")
        commit(
          panelReveal(start.x, event.clientX, size) >= panelEdge.openThreshold,
        );
      else commit(!panelClosePreview(start.x, event.clientX, size));
    },
    [mode],
  );
  return (
    <div
      className={`panel-edge panel-edge-${mode}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        gesture.current = { x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={move}
      onPointerUp={(event) => end(event)}
      onPointerCancel={(event) => end(event, true)}
    />
  );
}
