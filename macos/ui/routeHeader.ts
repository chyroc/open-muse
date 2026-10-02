import { useCallback, useRef } from "react";

// A page's large title collapses over its first stretch of scrolling: the
// title shrinks toward the leading edge, the header's background and hairline
// fade in, and the description fades out. The progress is written to the
// scroller as `--route-collapse`, from 0 at the top to 1 once collapsed.
export const routeHeader = {
  range: 64,
  collapsedScale: 24 / 34,
};

export const routeCollapse = (scrollTop: number) =>
  Math.min(1, Math.max(0, scrollTop / routeHeader.range));

export function useRouteHeader<T extends HTMLElement>() {
  const detach = useRef<() => void>(undefined);
  return useCallback((scroller: T | null) => {
    detach.current?.();
    detach.current = undefined;
    if (!scroller) return;
    let frame = 0;
    let last = -1;
    const apply = () => {
      frame = 0;
      const value = routeCollapse(scroller.scrollTop);
      if (value === last) return;
      last = value;
      scroller.style.setProperty("--route-collapse", String(value));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    scroller.addEventListener("scroll", schedule, { passive: true });
    detach.current = () => {
      scroller.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
