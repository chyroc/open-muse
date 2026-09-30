import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatComposer, ChatHeader, ConversationSidebar } from "../src/ChatUI";
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
