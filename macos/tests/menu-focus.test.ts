import { afterEach, describe, expect, it, vi } from "vitest";
import { focusOpenedMenu, moveMenuFocus } from "../ui/menuFocus";

function menu() {
  const element = document.createElement("div");
  element.setAttribute("role", "menu");
  element.innerHTML =
    '<button role="menuitem">One</button><button role="menuitem" disabled>Off</button><button role="menuitem">Two</button>';
  document.body.append(element);
  return element;
}
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Mac menu focus", () => {
  it("highlights nothing when a click opens the menu, and the arrows still work", () => {
    const element = menu();
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    focusOpenedMenu(element);
    expect(document.activeElement).toBe(element);
    moveMenuFocus(element, 1);
    expect(document.activeElement?.textContent).toBe("One");
    moveMenuFocus(element, 1);
    expect(document.activeElement?.textContent).toBe("Two");
  });
  it("lands on the first entry when the keyboard opens it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    const element = menu();
    focusOpenedMenu(element);
    expect(document.activeElement?.textContent).toBe("One");
    moveMenuFocus(element, -1);
    expect(document.activeElement?.textContent).toBe("Two");
  });
});
