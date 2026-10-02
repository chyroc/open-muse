// The Mac shell's own presence on the desktop: login item, menu bar icon and
// floating button. These are device-local window preferences held by the native
// shell; they carry no credential, cloud record or identity scope.
export type StartupState =
  "enabled" | "requires-approval" | "not-registered" | "unavailable";

export type Presence = {
  startup: StartupState;
  menuBar: boolean;
  floatingButton: boolean;
};

export type PresenceKey = "startup" | "menuBar" | "floatingButton";

export const presenceChanged = "muse-presence-changed";

type Bridge = { postMessage: (value: object) => Promise<unknown> };

function bridge(): Bridge | undefined {
  return (
    window as unknown as {
      webkit?: { messageHandlers?: { musePresence?: Bridge } };
    }
  ).webkit?.messageHandlers?.musePresence;
}

const startupStates: StartupState[] = [
  "enabled",
  "requires-approval",
  "not-registered",
  "unavailable",
];

export function parsePresence(value: unknown): Presence | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    !startupStates.includes(record.startup as StartupState) ||
    typeof record.menuBar !== "boolean" ||
    typeof record.floatingButton !== "boolean"
  )
    return undefined;
  return {
    startup: record.startup as StartupState,
    menuBar: record.menuBar,
    floatingButton: record.floatingButton,
  };
}

// Outside the Mac app there is no shell to ask, so the rows explain that
// instead of rendering switches that change nothing.
export function presenceAvailable() {
  return Boolean(bridge());
}

export async function readPresence(): Promise<Presence | undefined> {
  const native = bridge();
  if (!native) return undefined;
  return parsePresence(await native.postMessage({ operation: "read" }));
}

// The shell answers with the state it actually reached, which can differ from
// the request: macOS may hold a login item for the user's approval.
export async function writePresence(
  key: PresenceKey,
  value: boolean,
): Promise<Presence | undefined> {
  const native = bridge();
  if (!native) return undefined;
  return parsePresence(
    await native.postMessage({
      operation: "write",
      key,
      value: value ? "true" : "false",
    }),
  );
}

export function openLoginItems() {
  void bridge()?.postMessage({ operation: "login-items" });
}

// After the page removed its logins and records, the shell clears what it keeps
// for this Mac and starts the windows over. Resolves false outside the Mac app.
export async function resetThisMac() {
  const native = bridge();
  if (!native) return false;
  return (await native.postMessage({ operation: "reset" })) === true;
}

export type CompanionState = "" | "thinking" | "speaking";

// Tells the shell the companion's name and what it is doing, for the pill it
// shows while the workspace window is closed.
export function postCompanion(name: string, state: CompanionState) {
  (
    window as unknown as {
      webkit?: {
        messageHandlers?: { museWindow?: { postMessage: (v: object) => void } };
      };
    }
  ).webkit?.messageHandlers?.museWindow?.postMessage({
    name: "companion",
    value: name,
    state,
  });
}
