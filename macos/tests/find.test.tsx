import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import type { AgentEvent } from "../../shared/types";
import { DesktopApp } from "../ui/DesktopApp";
import { findMatches } from "../ui/FindBar";

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

describe("Mac find in chat", () => {
  it("matches bubbles by text, ignoring case", () => {
    const parts = [
      {
        event: text("a", "user.message", "Book Kyoto hotel"),
        part: "all" as const,
      },
      {
        event: text("b", "agent.message", "Found two hotels"),
        part: "all" as const,
      },
      {
        event: text("c", "agent.message", "Anything else?"),
        part: "all" as const,
      },
    ];
    expect(findMatches(parts, "HOTEL")).toEqual(["a:all", "b:all"]);
    expect(findMatches(parts, "  ")).toEqual([]);
  });
  it("opens with Command-F, steps through matches and closes with Escape", async () => {
    fixtureTask.events = [
      text("a", "user.message", "Book a Kyoto hotel"),
      text("b", "agent.message", "Here are two hotels"),
      text("c", "user.message", "Thanks"),
    ];
    const client = new Client({
      database: new LocalDatabase(`mac-find-${crypto.randomUUID()}`),
      fetcher: vi.fn(async () => {
        throw new Error("This test must not reach the cloud");
      }),
      vault: {
        read: async () =>
          JSON.stringify({
            kind: "api_key",
            apiKey: `find-${crypto.randomUUID()}`,
            project: "test",
          }),
        write: async () => {},
      },
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
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<DesktopApp client={client} />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", metaKey: true }),
      );
    });
    const input = host.querySelector<HTMLInputElement>(".find-bar input")!;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "HOTEL");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector(".find-count")?.textContent).toBe("1 of 2");
    expect(host.querySelectorAll(".message.found")).toHaveLength(2);
    expect(host.querySelector(".message.current")?.textContent).toContain(
      "Kyoto",
    );
    const key = (value: string, shiftKey = false) =>
      act(async () => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true }),
        );
      });
    await key("Enter");
    expect(host.querySelector(".find-count")?.textContent).toBe("2 of 2");
    expect(host.querySelector(".message.current")?.textContent).toContain(
      "two hotels",
    );
    await key("Enter", true);
    expect(host.querySelector(".find-count")?.textContent).toBe("1 of 2");
    await key("Escape");
    expect(host.querySelector(".find-bar")).toBeNull();
    expect(host.querySelector(".message.found")).toBeNull();
  });
});
