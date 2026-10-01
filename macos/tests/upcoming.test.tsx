import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity } from "../../src/direct/identity";
import { zhCN } from "../../shared/locales/zh-CN";
import type { UpcomingItem } from "../../shared/upcoming";
import { UpcomingTab, editDraft, upcomingRows } from "../ui/UpcomingTab";
import { DesktopApp } from "../ui/DesktopApp";

vi.mock("../../src/useTask", () => {
  const refresh = async () => {};
  return {
    useTask: () => ({
      events: [],
      session: undefined,
      loading: false,
      error: "",
      connected: false,
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
});

const stamp = "2026-09-01T08:00:00+08:00";
const item = (
  id: string,
  title: string,
  status: UpcomingItem["status"],
  time = "09:00",
): UpcomingItem => ({
  id,
  title,
  instruction: `Do ${title}`,
  schedule: { kind: "daily", time },
  time_zone: "Asia/Shanghai",
  status,
  created_at: stamp,
  updated_at: stamp,
});
const items = [
  item("water", "Drink water", "active", "15:00"),
  item("walk", "Evening walk", "paused"),
  item("standup", "Standup notes", "active", "08:30"),
  item("old", "Finished once", "done"),
];
async function client() {
  const value = new Client({
    database: new LocalDatabase(`mac-upcoming-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    vault: {
      read: async () =>
        JSON.stringify({
          kind: "api_key",
          apiKey: `upcoming-${crypto.randomUUID()}`,
          project: "test",
        }),
      write: async () => {},
    },
  });
  await value.restore();
  vi.spyOn(value, "upcoming").mockResolvedValue({ items, revision: "r1" });
  return value;
}
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
const row = (title: string) =>
  [...host!.querySelectorAll("ul button")].find((item) =>
    item.textContent?.startsWith(title),
  ) as HTMLButtonElement;
const button = (label: string, scope: ParentNode = host!) =>
  [...scope.querySelectorAll("button")].find((item) =>
    item.textContent?.trim().endsWith(label),
  )!;

describe("Mac Upcoming", () => {
  it("lists active items soonest first, paused after, and hides finished ones", () => {
    const now = Date.parse("2026-10-01T10:00:00+08:00");
    expect(upcomingRows(items, now).map(({ item }) => item.id)).toEqual([
      "water",
      "standup",
      "walk",
    ]);
  });
  it("opens a task, pauses it with the revision, and drafts an edit", async () => {
    const value = await client();
    const change = vi
      .spyOn(value, "changeUpcoming")
      .mockResolvedValue({ items, revision: "r2" });
    const onEdit = vi.fn();
    await mount(<UpcomingTab client={value} connected onEdit={onEdit} />);
    expect(host!.textContent).not.toContain("Finished once");
    await act(async () => row("Drink water").click());
    const dialog = host!.querySelector("dialog")!;
    expect(dialog.textContent).toContain("Do Drink water");
    await act(async () => button("Pause", dialog).click());
    expect(change).toHaveBeenCalledWith("water", "pause", "r1");
    await act(async () =>
      button("Edit", host!.querySelector("dialog")!).click(),
    );
    expect(onEdit).toHaveBeenCalledWith(editDraft(items[0]));
    expect(host!.querySelector("dialog")).toBeNull();
  });
  it("asks before removing", async () => {
    const value = await client();
    const change = vi
      .spyOn(value, "changeUpcoming")
      .mockResolvedValue({ items: items.slice(1), revision: "r2" });
    await mount(<UpcomingTab client={value} connected onEdit={vi.fn()} />);
    await act(async () => row("Standup notes").click());
    await act(async () =>
      button("Remove", host!.querySelector("dialog")!).click(),
    );
    expect(change).not.toHaveBeenCalled();
    expect(host!.querySelector("dialog")!.textContent).toContain(
      "Remove “Standup notes”?",
    );
    await act(async () =>
      host!
        .querySelector<HTMLButtonElement>("dialog .pill-button.danger")!
        .click(),
    );
    expect(change).toHaveBeenCalledWith("standup", "delete", "r1");
    expect(host!.querySelector("dialog")).toBeNull();
  });
  it("offers the same actions on right-click", async () => {
    const value = await client();
    const change = vi
      .spyOn(value, "changeUpcoming")
      .mockResolvedValue({ items, revision: "r2" });
    await mount(<UpcomingTab client={value} connected onEdit={vi.fn()} />);
    const target = row("Evening walk");
    await act(async () => {
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 5,
          clientY: 6,
        }),
      );
    });
    const menu = host!.querySelector("[role=menu]")!;
    expect(
      [...menu.querySelectorAll("button")].map((item) => item.textContent),
    ).toEqual(["Edit", "Resume", "Remove"]);
    await act(async () => button("Resume", menu).click());
    expect(change).toHaveBeenCalledWith("walk", "resume", "r1");
  });
  it("delivers due reminders while the app is connected", async () => {
    const value = await client();
    vi.spyOn(value, "config").mockResolvedValue({
      mode: "ark",
    } as Awaited<ReturnType<Client["config"]>>);
    vi.spyOn(value, "sessions").mockResolvedValue({ data: [] });
    vi.spyOn(value, "conversationIndex").mockResolvedValue({ entries: {} });
    vi.spyOn(value, "companionIdentity").mockResolvedValue(defaultIdentity());
    vi.spyOn(value, "goals").mockResolvedValue({ data: [], revision: "r" });
    vi.spyOn(value, "startWelcome").mockResolvedValue({ phase: "skipped" });
    vi.spyOn(value, "startCheckIn").mockResolvedValue(undefined);
    const deliver = vi
      .spyOn(value, "deliverUpcoming")
      .mockResolvedValue(undefined);
    await mount(<DesktopApp client={value} />);
    expect(deliver).toHaveBeenCalled();
  });
  it("translates its copy", () => {
    for (const [, key] of readFileSync(
      "macos/ui/UpcomingTab.tsx",
      "utf8",
    ).matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
  });
});
