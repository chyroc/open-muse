import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import { ApiError } from "../../shared/ark";
import { eventText, type AgentEvent } from "../../shared/types";
import type {
  InspirationItem,
  InspirationSnapshot,
} from "../../shared/inspiration";
import { IdeasPage, IdeaPreview } from "../ui/IdeasPage";
import { DesktopApp } from "../ui/DesktopApp";
import {
  MacIdeas,
  ideaDetail,
  ideaSections,
  parseMacIdeas,
  type IdeaDetail,
} from "../ui/ideas";

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
const item = (id = "one", category = "Learning"): InspirationItem => ({
  id,
  kind: "ideas",
  session_id: "generation",
  event_id: "answer",
  // Recent, so the fixture never ages past the two-week lifetime.
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  title: `Idea ${id}`,
  body: "A useful plan for learning.",
  emoji: "🌱",
  reason: "You asked about learning.",
  category,
  prompt: "Let's plan it",
  sources: [],
  liked: false,
});
const detail = (): IdeaDetail => ({
  howItWorks: "First clarify the topic, then make a plan.",
  included: [
    {
      id: "outline",
      title: "Outline",
      description: "A focused outline",
      kind: "document",
      selectable: true,
    },
    {
      id: "research",
      title: "Research",
      description: "Sources to read",
      kind: "research",
      selectable: true,
    },
  ],
});
function richContent() {
  const {
    id: _id,
    kind: _kind,
    session_id: _session,
    event_id: _event,
    created_at: _date,
    liked: _liked,
    ...content
  } = item();
  return { items: [{ ...content, detail: detail() }] };
}
function clientStub() {
  const state: InspirationSnapshot = {
    items: [item(), item("two")],
    runs: {},
    instructions: { content: "Concise", revision: "rev" },
    instructionsDismissed: false,
  };
  const histories = new Map<string, AgentEvent[]>([
    ["main", []],
    ["generation", []],
  ]);
  let request: AgentEvent | undefined;
  const client = {
    identity: {
      value: { apiKey: `test-${crypto.randomUUID()}`, project: "test-project" },
    },
    signedIn: () => true,
    config: vi.fn(async () => ({ mode: "ark" })),
    inspiration: vi.fn(async () => state),
    refreshInspiration: vi.fn(async () => state),
    generateInspiration: vi.fn(async () => state),
    prepareWorkspace: vi.fn(async () => {}),
    goals: vi.fn(async () => ({ data: [] })),
    companionIdentity: vi.fn(async () => defaultIdentity()),
    conversationIndex: vi.fn(async () => ({ mainId: "main", entries: {} })),
    sessions: vi.fn(async () => ({
      data: [{ id: "generation", title: "generation", status: "idle" }],
    })),
    create: vi.fn(async (title: string) => ({
      id: "generation",
      title,
      status: "idle",
    })),
    events: vi.fn(async (id: string) => histories.get(id) ?? []),
    openConversation: vi.fn(async () => ({ id: "main", status: "idle" })),
    send: vi.fn(async (id: string, body: { type: string; text: string }) => {
      const events = histories.get(id) ?? [];
      events.push({
        id: crypto.randomUUID(),
        type: body.type,
        content: [{ type: "text", text: body.text }],
      });
      histories.set(id, events);
      return { data: [] };
    }),
    ma: vi.fn(
      async (
        _operation: string,
        input: {
          params: { session_id: string };
          body: { events: AgentEvent[] };
          confirm: boolean;
        },
      ) => {
        request = input.body.events[0];
        histories.set(input.params.session_id, [request]);
        return { data: [request] };
      },
    ),
  };
  return {
    client,
    state,
    histories,
    complete(raw = JSON.stringify(richContent())) {
      histories.set("generation", [
        request!,
        {
          id: "rich-answer",
          type: "agent.message",
          content: [{ type: "text", text: raw }],
        },
        { id: "idle", type: "session.status_idle" },
      ]);
    },
  };
}
type Stub = ReturnType<typeof clientStub>;
const asClient = (stub: Stub) => stub.client as unknown as Client;
const db = () => new LocalDatabase(`mac-ideas-test-${crypto.randomUUID()}`);

