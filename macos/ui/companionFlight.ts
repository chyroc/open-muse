// The companion's portrait travels between the top of the chat and the top of
// the rail when the page changes, instead of disappearing in one place and
// appearing in the other. A copy of the portrait flies from where it was to
// where it now rests while the real one stays hidden, then hands over.
export const companionFlight = {
  durationMs: 420,
  // A spring that settles with a slight overshoot.
  easing: "cubic-bezier(0.34, 1.25, 0.64, 1)",
};

export const companionFaceSelector = (page: string) =>
  page === "chat"
    ? ".toolbar-avatar .companion-portrait"
    : ".rail-companion .companion-portrait";

export function flyCompanion(from: DOMRect, to: HTMLElement) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const end = to.getBoundingClientRect();
  if (!from.width || !end.width) return;
  if (Math.abs(from.left - end.left) + Math.abs(from.top - end.top) < 1) return;
  const copy = to.cloneNode(true) as HTMLElement;
  copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, {
    position: "fixed",
    left: `${end.left}px`,
    top: `${end.top}px`,
    width: `${end.width}px`,
    height: `${end.height}px`,
    margin: "0",
    transform: "none",
    transformOrigin: "top left",
    zIndex: "1000",
    pointerEvents: "none",
  });
  document.body.append(copy);
  to.style.visibility = "hidden";
  const scale = from.width / end.width;
  const animation = copy.animate?.(
    [
      {
        transform: `translate(${from.left - end.left}px, ${from.top - end.top}px) scale(${scale})`,
      },
      { transform: "none" },
    ],
    { duration: companionFlight.durationMs, easing: companionFlight.easing },
  );
  const land = () => {
    copy.remove();
    to.style.visibility = "";
  };
  if (!animation) return land();
  animation.onfinish = land;
  animation.oncancel = land;
}
