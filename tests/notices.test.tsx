import "fake-indexeddb/auto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Client } from "../src/api";
import { ChatHeader } from "../src/ChatUI";
import { LocalDatabase } from "../src/direct/storage";
import { noticeTime } from "../src/NoticesSheet";
import { checkInPrompt } from "../shared/checkin";
import { uuid } from "../shared/crypto";
import { t } from "../shared/i18n";
import {
  emptyNoticeRecords,
  noticeList,
  noticesFromHistory,
  unreadNotices,
  type Notice,
} from "../shared/notices";
import type { AgentEvent } from "../shared/types";
import { webhookPrompt } from "../shared/webhooks";

const now = new Date("2026-10-08T09:00:00Z");
const user = (id: string, text: string): AgentEvent => ({
  id,
  type: "user.message",
  content: [{ type: "text", text }],
});
const agent = (id: string, text: string, at: string): AgentEvent => ({
  id,
  type: "agent.message",
  content: [{ type: "text", text }],
  created_at: at,
});

describe("The notification list", () => {
  it("reads app-generated messages the companion answered, newest first", () => {
    const events = [
      user("u1", "How was my week?"),
      agent("a1", "A fine week.", "2026-10-08T08:00:00Z"),
      user("u2", checkInPrompt("en", now)),
      agent("a2", "Morning! **How** did the run go?", "2026-10-08T08:10:00Z"),
      user("u3", webhookPrompt("en", now, { name: "Deploys" }, "{}")),
      agent("a3", "Your deploy finished.", "2026-10-08T08:20:00Z"),
      // Not answered yet: not a notice.
      user("u4", checkInPrompt("en", now)),
    ];
    const notices = noticesFromHistory(events, "main");
    expect(notices.map((notice) => [notice.id, notice.kind])).toEqual([
      ["a3", "event"],
      ["a2", "check-in"],
    ]);
    expect(notices[1].preview).toBe("Morning! How did the run go?");
    expect(notices[1].session_id).toBe("main");
  });

  it("merges recorded replies, drops cleared and repeated ones, and counts unread", () => {
    const notice = (id: string, at: string): Notice => ({
      id,
      kind: "reply",
      session_id: "side",
      at,
      preview: id,
    });
    const history = [notice("a", "2026-10-08T08:30:00Z")];
    const records = {
      replies: [
        notice("a", "2026-10-08T08:30:00Z"),
        notice("b", "2026-10-08T08:40:00Z"),
        notice("old", "2026-10-07T08:00:00Z"),
      ],
      readAt: "2026-10-08T08:30:00Z",
      clearedAt: "2026-10-08T00:00:00Z",
    };
    const list = noticeList(history, records);
    expect(list.map((item) => item.id)).toEqual(["b", "a"]);
    expect(unreadNotices(list, records)).toBe(1);
    expect(unreadNotices(list, emptyNoticeRecords())).toBe(2);
  });

  it("keeps read, cleared, and announced replies per identity on the device", async () => {
    const client = new Client({
      database: new LocalDatabase(`notices-${uuid()}`),
    });
    expect(await client.noticeRecords()).toEqual({ replies: [] });
    const reply: Notice = {
      id: "r1",
      kind: "reply",
      session_id: "side",
      at: "2026-10-08T08:00:00Z",
      preview: "Done.",
    };
    await client.recordReplyNotice(reply);
    await client.recordReplyNotice(reply);
    await client.markNotices("read", "2026-10-08T08:00:00Z");
    // An earlier mark never moves it back.
    await client.markNotices("read", "2026-10-07T08:00:00Z");
    expect(await client.noticeRecords()).toEqual({
      replies: [reply],
      readAt: "2026-10-08T08:00:00Z",
    });
    await client.markNotices("cleared", "2026-10-08T09:00:00Z");
    expect(await client.noticeRecords()).toMatchObject({
      clearedAt: "2026-10-08T09:00:00Z",
      readAt: "2026-10-08T09:00:00Z",
    });
  });

  it("shows a bell beside the options, with a dot while something is unread", () => {
    const header = (unread?: number) =>
      renderToStaticMarkup(
        <ChatHeader
          onSidebar={() => {}}
          onStatus={() => {}}
          onMore={() => {}}
          status="Connected"
          notices={
            unread === undefined ? undefined : { unread, onOpen: () => {} }
          }
        />,
      );
    expect(header()).not.toContain("header-notices");
    expect(header(0)).toContain('aria-label="Notifications"');
    expect(header(0)).not.toContain("header-notices-dot");
    expect(header(2)).toContain('aria-label="Notifications, 2 unread"');
    expect(header(2)).toContain("header-notices-dot");
    expect(t("Notifications, {count} unread", { count: 2 }, "zh-CN")).toBe(
      "通知，2 条未读",
    );
    expect(t("Clear all", {}, "zh-CN")).toBe("全部清除");
  });

  it("dates a notice by its time today, else its day", () => {
    const today = noticeTime(
      "2026-10-08T08:05:00",
      new Date("2026-10-08T12:00:00"),
    );
    expect(today).toMatch(/8:05/);
    const earlier = noticeTime(
      "2026-10-06T08:05:00",
      new Date("2026-10-08T12:00:00"),
    );
    expect(earlier).not.toMatch(/8:05/);
  });
});
