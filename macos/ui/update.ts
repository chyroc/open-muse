// Updates for the Mac app itself. The native shell checks the website,
// downloads and verifies a new release, and replaces the app when it quits;
// the page shows where that stands and passes on what the person asks for.
export type UpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "failed";

export type UpdateState = {
  // Only released builds update themselves.
  supported: boolean;
  phase: UpdatePhase;
  automatic: boolean;
  // The app sits where it can replace itself.
  installable: boolean;
  progress: number;
  version?: string;
  build?: number;
  checkedAt?: number;
  failure?: "check" | "download" | "verify";
};

export type UpdateOperation = "read" | "check" | "download" | "restart";

export const updateChanged = "muse-update-changed";
// The app menu's Check for Updates brings the rows into view.
export const updateReveal = "muse-update-reveal";

type Bridge = { postMessage: (value: object) => Promise<unknown> };

function bridge(): Bridge | undefined {
  return (
    window as unknown as {
      webkit?: { messageHandlers?: { museUpdate?: Bridge } };
    }
  ).webkit?.messageHandlers?.museUpdate;
}

const phases: UpdatePhase[] = [
  "idle",
  "checking",
  "current",
  "available",
  "downloading",
  "ready",
  "failed",
];
const failures = ["check", "download", "verify"];

export function parseUpdate(value: unknown): UpdateState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.supported !== "boolean" ||
    !phases.includes(record.phase as UpdatePhase) ||
    typeof record.automatic !== "boolean" ||
    typeof record.installable !== "boolean"
  )
    return undefined;
  const progress = Number(record.progress);
  return {
    supported: record.supported,
    phase: record.phase as UpdatePhase,
    automatic: record.automatic,
    installable: record.installable,
    progress: Number.isFinite(progress)
      ? Math.min(1, Math.max(0, progress))
      : 0,
    version: typeof record.version === "string" ? record.version : undefined,
    build: typeof record.build === "number" ? record.build : undefined,
    checkedAt:
      typeof record.checkedAt === "number" ? record.checkedAt : undefined,
    failure: failures.includes(record.failure as string)
      ? (record.failure as UpdateState["failure"])
      : undefined,
  };
}

export function updatesAvailable() {
  return Boolean(bridge());
}

export async function sendUpdate(
  operation: UpdateOperation,
): Promise<UpdateState | undefined> {
  const native = bridge();
  if (!native) return undefined;
  return parseUpdate(await native.postMessage({ operation }));
}

export async function setAutomaticUpdates(
  value: boolean,
): Promise<UpdateState | undefined> {
  const native = bridge();
  if (!native) return undefined;
  return parseUpdate(
    await native.postMessage({
      operation: "automatic",
      value: value ? "true" : "false",
    }),
  );
}
