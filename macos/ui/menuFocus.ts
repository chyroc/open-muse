// Where focus goes when a menu opens. Opened from the keyboard, it lands on
// the first entry; opened with the pointer, the menu holds focus itself, so
// nothing is highlighted and the arrow keys still reach its entries.
let lastPointer = 0;
if (typeof window !== "undefined")
  window.addEventListener(
    "pointerdown",
    () => {
      lastPointer = Date.now();
    },
    true,
  );

// A menu's entries that can take focus, in order.
function entries(menu: HTMLElement) {
  return [
    ...menu.querySelectorAll<HTMLElement>('button, [role^="menuitem"]'),
  ].filter(
    (item) =>
      !item.matches(":disabled") &&
      item.getAttribute("aria-disabled") !== "true",
  );
}

export function focusOpenedMenu(menu: HTMLElement | null | undefined) {
  if (!menu) return;
  if (Date.now() - lastPointer < 1000) {
    if (!menu.hasAttribute("tabindex")) menu.tabIndex = -1;
    menu.focus({ preventScroll: true });
  } else entries(menu)[0]?.focus({ preventScroll: true });
}

// Arrow keys move between a menu's entries, starting from the menu itself.
export function moveMenuFocus(
  menu: HTMLElement | null | undefined,
  step: number,
) {
  const items = menu ? entries(menu) : [];
  if (!items.length) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    at < 0
      ? step > 0
        ? 0
        : items.length - 1
      : (at + step + items.length) % items.length;
  items[next]?.focus({ preventScroll: true });
}
