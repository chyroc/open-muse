import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../shared/types";
import type { UpcomingItem } from "../shared/upcoming";
import { remindersByReply } from "../src/reminder-cards";
import { ReminderCard } from "../src/ReminderCard";

const item = (id: string, created_at: string): UpcomingItem => ({
  id,
  title: "Bring an umbrella",
  instruction: "Remind them to take an umbrella.",
  schedule: { kind: "once", at: "2026-10-06T08:00:00+08:00" },
  time_zone: "Asia/Shanghai",
  status: "active",
  created_at,
  updated_at: created_at,
});
const message = (id: string, type: string, at: string, text = "ok") =>
  ({
    id,
    type,
    content: [{ type: "text", text }],
    created_at: at,
  }) as AgentEvent;
const write = (id: string, at: string, ids: string[]) =>
  ({
    id,
    type: "agent.tool_use",
    name: "memory_write",
    input: {
      path: "/store/UPCOMING.md",
      content: JSON.stringify({ items: ids.map((one) => ({ id: one })) }),
    },
    created_at: at,
  }) as unknown as AgentEvent;

describe("Reminders under the reply that set them up", () => {
  const events = [
    message("ask", "user.message", "2026-10-05T05:01:23Z"),
    message("ack", "agent.message", "2026-10-05T05:01:30Z"),
    write("w1", "2026-10-05T05:02:35Z", ["umbrella"]),
    message("done", "agent.message", "2026-10-05T05:02:44Z"),
    message("thanks", "user.message", "2026-10-05T05:10:00Z"),
    write("w2", "2026-10-05T05:10:20Z", ["umbrella", "tickets"]),
    message("more", "agent.message", "2026-10-05T05:10:30Z"),
  ];

  it("puts a reminder under the last reply after the write that first named it", () => {
    // The recorded creation time is minutes off, as the companion writes it.
    const umbrella = item("umbrella", "2026-10-05T05:06:00Z");
    const tickets = item("tickets", "2026-10-05T05:12:00Z");
    const found = remindersByReply([umbrella, tickets], events);
    expect(found.get("done")).toEqual([umbrella]);
    expect(found.get("more")).toEqual([tickets]);
  });

  it("shows none for an item this chat never wrote, or one made long before", () => {
    expect(
      remindersByReply([item("elsewhere", "2026-10-05T05:02:00Z")], events)
        .size,
    ).toBe(0);
    // Its own turn is not loaded; a later rewrite of the list carries it.
    expect(
      remindersByReply([item("tickets", "2026-10-01T09:00:00Z")], events).size,
    ).toBe(0);
  });

  it("shows what the reminder is and when it comes", () => {
    const html = renderToStaticMarkup(
      <ReminderCard item={item("umbrella", "2026-10-05T02:24:30Z")} />,
    );
    expect(html).toContain("Bring an umbrella");
    expect(html).toContain("Once, Oct 6");
  });
});
