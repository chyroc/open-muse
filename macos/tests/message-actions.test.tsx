import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import type { AgentEvent } from "../../shared/types";
import { DesktopApp } from "../ui/DesktopApp";
import { readReactions, setReaction } from "../ui/reactions";

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

const text = (id: string, type: string, value: string): AgentEvent => ({
  id,
  type,
  content: [{ type: "text", text: value }],
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
async function signedIn(apiKey = `actions-${crypto.randomUUID()}`) {
  const client = new Client({
    database: new LocalDatabase(`mac-actions-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({ kind: "api_key", apiKey, project: "test" }),
      write: async () => {},
    },
  });
  await client.restore();
  return client;
}
async function mount() {
  const client = await signedIn();
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
  const save = vi
    .spyOn(client, "saveReply")
    .mockResolvedValue(undefined as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<DesktopApp client={client} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  return { client, save };
}
const labels = (article: Element) =>
  [...article.querySelectorAll(".message-actions > button")].map((item) =>
    item.getAttribute("aria-label"),
  );

describe("Mac message actions", () => {
  it("orders the actions by side, like the reference", async () => {
    fixtureTask.events = [
      text("u", "user.message", "Plan my week"),
      text("a", "agent.message", "Here is a plan"),
    ];
    await mount();
    const [mine, theirs] = host!.querySelectorAll("article.message");
    expect(labels(mine)).toEqual([
      "More options",
      "Copy message",
      "Reply to message",
    ]);
    expect(labels(theirs)).toEqual([
      "Leave a mood",
      "Reply to message",
      "Copy message",
      "More options",
    ]);
  });
  it("leaves a mood on this Mac and clears it when chosen again", async () => {
    fixtureTask.events = [text("a", "agent.message", "Here is a plan")];
    const { client } = await mount();
    const article = host!.querySelector("article.from-assistant")!;
    const open = () =>
      act(async () =>
        article
          .querySelector<HTMLButtonElement>('[aria-label="Leave a mood"]')!
          .click(),
      );
    await open();
    await act(async () =>
      article.querySelector<HTMLButtonElement>('[aria-label="❤️"]')!.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(article.querySelector(".message-mood")?.textContent).toBe("❤️");
    expect(await readReactions(client)).toEqual({ a: "❤️" });
    await open();
    await act(async () =>
      article.querySelector<HTMLButtonElement>('[aria-label="❤️"]')!.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(article.querySelector(".message-mood")).toBeNull();
  });
  it("saves a reply to Library from the More menu", async () => {
    fixtureTask.events = [text("a", "agent.message", "Keep this")];
    const { save } = await mount();
    const article = host!.querySelector("article.from-assistant")!;
    await act(async () =>
      article
        .querySelector<HTMLButtonElement>('[aria-label="More options"]')!
        .click(),
    );
    const items = [...article.querySelectorAll(".message-popup button")];
    expect(items.map((item) => item.textContent)).toEqual([
      "Save reply to library",
      "Select text",
    ]);
    await act(async () => (items[0] as HTMLButtonElement).click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(save).toHaveBeenCalledWith("main", "a");
    expect(article.querySelector(".message-popup")).toBeNull();
  });
  it("keeps moods apart for different connections", async () => {
    const first = await signedIn();
    const second = await signedIn();
    await setReaction(first, "a", "👍");
    expect(await readReactions(first)).toEqual({ a: "👍" });
    expect(await readReactions(second)).toEqual({});
  });
});
