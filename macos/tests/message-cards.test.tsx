import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import type { AgentEvent } from "../../shared/types";
import {
  discussionMessage,
  type InspirationItem,
} from "../../shared/inspiration";
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
  location.hash = "";
  localStorage.clear();
});
async function mount() {
  const client = new Client({
    database: new LocalDatabase(`mac-cards-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    account: vaultAccount(async () =>
      JSON.stringify({
        kind: "api_key",
        apiKey: `cards-${crypto.randomUUID()}`,
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
  const send = vi.spyOn(client, "send").mockResolvedValue({ data: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<DesktopApp client={client} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  return send;
}

describe("Mac message cards", () => {
  it("shows the person's words with the post as a card that opens it", async () => {
    const post = {
      id: "post-1",
      kind: "feed",
      title: "Assistants become workflow hubs",
      body: "AI assistants are becoming workflow surfaces.",
      sources: [],
      prompt: "Which routine?",
    } as unknown as InspirationItem;
    fixtureTask.events = [
      {
        id: "u",
        type: "user.message",
        content: [
          { type: "text", text: discussionMessage(post, "What is it?") },
        ],
      },
    ];
    await mount();
    const bubble = host!.querySelector(".message.from-user .message-bubble")!;
    expect(bubble.textContent).toBe("What is it?");
    expect(host!.textContent).not.toContain("Let's discuss this post");
    expect(host!.textContent).not.toContain('"sources"');
    const card = host!.querySelector<HTMLButtonElement>(".message-card")!;
    expect(card.textContent).toContain("Assistants become workflow hubs");
    await act(async () => card.click());
    expect(location.hash).toBe("#/feed/id/post-1");
  });
});