describe("Mac Ideas adapter", () => {
  it("strictly validates preview data, URLs, duplicate IDs and unsupported fields", () => {
    expect(parseMacIdeas(JSON.stringify(richContent())).details[0]).toEqual(
      detail(),
    );
    const duplicate = richContent();
    duplicate.items[0].detail.included[1].id = "outline";
    expect(() => parseMacIdeas(JSON.stringify(duplicate))).toThrow();
    const extra = { ...richContent().items[0], unexpected: "field" };
    expect(() => parseMacIdeas(JSON.stringify({ items: [extra] }))).toThrow();
    const unsafe = richContent();
    unsafe.items[0].sources = [{ title: "Bad", url: "javascript:alert(1)" }];
    expect(() => parseMacIdeas(JSON.stringify(unsafe))).toThrow();
    expect(() => parseMacIdeas("x".repeat(65001))).toThrow("too large");
  });
  it("keeps four featured rows and category lists without duplicating dismissed ideas", () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      item(String(index), index % 2 ? "Health" : "Learning"),
    );
    const groups = ideaSections(items, { "1": { direction: "down" } });
    expect(groups.featured.map((item) => item.id)).toEqual([
      "0",
      "2",
      "3",
      "4",
    ]);
    expect(groups.groups.map((group) => group.title)).toEqual([
      "Health",
      "Learning",
    ]);
    expect(
      groups.groups.flatMap((group) => group.items).map((item) => item.id),
    ).toEqual(["5", "7", "6"]);
  });
  it("opens and refreshes with reads only; preserves legacy content and scope", async () => {
    const stub = clientStub();
    const database = db();
    const service = new MacIdeas(asClient(stub), database);
    expect((await service.refresh()).items).toHaveLength(2);
    await service.feedback("one", "down", "Too repetitive");
    expect(
      (await new MacIdeas(asClient(stub), database).snapshot()).feedback.one
        .reason,
    ).toBe("Too repetitive");
    stub.client.identity.value.project = "other";
    expect(
      (await new MacIdeas(asClient(stub), database).snapshot()).feedback,
    ).toEqual({});
    expect(stub.client.create).not.toHaveBeenCalled();
    expect(stub.client.ma).not.toHaveBeenCalled();
    expect(stub.client.send).not.toHaveBeenCalled();
  });
  it("feeds preferences to MA and preserves validated detail without altering source history", async () => {
    const stub = clientStub();
    const service = new MacIdeas(asClient(stub), db());
    await service.feedback("one", "down", "Too repetitive");
    await service.generate();
    expect(stub.client.ma).toHaveBeenCalledOnce();
    expect(stub.client.ma.mock.calls[0][0]).toBe("SendSessionEvents");
    const text = eventText(stub.client.ma.mock.calls[0][1].body.events[0]);
    expect(text).toContain("Too repetitive");
    expect(text).toContain("howItWorks");
    expect(text).toContain("not actions to execute");
    stub.complete();
    const data = await service.refresh();
    expect(data.run?.phase).toBe("complete");
    expect(data.items).toHaveLength(3);
    expect(ideaDetail(data.items[0], data)).toEqual(detail());
    expect(eventText(stub.histories.get("generation")![1])).toContain(
      '"detail"',
    );
  });
  it("never retries ambiguous generation creation or message submission", async () => {
    const stub = clientStub();
    const database = db();
    let token = "";
    stub.client.create.mockImplementationOnce(async (title) => {
      token = title;
      throw new Error("Lost create response");
    });
    let service = new MacIdeas(asClient(stub), database);
    await expect(service.generate()).rejects.toThrow("Lost create response");
    await expect(service.generate()).rejects.toThrow("unconfirmed");
    expect(stub.client.create).toHaveBeenCalledTimes(1);
    stub.client.sessions.mockResolvedValue({
      data: [{ id: "generation", title: token, status: "idle" }],
    });
    service = new MacIdeas(asClient(stub), database);
    await service.refresh();
    expect((await service.snapshot()).run?.phase).toBe("ready");
    stub.client.ma.mockRejectedValueOnce(new Error("Lost send response"));
    await expect(service.generate()).rejects.toThrow("Lost send response");
    await expect(service.generate()).rejects.toThrow("unconfirmed");
    expect(stub.client.ma).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid rich output while keeping previous ideas intact", async () => {
    const stub = clientStub();
    const service = new MacIdeas(asClient(stub), db());
    await service.generate();
    stub.complete('{"items":[{"detail":{"howItWorks":"Invalid"}}]}');
    const state = await service.refresh();
    expect(state.run?.phase).toBe("failed");
    expect(state.items.map((item) => item.id)).toEqual(["one", "two"]);
  });
  it("starts only selected optional deliverables, opens chat, and does not double-send", async () => {
    const stub = clientStub();
    const service = new MacIdeas(asClient(stub), db());
    await service.generate();
    stub.complete();
    const state = await service.refresh();
    const idea = state.items[0];
    const open = vi.fn(async () => {});
    await service.activate(idea, ["outline"], open);
    const text = stub.client.send.mock.calls[0][1].text;
    expect(text).toContain('"id":"outline"');
    expect(text).not.toContain('"id":"research"');
    expect(text).toContain("Ask before purchases");
    expect(open).toHaveBeenCalledWith("main");
    await service.activate(idea, ["research"], open);
    expect(stub.client.send).toHaveBeenCalledTimes(1);
    expect((await service.snapshot()).activations[idea.id].phase).toBe(
      "confirmed",
    );
  });
  it("reconciles an exact lost activation after relaunch with reads and no repeat send", async () => {
    const stub = clientStub();
    const database = db();
    let service = new MacIdeas(asClient(stub), database);
    stub.client.send.mockImplementationOnce(async (id, body) => {
      stub.histories.set(id, [
        {
          id: "lost",
          type: "user.message",
          content: [{ type: "text", text: body.text }],
        },
      ]);
      throw new Error("Lost response");
    });
    await expect(service.activate(item(), [], async () => {})).rejects.toThrow(
      "Lost response",
    );
    service = new MacIdeas(asClient(stub), database);
    await expect(service.activate(item(), [], async () => {})).rejects.toThrow(
      "unconfirmed",
    );
    expect((await service.refresh()).activations.one.phase).toBe("confirmed");
    await service.activate(item(), [], async () => {});
    expect(stub.client.send).toHaveBeenCalledTimes(1);
  });
  it("does not use a similar prior message as proof of submission", async () => {
    const stub = clientStub();
    const service = new MacIdeas(asClient(stub), db());
    stub.client.send.mockRejectedValueOnce(new Error("Lost response"));
    await expect(
      service.activate(item(), [], async () => {}),
    ).rejects.toThrow();
    stub.histories.set("main", [
      {
        id: "other",
        type: "user.message",
        content: [{ type: "text", text: "Let's do this idea." }],
      },
    ]);
    expect((await service.refresh()).activations.one.phase).toBe("sending");
    await expect(service.activate(item(), [], async () => {})).rejects.toThrow(
      "unconfirmed",
    );
    expect(stub.client.send).toHaveBeenCalledTimes(1);
  });
  it("retains the original selection while resuming setup and blocks concurrent claims", async () => {
    const stub = clientStub();
    const database = db();
    const service = new MacIdeas(asClient(stub), database);
    stub.client.openConversation.mockRejectedValueOnce(
      new Error("Lost creation response"),
    );
    await expect(service.activate(item(), [], async () => {})).rejects.toThrow(
      "Lost creation response",
    );
    const original = (await service.snapshot()).activations.one.text;
    const other = new MacIdeas(asClient(stub), database);
    const results = await Promise.allSettled([
      service.activate(item(), [], async () => {}),
      other.activate(item(), [], async () => {}),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(stub.client.send).toHaveBeenCalledTimes(1);
    expect(stub.client.send.mock.calls[0][1].text).toBe(original);
    expect((await service.snapshot()).activations.one.error).toBeUndefined();
  });
  it("does not send to a different account after asynchronous setup", async () => {
    const stub = clientStub();
    const service = new MacIdeas(asClient(stub), db());
    stub.client.openConversation.mockImplementationOnce(async () => {
      stub.client.identity.value.project = "other-account";
      return { id: "main", status: "idle" };
    });
    await expect(service.activate(item(), [], async () => {})).rejects.toThrow(
      "connection changed",
    );
    expect(stub.client.send).not.toHaveBeenCalled();
    await expect(service.feedback("one", "down")).rejects.toThrow(
      "connection changed",
    );
  });
  it("permits explicit retry after a definite rejection and guards running chat/account changes", async () => {
    const stub = clientStub();
    const service = new MacIdeas(asClient(stub), db());
    stub.client.send.mockRejectedValueOnce(new ApiError(429, "Rate limited"));
    await expect(service.activate(item(), [], async () => {})).rejects.toThrow(
      "Rate limited",
    );
    expect((await service.snapshot()).activations.one.phase).toBe("failed");
    await service.activate(item(), [], async () => {});
    expect(stub.client.send).toHaveBeenCalledTimes(2);
    stub.client.openConversation.mockResolvedValueOnce({
      id: "main",
      status: "running",
    });
    await expect(
      service.activate(item("other"), [], async () => {}),
    ).rejects.toThrow("still working");
    expect(stub.client.send).toHaveBeenCalledTimes(2);
    stub.client.identity.value.project = "changed";
    await expect(
      service.activate(item("new"), [], async () => {}),
    ).rejects.toThrow("connection changed");
  });
});

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  location.hash = "";
});
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function button(text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent === text || button.getAttribute("aria-label") === text,
  )!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
