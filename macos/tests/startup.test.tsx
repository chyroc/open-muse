import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import { DesktopApp } from "../ui/DesktopApp";
import { restoreInBackground } from "../ui/startup";
import { vaultAccount } from "./account";

vi.mock("../../src/useTask", () => ({
  useTask: () => ({
    events: [],
    session: undefined,
    loading: false,
    error: "",
    connected: false,
    autoApprovalFailures: [],
    refresh: async () => {},
  }),
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let hidden = false;
Object.defineProperty(document, "hidden", {
  configurable: true,
  get: () => hidden,
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  hidden = false;
  location.hash = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function fixture() {
  const client = new Client({
    database: new LocalDatabase(`mac-startup-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("Startup must not contact the cloud");
    }),
    account: vaultAccount(async () =>
      JSON.stringify({
        kind: "api_key",
        apiKey: `startup-${crypto.randomUUID()}`,
        project: "test",
      }),
    ),
  });
  vi.spyOn(client, "sessions").mockResolvedValue({ data: [] });
  vi.spyOn(client, "conversationIndex").mockResolvedValue({
    mainId: "main",
    entries: {},
  });
  vi.spyOn(client, "companionIdentity").mockResolvedValue(defaultIdentity());
  vi.spyOn(client, "goals").mockResolvedValue({
    data: [],
    revision: "fixture",
  });
  return client;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("Mac workspace startup", () => {
  it("still reads the connection when the restore settles before it mounts", async () => {
    const client = await fixture();
    const config = vi.spyOn(client, "config");
    // The shell starts the restore next to the first render, so the settled
    // event can precede the workspace mounting.
    await restoreInBackground(client);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<DesktopApp client={client} />));
    await settle();
    expect(config).toHaveBeenCalled();
    expect(client.signedIn()).toBe(true);
  });
  it("refreshes when the window becomes visible again", async () => {
    const client = await fixture();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<DesktopApp client={client} />));
    await settle();
    const config = vi.spyOn(client, "config");
    // Occluded by the settings window: the poll deliberately skips its work.
    hidden = true;
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(config).not.toHaveBeenCalled();
    vi.useRealTimers();
    // Visible again: the workspace must not wait for the next poll.
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(config).toHaveBeenCalledTimes(1);
  });
});
