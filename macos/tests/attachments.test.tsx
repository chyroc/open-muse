import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import type { AgentEvent } from "../../shared/types";
import { DesktopApp } from "../ui/DesktopApp";

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
    database: new LocalDatabase(`mac-files-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `files-${crypto.randomUUID()}`,
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
  const send = vi.spyOn(client, "send").mockResolvedValue({ data: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<DesktopApp client={client} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
  return { upload, send };
}
const settle = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
async function pick(files: File[]) {
  const input = host!.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
const sendButton = () =>
  host!.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;

describe("Mac composer attachments", () => {
  it("uploads a picked file and sends it without any text", async () => {
    const { upload, send } = await mount();
    expect(sendButton().disabled).toBe(true);
    await pick([
      new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" }),
    ]);
    expect(upload).toHaveBeenCalledWith(expect.any(File), "report.pdf", 0);
    expect(host!.querySelector(".mac-staged")?.textContent).toContain(
      "report.pdf",
    );
    expect(sendButton().disabled).toBe(false);
    await act(async () => sendButton().click());
    await settle();
    expect(send).toHaveBeenCalledWith("main", {
      type: "user.message",
      text: "",
      attachments: [
        { name: "report.pdf", kind: "document", file_id: "file-report" },
      ],
    });
    expect(host!.querySelector(".mac-staged")).toBeNull();
  });
  it("refuses an unsupported file before uploading and blocks sending", async () => {
    const { upload, send } = await mount();
    await pick([
      new File(["x"], "tool.exe", { type: "application/x-msdownload" }),
    ]);
    expect(upload).not.toHaveBeenCalled();
    expect(host!.querySelector(".mac-staged .is-failed")).toBeTruthy();
    expect(sendButton().disabled).toBe(true);
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>(
          '[aria-label="Remove attachment: tool.exe"]',
        )!
        .click(),
    );
    expect(host!.querySelector(".mac-staged")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it("shows the files a sent message carried", async () => {
    fixtureTask.events = [
      {
        id: "u1",
        type: "user.message",
        content: [
          { type: "image", source: { type: "file", file_id: "file-cat" } },
          { type: "text", text: "Look" },
        ] as unknown as AgentEvent["content"],
      },
      {
        id: "u2",
        type: "user.message",
        content: [
          { type: "image", source: { type: "file", file_id: "file-cat" } },
        ] as unknown as AgentEvent["content"],
      },
    ];
    await mount();
    const bubbles = [...host!.querySelectorAll(".from-user .message-bubble")];
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].textContent).toContain("cat.png");
    expect(bubbles[0].textContent).toContain("Look");
    expect(bubbles[1].textContent).toBe("cat.png");
  });
});
