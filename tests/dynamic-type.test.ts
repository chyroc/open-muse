import { describe, expect, it } from "vitest";
import { followDynamicType, textScale } from "../src/dynamic-type";

// A root whose measured body size includes its current text-size-adjust, as
// WebKit reports computed sizes.
function fakeWebView(systemBodySize: number) {
  const props = new Map<string, string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => void props.set(name, value),
      removeProperty: (name: string) => {
        const value = props.get(name) ?? "";
        props.delete(name);
        return value;
      },
    },
  } as unknown as HTMLElement;
  const measure = () =>
    systemBodySize *
    (Number.parseFloat(props.get("-webkit-text-size-adjust") ?? "100") / 100);
  const listeners: (() => void)[] = [];
  const visibility = {
    visibilityState: "visible",
    addEventListener: (_: string, listener: () => void) =>
      void listeners.push(listener),
  } as unknown as Document;
  return {
    props,
    start: () => followDynamicType(root, measure, visibility),
    returnToApp: () => listeners.forEach((listener) => listener()),
  };
}

describe("Dynamic Type", () => {
  it("scales text by the system body size against the default 17pt", () => {
    expect(textScale(17)).toBe(1);
    expect(textScale(19)).toBeCloseTo(19 / 17);
    expect(textScale(Number.NaN)).toBe(1);
    expect(textScale(200)).toBe(3);
  });
  it("keeps the same scale however often the app returns to the foreground", () => {
    const view = fakeWebView(19);
    view.start();
    expect(view.props.get("-webkit-text-size-adjust")).toBe("112%");
    for (let i = 0; i < 5; i++) view.returnToApp();
    expect(view.props.get("-webkit-text-size-adjust")).toBe("112%");
    expect(Number(view.props.get("--type-scale"))).toBeCloseTo(19 / 17);
  });
});
