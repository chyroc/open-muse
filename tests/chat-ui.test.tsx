import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ChatComposer,
  ChatHeader,
  ConversationSidebar,
  QueuedMessages,
} from "../src/ChatUI";
import { t } from "../shared/i18n";
import { emptyConversations } from "../src/direct/conversations";

describe("Conversation controls", () => {
  it("has one message field without task types or technical resource IDs", () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        value="A thought"
        setValue={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        onAttach={() => {}}
        busy={false}
        running={false}
        disabled={false}
      />,
    );
    expect(html).toContain('aria-label="Message Muse"');
    expect(html).toContain('aria-label="Send message"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain("environment_id");
  });
  it("disables message submission while disconnected and exposes a stop control while running", () => {
    const props = {
      value: "Hi",
      setValue() {},
      onSend() {},
      onStop() {},
      onAttach() {},
      busy: false,
      disabled: true,
    };
    expect(
      renderToStaticMarkup(<ChatComposer {...props} running={false} />),
    ).toContain('aria-label="Send message" disabled=""');
    const running = renderToStaticMarkup(
      <ChatComposer {...props} disabled={false} running />,
    );
    expect(running).toContain('aria-label="Stop response"');
    expect(running).not.toContain('aria-label="Send message"');
  });
  it("queues text typed while a reply runs, and stops when there is none", () => {
    const props = {
      setValue() {},
      onSend() {},
      onQueue() {},
      onStop() {},
      onAttach() {},
      busy: false,
      disabled: false,
      running: true,
    };
    const typed = renderToStaticMarkup(
      <ChatComposer {...props} value="One more thing" />,
    );
    expect(typed).toContain('aria-label="Send after this reply"');
    expect(typed).not.toContain('aria-label="Stop response"');
    expect(
      renderToStaticMarkup(<ChatComposer {...props} value="  " />),
    ).toContain('aria-label="Stop response"');
    // Attachments are never queued: stop stays until the reply finishes.
    expect(
      renderToStaticMarkup(
        <ChatComposer {...props} value="With a photo" attachmentsReady />,
      ),
    ).toContain('aria-label="Stop response"');
    // Without a queue the composer only stops, as before.
    expect(
      renderToStaticMarkup(
        <ChatComposer {...props} onQueue={undefined} value="Hi" />,
      ),
    ).toContain('aria-label="Stop response"');
  });
  it("lists queued messages, removable, with a resume action once held", () => {
    const items = [
      { id: "a", text: "First follow-up" },
      { id: "b", text: "Second follow-up" },
    ];
    const next = renderToStaticMarkup(
      <QueuedMessages
        items={items}
        paused={false}
        onRemove={() => {}}
        onResume={() => {}}
      />,
    );
    expect(next).toContain("Up next");
    expect(next.indexOf("First follow-up")).toBeLessThan(
      next.indexOf("Second follow-up"),
    );
    expect(next.match(/Remove queued message/g)).toHaveLength(2);
    expect(next).not.toContain("Send queued messages");
    const held = renderToStaticMarkup(
      <QueuedMessages
        items={items}
        paused
        onRemove={() => {}}
        onResume={() => {}}
      />,
    );
    expect(held).toContain("Messages on hold");
    expect(held).toContain("Send queued messages");
    expect(
      renderToStaticMarkup(
        <QueuedMessages
          items={[]}
          paused={false}
          onRemove={() => {}}
          onResume={() => {}}
        />,
      ),
    ).toBe("");
    expect(t("Send after this reply", {}, "zh-CN")).toBe("这条回复结束后发送");
    expect(t("Send queued messages", {}, "zh-CN")).toBe("继续发送");
  });
  it("provides persistent main-chat navigation and side-chat creation/search", () => {
    const html = renderToStaticMarkup(
      <ConversationSidebar
        sessions={[]}
        index={emptyConversations()}
        onClose={() => {}}
        onNew={() => {}}
        onArchive={() => {}}
        busy={false}
      />,
    );
    expect(html).toContain("Main chat");
    expect(html).toContain('aria-label="New side chat"');
    expect(html).toContain('aria-label="Search conversations"');
    expect(html).toContain('aria-label="Show archived chats"');
    expect(html).not.toContain("No tasks");
  });
  it("does not list archived sessions among active side chats or duplicate the main chat", () => {
    const session = {
      status: "idle" as const,
      category: "general" as const,
      created_at: "",
      updated_at: "",
    };
    const html = renderToStaticMarkup(
      <ConversationSidebar
        sessions={[
          { ...session, id: "main", title: "Main session title" },
          { ...session, id: "archived", title: "Archived title" },
          { ...session, id: "legacy", title: "My previous work" },
        ]}
        index={{
          mainId: "main",
          entries: {
            archived: { kind: "side", title: "Archived title", archived: true },
          },
        }}
        onClose={() => {}}
        onNew={() => {}}
        onArchive={() => {}}
        busy={false}
      />,
    );
    expect(html).not.toContain("Main session title");
    expect(html).not.toContain("Archived title");
    expect(html).toContain("My previous work");
  });
  it("announces actual connection state without inventing a connected status", () => {
    const html = renderToStaticMarkup(
      <ChatHeader
        status="Not connected"
        onSidebar={() => {}}
        onStatus={() => {}}
        onMore={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Muse status: Not connected"');
  });
});
