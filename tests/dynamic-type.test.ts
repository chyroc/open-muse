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
  it("keeps the type scale at everyday sizes and enlarges only accessibility sizes", () => {
    // Every standard category, from xSmall (14pt) to xxxLarge (23pt).
    for (const body of [14, 15, 16, 17, 19, 21, 23])
      expect(textScale(body)).toBe(1);
    // Accessibility categories enlarge by how far they exceed 23pt.
    expect(textScale(28)).toBeCloseTo(28 / 23);
    expect(textScale(53)).toBeCloseTo(53 / 23);
    expect(textScale(Number.NaN)).toBe(1);
    expect(textScale(200)).toBe(3);
  });
  it("keeps the same scale however often the app returns to the foreground", () => {
    const view = fakeWebView(33);
    view.start();
    expect(view.props.get("-webkit-text-size-adjust")).toBe("143%");
    for (let i = 0; i < 5; i++) view.returnToApp();
    expect(view.props.get("-webkit-text-size-adjust")).toBe("143%");
    expect(Number(view.props.get("--type-scale"))).toBeCloseTo(33 / 23);
  });
});
