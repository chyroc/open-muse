import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import type { AgentEvent } from "../../shared/types";
import { DesktopApp } from "../ui/DesktopApp";
import { vaultAccount } from "./account";

const fixtureTask = vi.hoisted(() => ({ events: [] as AgentEvent[] }));
vi.mock("../../src/useTask", () => {
  const refresh = async () => {};
  return {
    useTask: (_client: unknown, id?: string) => ({
      events: id === "main" ? fixtureTask.events : [],
      session: id ? { id, status: "idle" } : undefined,
      loading: false,
      error: "",
      connected: true,
      autoApprovalFailures: [],
      refresh,
    }),
  };
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  fixtureTask.events = [];
});
async function mount() {
  const client = new Client({
    database: new LocalDatabase(`mac-sending-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    account: vaultAccount(async () =>
      JSON.stringify({
        kind: "api_key",
        apiKey: `files-${crypto.randomUUID()}`,
        project: "test",
      }),
    ),
  });
  await client.restore();
  vi.spyOn(client, "config").mockResolvedValue({
    mode: "ark",
  } as Awaited<ReturnType<Client["config"]>>);
  vi.spyOn(client, "sessions").mockResolvedValue({ data: [] });
  vi.spyOn(client, "conversationIndex").mockResolvedValue({
    mainId: "main",
    entries: {},
  });
  vi.spyOn(client, "companionIdentity").mockResolvedValue(defaultIdentity());
  vi.spyOn(client, "goals").mockResolvedValue({ data: [], revision: "r" });
  vi.spyOn(client, "startWelcome").mockResolvedValue({ phase: "skipped" });
  vi.spyOn(client, "startCheckIn").mockResolvedValue(undefined);
  vi.spyOn(client, "deliverUpcoming").mockResolvedValue(undefined);
  vi.spyOn(client, "attachmentNames").mockResolvedValue({
    "file-cat": "cat.png",
  });
  const upload = vi
    .spyOn(client, "uploadAttachment")
    .mockImplementation(async (_file, name) => ({
      name,
      kind: "document",
      file_id: "file-report",
    }));
  vi.spyOn(client, "openConversation").mockResolvedValue({
    id: "main",
  } as Awaited<ReturnType<Client["openConversation"]>>);
  const send = vi.spyOn(client, "send");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<DesktopApp client={client} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  return { upload, send };
}
const settle = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
const sendButton = () =>
  host!.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
const composer = () => host!.querySelector<HTMLTextAreaElement>("textarea")!;
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(composer(), text);
    composer().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const bubbles = () =>
  [...host!.querySelectorAll(".message.from-user")].map((item) => ({
    text: item.textContent,
    sending: item.classList.contains("sending"),
  }));

describe("Mac sending", () => {
  it("shows the message and clears the composer before the send returns", async () => {
    const { send } = await mount();
    let finish!: () => void;
    send.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ data: [] }))),
    );
    await type("Hello there");
    await act(async () => sendButton().click());
    await settle();
    expect(composer().value).toBe("");
    expect(bubbles()).toEqual([{ text: "Hello there", sending: true }]);
    // The conversation's own copy replaces it in place, without a duplicate.
    fixtureTask.events = [
      {
        id: "evt-1",
        type: "user.message",
        created_at: new Date().toISOString(),
        content: [{ type: "text", text: "Hello there" }],
      },
    ];
    await act(async () => finish());
    await settle();
    expect(bubbles()).toEqual([{ text: "Hello there", sending: false }]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("puts a message that failed to send back in the composer, unsent", async () => {
    const { send } = await mount();
    send.mockRejectedValue(new Error("The network went away"));
    await type("Try again later");
    await act(async () => sendButton().click());
    await settle();
    expect(bubbles()).toEqual([]);
    expect(composer().value).toBe("Try again later");
    expect(host!.textContent).toContain("The network went away");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
