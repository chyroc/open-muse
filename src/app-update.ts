import { CapacitorHttp } from "@capacitor/core";
import { z } from "zod";
import { appSurface } from "./platform";

// Updates for the iPhone and Android apps. Each asks the website's update
// feed for its newest release, at launch and on returning to the app (at most
// every six hours) or when the person checks in About. The iPhone app is
// updated through TestFlight, so an update opens TestFlight. The Android app
// is installed from the website, so it downloads the release in the
// background (unless turned off), and the native side keeps it only when it
// matches the feed and carries this app's own signature, then hands it to
// the system installer, which asks the person. The feed is read natively, so
// neither the page's content policy nor the mirror's lack of CORS stands in
// the way; the mainland China mirror answers when the main site cannot.
export type UpdatePlatform = "ios" | "android";
const feedSchema = z.object({
  version: z.string().min(1).max(60),
  build: z.number().int().positive(),
  url: z
    .string()
    .max(300)
    .regex(/^https:\/\/[\w.-]+\/[\w./-]*$/),
  size: z.number().int().positive().optional(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type UpdateFeed = z.infer<typeof feedSchema>;
export type UpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "failed";
export type UpdateState = {
  phase: UpdatePhase;
  feed?: UpdateFeed;
  // Android asked the person to allow installs from this app first.
  permission?: boolean;
  failure?: "check" | "download" | "install";
};

const origins = ["https://getopenmuse.com", "https://cn.getopenmuse.com"];
const interval = 6 * 60 * 60 * 1000;
const checkedKey = "open-muse:update-checked:v1";
const dismissedKey = "open-muse:update-dismissed:v1";
const automaticKey = "open-muse:update-automatic:v1";

export function updatePlatform(): UpdatePlatform | undefined {
  const surface = appSurface();
  return surface === "iphone"
    ? "ios"
    : surface === "android"
      ? "android"
      : undefined;
}

// This app's build number, injected by the native shell; 0 outside one.
export function currentBuild() {
  const build = (globalThis as { __OPEN_MUSE_BUILD__?: unknown })
    .__OPEN_MUSE_BUILD__;
  return typeof build === "number" && Number.isSafeInteger(build) && build > 0
    ? build
    : 0;
}

export function parseFeed(value: unknown): UpdateFeed | undefined {
  let data = value;
  if (typeof data === "string")
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  return feedSchema.safeParse(data).data;
}

export async function readFeed(platform: UpdatePlatform) {
  for (const origin of origins) {
    try {
      const response = await CapacitorHttp.get({
        url: `${origin}/download/${platform}.json`,
        connectTimeout: 10_000,
        readTimeout: 10_000,
        headers: { Accept: "application/json" },
      });
      const feed =
        response.status === 200 ? parseFeed(response.data) : undefined;
      if (feed) return feed;
    } catch {
      /* The next mirror may answer. */
    }
  }
  throw new Error("No update feed answered");
}

function storage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function automaticDownloads() {
  return storage()?.getItem(automaticKey) !== "off";
}
export function setAutomaticDownloads(on: boolean) {
  storage()?.setItem(automaticKey, on ? "on" : "off");
  notify();
}

type Bridge = { postMessage: (value: object) => Promise<unknown> };
function bridge(): Bridge | undefined {
  return (
    globalThis as {
      webkit?: { messageHandlers?: { museUpdate?: Bridge } };
    }
  ).webkit?.messageHandlers?.museUpdate;
}

// The one update state the banner and About share.
let state: UpdateState = { phase: "idle" };
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function set(next: UpdateState) {
  state = next;
  notify();
}
export function updateState() {
  return state;
}
export function subscribeUpdate(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// Asks the feed whether a newer release exists. An automatic check runs at
// most every six hours; one the person starts always runs.
export async function checkForUpdate({
  automatic = false,
  now = Date.now(),
} = {}) {
  const platform = updatePlatform();
  const build = currentBuild();
  if (!platform || !build) return state;
  if (["checking", "downloading"].includes(state.phase)) return state;
  const last = Number(storage()?.getItem(checkedKey) ?? 0);
  if (automatic && now - last < interval) return state;
  storage()?.setItem(checkedKey, String(now));
  if (!automatic || state.phase === "idle" || state.phase === "failed")
    set({ ...state, phase: "checking", failure: undefined });
  try {
    const feed = await readFeed(platform);
    if (feed.build <= build) {
      set({ phase: "current", feed });
      return state;
    }
    set({ phase: "available", feed });
    if (platform === "android" && automaticDownloads()) await download();
  } catch {
    // An automatic check fails quietly; the next one tries again.
    set(
      automatic
        ? { phase: state.feed ? "available" : "idle", feed: state.feed }
        : { phase: "failed", feed: state.feed, failure: "check" },
    );
  }
  return state;
}

async function download() {
  const feed = state.feed;
  const native = bridge();
  if (!feed?.size || !feed.sha256 || !native) return;
  set({ phase: "downloading", feed });
  try {
    await native.postMessage({
      operation: "download",
      url: feed.url,
      size: feed.size,
      sha256: feed.sha256,
      build: feed.build,
    });
    set({ phase: "ready", feed });
  } catch {
    set({ phase: "failed", feed, failure: "download" });
  }
}

// What Update does: TestFlight on the iPhone; on Android, the download if it
// is not there yet, then the system installer.
export async function startUpdate() {
  const platform = updatePlatform();
  const feed = state.feed;
  if (!platform || !feed || feed.build <= currentBuild()) return;
  if (platform === "ios") {
    // The public TestFlight link opens TestFlight when it is installed.
    globalThis.location.assign(feed.url);
    return;
  }
  if (state.phase !== "ready") await download();
  if (updateState().phase !== "ready") return;
  try {
    const result = (await bridge()?.postMessage({ operation: "install" })) as
      { permission?: boolean } | undefined;
    set({ phase: "ready", feed, permission: Boolean(result?.permission) });
  } catch {
    set({ phase: "failed", feed, failure: "install" });
  }
}

// Hiding the notice for one release; About still offers it.
export function dismissedBuild() {
  return Number(storage()?.getItem(dismissedKey) ?? 0);
}
export function dismissUpdate() {
  if (state.feed) storage()?.setItem(dismissedKey, String(state.feed.build));
  notify();
}

// For tests.
export function resetUpdateState() {
  state = { phase: "idle" };
  notify();
}
