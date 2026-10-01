import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import { DesktopApp } from "../ui/DesktopApp";

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
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  location.hash = "";
  vi.unstubAllGlobals();
});

async function fixture() {
  const client = new Client({
    database: new LocalDatabase(`mac-avatar-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("The avatar menu must not contact the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `avatar-${crypto.randomUUID()}`,
          project: "test",
        }),
      write: async () => {},
    },
  });
  await client.restore();
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
async function mount(client: Client) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<DesktopApp client={client} />));
  await settle();
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
const composer = () => host!.querySelector<HTMLTextAreaElement>("textarea")!;
const trigger = () =>
  host!.querySelector<HTMLButtonElement>(
    `[aria-label="Edit avatar and name"]`,
  )!;
const entries = () => [
  ...host!.querySelectorAll<HTMLButtonElement>(".status-menu button"),
];
async function press(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("Mac avatar menu", () => {
  it("seeds the composer from both entries without sending", async () => {
    const client = await fixture();
    const send = vi.spyOn(client, "send");
    const create = vi.spyOn(client, "create");
    await mount(client);
    await act(async () => trigger().click());
    expect(entries().map((item) => item.textContent)).toEqual([
      "Change avatar",
      "Edit name",
    ]);
    await act(async () => entries()[1].click());
    await settle();
    // The reference keeps the trailing space and leaves the sending to the user.
    expect(composer().value).toBe("Change your name to ");
    expect(composer()).toBe(document.activeElement);
    expect(composer().selectionStart).toBe(composer().value.length);
    expect(composer().selectionEnd).toBe(composer().value.length);
    await act(async () => trigger().click());
    await act(async () => entries()[0].click());
    await settle();
    // An existing draft is replaced without a confirmation, as the reference does.
    expect(composer().value).toBe("Change your avatar to ");
    expect(host!.querySelector("dialog")).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("opens, moves, activates and dismisses from the keyboard", async () => {
    const client = await fixture();
    await mount(client);
    trigger().focus();
    // jsdom does not synthesize a button activation from Enter or Space, so the
    // opening step calls the same activation a browser produces from those keys.
    // Everything after it is a real keyboard event this build handles itself.
    await act(async () => trigger().click());
    expect(entries()[0]).toBe(document.activeElement);
    await press(entries()[0], "ArrowDown");
    expect(entries()[1]).toBe(document.activeElement);
    await press(entries()[1], "ArrowDown");
    expect(entries()[0]).toBe(document.activeElement);
    await press(entries()[0], "ArrowUp");
    expect(entries()[1]).toBe(document.activeElement);
    await press(entries()[1], "Escape");
    expect(host!.querySelector(".status-menu")).toBeNull();
    expect(trigger()).toBe(document.activeElement);
    await act(async () => trigger().click());
    await act(async () => {
      host!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host!.querySelector(".status-menu")).toBeNull();
  });
  it("leaves the open document and the other drafts alone", async () => {
    const client = await fixture();
    await mount(client);
    await act(async () => trigger().click());
    await act(async () => entries()[1].click());
    await settle();
    expect(composer().value).toBe("Change your name to ");
    // Nothing opened a document editor and no workspace navigation happened.
    expect(host!.querySelector(".document-workspace")).toBeNull();
    expect(location.hash).toBe("");
  });
});
