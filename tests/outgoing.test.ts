import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../shared/types";
import {
  inlineKey,
  isEcho,
  pendingOutgoing,
  type Outgoing,
} from "../src/outgoing";

const sent: Outgoing = {
  view: "session-1",
  text: "Hello",
  at: Date.parse("2026-10-05T00:00:00Z"),
};
const message = (text: string, at: string, type = "user.message"): AgentEvent =>
  ({
    id: `evt-${text}-${at}`,
    type,
    content: [{ type: "text", text }],
    created_at: at,
  }) as AgentEvent;

describe("Messages being sent", () => {
  it("shows a sent message in its chat until the history has it", () => {
    expect(pendingOutgoing(sent, "session-1", [])).toBe(sent);
    // Not in another chat.
    expect(pendingOutgoing(sent, "session-2", [])).toBeUndefined();
    // The history's copy takes its place.
    expect(
      pendingOutgoing(sent, "session-1", [
        message("Hello", "2026-10-05T00:00:01Z"),
      ]),
    ).toBeUndefined();
    expect(pendingOutgoing(undefined, "session-1", [])).toBeUndefined();
  });

  it("does not mistake an older message or a reply for the one sent", () => {
    // The same words sent long before are another message.
    expect(isEcho(message("Hello", "2026-10-04T20:00:00Z"), sent)).toBe(false);
    // The companion saying the same words is not the person's message.
    expect(
      isEcho(message("Hello", "2026-10-05T00:00:02Z", "agent.message"), sent),
    ).toBe(false);
    expect(isEcho(message("Hello!", "2026-10-05T00:00:02Z"), sent)).toBe(false);
    expect(
      pendingOutgoing(sent, "session-1", [
        message("Hello", "2026-10-04T20:00:00Z"),
      ]),
    ).toBe(sent);
  });

  it("waits for the photos sent with a message, not only its words", () => {
    const withPhoto: Outgoing = {
      ...sent,
      text: "",
      attachments: [
        { key: "file-photo", name: "IMG_0005.jpeg", kind: "image" },
        { key: `${inlineKey}note`, name: "note.txt", kind: "document" },
      ],
    };
    const photo = (fileId: string) =>
      ({
        id: `evt-${fileId}`,
        type: "user.message",
        content: [
          { type: "image", source: { type: "file", file_id: fileId } },
          {
            type: "document",
            source: { type: "text", media_type: "text/plain", data: "hi" },
            title: "note.txt",
          },
        ],
        created_at: "2026-10-05T00:00:01Z",
      }) as unknown as AgentEvent;
    expect(isEcho(photo("file-photo"), withPhoto)).toBe(true);
    // Another photo-only message is not this one.
    expect(isEcho(photo("file-other"), withPhoto)).toBe(false);
    expect(isEcho(message("", "2026-10-05T00:00:01Z"), withPhoto)).toBe(false);
  });
});