const props = (stub: Stub) => ({
  client: asClient(stub),
  onMainChat: vi.fn(async () => {}),
  onOpenChat: vi.fn(),
  onConnect: vi.fn(),
  onEditorChange: vi.fn(),
  split: false,
  onToggleChat: vi.fn(),
});

describe("Mac Ideas UI", () => {
  it("shows list rows and opens a read-only desktop preview", async () => {
    const stub = clientStub();
    await mount(<IdeasPage {...props(stub)} />);
    await settle();
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    await click("View idea: Idea one");
    expect(host.querySelector(".idea-preview")).not.toBeNull();
    expect(host.textContent).toContain("You asked about learning.");
    expect(stub.client.send).not.toHaveBeenCalled();
    expect(stub.client.create).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("What's included");
  });
  it("requires at least one selectable activity and does not fabricate installation", async () => {
    const start = vi.fn();
    await mount(
      <IdeaPreview
        item={item()}
        detail={detail()}
        busy={false}
        onClose={vi.fn()}
        onActivate={start}
      />,
    );
    await click("OutlineA focused outline");
    await click("ResearchSources to read");
    expect(button("Let's do it").disabled).toBe(true);
    await click("OutlineA focused outline");
    await click("Let's do it");
    expect(start).toHaveBeenCalledWith(["outline"]);
    expect(host.textContent).not.toContain("Installed");
  });
  it("dismisses with optional feedback and supports Undo without cloud mutation", async () => {
    const stub = clientStub();
    await mount(<IdeasPage {...props(stub)} />);
    await settle();
    await click("Not interested");
    await settle();
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    await click("Give feedback");
    expect(host.textContent).toContain("Too repetitive");
    await click("Too repetitive");
    await settle();
    await click("Undo");
    await settle();
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(stub.client.ma).not.toHaveBeenCalled();
    expect(stub.client.send).not.toHaveBeenCalled();
  });
  it("guards custom feedback against native close and account/navigation commands", async () => {
    location.hash = "/ideas";
    const stub = clientStub();
    await mount(<DesktopApp client={asClient(stub)} />);
    await settle();
    await click("Not interested");
    await settle();
    await click("Give feedback");
    await click("Write something");
    const textarea = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Idea feedback"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "My feedback");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      (window as Window & { __OPEN_MUSE_HAS_UNSAVED_DOCUMENT__?: boolean })
        .__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__,
    ).toBe(true);
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent("muse-command", { detail: "settings" }),
      ),
    );
    expect(host.textContent).toContain("Your draft is preserved");
    await act(async () => {
      location.hash = "/feed";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(location.hash).toBe("#/ideas");
    expect(textarea.value).toBe("My feedback");
    await click("Close Write something");
    expect(host.textContent).toContain("Discard feedback?");
    await click("Keep editing");
    await act(async () =>
      window.dispatchEvent(new Event("muse-discard-document")),
    );
    expect(host.querySelector(".idea-feedback-dialog")).toBeNull();
  });
  it("starts the idea in main split chat only after explicit preview activation", async () => {
    location.hash = "/ideas";
    const stub = clientStub();
    await mount(<DesktopApp client={asClient(stub)} />);
    await settle();
    await click("View idea: Idea one");
    expect(stub.client.openConversation).not.toHaveBeenCalled();
    const cta = host.querySelector<HTMLButtonElement>(".idea-primary")!;
    await act(async () => cta.click());
    await settle();
    expect(stub.client.send).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe("#/ideas");
    expect(host.querySelector<HTMLDivElement>(".feed-split-chat")?.hidden).toBe(
      false,
    );
    // The chat opens on the left of the page, as the reference app does.
    expect(host.querySelector(".desktop-shell.side-split")).toBeTruthy();
    expect(
      host
        .querySelector(".ideas-split-toggle")
        ?.querySelector("svg path[fill='currentColor']"),
    ).toBeTruthy();
    expect(host.querySelector(".feed-quote")).toBeNull();
    await click("View idea: Idea one");
    expect(host.textContent).toContain("Open conversation");
    await click("Open conversation");
    expect(stub.client.send).toHaveBeenCalledTimes(1);
  });
});

describe("Mac idea lifetime", () => {
  it("retires ideas after about two weeks", async () => {
    const { ideaSections, IDEA_LIFETIME } = await import("../ui/ideas");
    const now = Date.parse("2026-10-20T00:00:00Z");
    const item = (id: string, age: number) =>
      ({
        id,
        kind: "ideas",
        category: "",
        created_at: new Date(now - age).toISOString(),
      }) as never;
    const sections = ideaSections(
      [item("new", 3600_000), item("old", IDEA_LIFETIME + 1)],
      {},
      now,
    );
    expect(sections.featured.map((idea: { id: string }) => idea.id)).toEqual([
      "new",
    ]);
  });
});

describe("Mac ideas prompt", () => {
  it("allows recurring work only as an Upcoming item the person agrees to", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("macos/ui/ideas.ts", "utf8");
    expect(source).not.toContain("Automatic scheduling is not connected");
    expect(source).toContain(
      "set up only after the person starts the idea and agrees",
    );
  });
});
