import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zhCN } from "../../shared/locales/zh-CN";
import type { UpcomingItem } from "../../shared/upcoming";
import { ReminderCard } from "../ui/ReminderCard";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

describe("Mac chat cards", () => {
  it("shows a reminder the reply set up and opens Upcoming", async () => {
    const onOpen = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const item = {
      id: "reminder-1",
      title: "Drink water",
      schedule: { kind: "once", at: "2026-10-10T01:00:00.000Z" },
      time_zone: "Asia/Shanghai",
      created_at: "2026-10-09T08:00:00.000Z",
    } as unknown as UpcomingItem;
    await act(async () =>
      root!.render(<ReminderCard item={item} onOpen={onOpen} />),
    );
    expect(host.textContent).toContain("Drink water");
    expect(host.textContent).toContain("Reminder");
    expect(host.textContent).toContain("Once,");
    await act(async () =>
      host!.querySelector<HTMLButtonElement>(".mac-reminder-open")!.click(),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(zhCN["Open Upcoming"]).toBeTruthy();
  });

  it("tells the companion that messages come from the Mac", () => {
    // Without it the companion reached for the iPhone's tools.
    expect(readFileSync("macos/ui/main.tsx", "utf8")).toContain(
      'surface: "mac"',
    );
  });
});
