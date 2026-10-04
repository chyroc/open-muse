import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../shared/types";
import type { UpcomingItem } from "../shared/upcoming";
import { remindersByReply } from "../src/reminder-cards";
import { ReminderCard } from "../src/ReminderCard";

const item = (created_at: string): UpcomingItem => ({
  id: `umbrella-${created_at}`,
  title: "Bring an umbrella",
  instruction: "Remind them to take an umbrella.",
  schedule: { kind: "once", at: "2026-10-06T08:00:00+08:00" },
  time_zone: "Asia/Shanghai",
  status: "active",
  created_at,
  updated_at: created_at,
});
const message = (id: string, type: string, created_at: string) =>
  ({ id, type, content: [], created_at }) as unknown as AgentEvent;

describe("Reminders under the reply that set them up", () => {
  const turn = [
    message("ask", "user.message", "2026-10-05T02:24:00Z"),
    message("ack", "agent.message", "2026-10-05T02:24:10Z"),
    message("done", "agent.message", "2026-10-05T02:24:40Z"),
    message("thanks", "user.message", "2026-10-05T02:30:00Z"),
    message("welcome", "agent.message", "2026-10-05T02:30:05Z"),
  ];

  it("puts a reminder under the last reply of the turn that made it", () => {
    const made = item("2026-10-05T02:24:30Z");
    const found = remindersByReply([made], turn);
    expect([...found.keys()]).toEqual(["done"]);
    expect(found.get("done")).toEqual([made]);
  });

  it("leaves out reminders made long before or before this turn began", () => {
    expect(remindersByReply([item("2026-10-01T09:00:00Z")], turn).size).toBe(0);
    // Made before the person asked in this chat: another conversation's.
    expect(
      remindersByReply([item("2026-10-05T02:28:00Z")], turn.slice(3)).size,
    ).toBe(0);
  });

  it("shows what the reminder is and when it comes", () => {
    const html = renderToStaticMarkup(
      <ReminderCard item={item("2026-10-05T02:24:30Z")} />,
    );
    expect(html).toContain("Bring an umbrella");
    expect(html).toContain("Once, Oct 6");
  });
});
