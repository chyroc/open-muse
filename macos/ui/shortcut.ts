// The Quick Chat shortcut, held by the native shell as a macOS virtual key
// code plus Carbon modifier flags.
export const carbon = { command: 256, shift: 512, option: 2048, control: 4096 };
export type Shortcut = { code: number; modifiers: number; registered: boolean };

// event.code to macOS virtual key code, for the keys a shortcut may use.
const keyCodes: Record<string, number> = {
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyH: 4,
  KeyG: 5,
  KeyZ: 6,
  KeyX: 7,
  KeyC: 8,
  KeyV: 9,
  KeyB: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyY: 16,
  KeyT: 17,
  Digit1: 18,
  Digit2: 19,
  Digit3: 20,
  Digit4: 21,
  Digit6: 22,
  Digit5: 23,
  Equal: 24,
  Digit9: 25,
  Digit7: 26,
  Minus: 27,
  Digit8: 28,
  Digit0: 29,
  BracketRight: 30,
  KeyO: 31,
  KeyU: 32,
  BracketLeft: 33,
  KeyI: 34,
  KeyP: 35,
  Enter: 36,
  KeyL: 37,
  KeyJ: 38,
  Quote: 39,
  KeyK: 40,
  Semicolon: 41,
  Backslash: 42,
  Comma: 43,
  Slash: 44,
  KeyN: 45,
  KeyM: 46,
  Period: 47,
  Tab: 48,
  Space: 49,
  Backquote: 50,
};
const names: Record<number, string> = Object.fromEntries(
  Object.entries(keyCodes).map(([code, value]) => [
    value,
    code.startsWith("Key")
      ? code.slice(3)
      : code.startsWith("Digit")
        ? code.slice(5)
        : ({
            Equal: "=",
            Minus: "-",
            BracketRight: "]",
            BracketLeft: "[",
            Enter: "↩",
            Quote: "'",
            Semicolon: ";",
            Backslash: "\\",
            Comma: ",",
            Slash: "/",
            Period: ".",
            Tab: "⇥",
            Space: "Space",
            Backquote: "`",
          }[code] ?? code),
  ]),
);

// A recorded key press, or undefined when it cannot be a global shortcut:
// it needs Command, Option or Control, and a key this map knows.
export function recordShortcut(event: {
  code: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}) {
  const code = keyCodes[event.code];
  if (code === undefined || !(event.metaKey || event.altKey || event.ctrlKey))
    return undefined;
  return {
    code,
    modifiers:
      (event.metaKey ? carbon.command : 0) |
      (event.altKey ? carbon.option : 0) |
      (event.ctrlKey ? carbon.control : 0) |
      (event.shiftKey ? carbon.shift : 0),
  };
}

export function shortcutLabel({
  code,
  modifiers,
}: Pick<Shortcut, "code" | "modifiers">) {
  return (
    (modifiers & carbon.control ? "⌃" : "") +
    (modifiers & carbon.option ? "⌥" : "") +
    (modifiers & carbon.shift ? "⇧" : "") +
    (modifiers & carbon.command ? "⌘" : "") +
    (names[code] ?? "?")
  );
}

type Bridge = { postMessage: (value: object) => Promise<unknown> };
function bridge(): Bridge | undefined {
  return (
    window as unknown as {
      webkit?: { messageHandlers?: { museShortcut?: Bridge } };
    }
  ).webkit?.messageHandlers?.museShortcut;
}
export const shortcutAvailable = () => Boolean(bridge());
function parse(value: unknown): Shortcut | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record.code) &&
    Number.isInteger(record.modifiers) &&
    typeof record.registered === "boolean"
    ? {
        code: record.code as number,
        modifiers: record.modifiers as number,
        registered: record.registered,
      }
    : undefined;
}
async function call(body: Record<string, string>) {
  const native = bridge();
  return native ? parse(await native.postMessage(body)) : undefined;
}
export const readShortcut = () => call({ operation: "read" });
export const saveShortcut = (code: number, modifiers: number) =>
  call({
    operation: "write",
    code: String(code),
    modifiers: String(modifiers),
  });
export const resetShortcut = () => call({ operation: "reset" });
