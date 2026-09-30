import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdentityCards } from "../src/CompanionSheet";
import { ChatHeader, ConversationSidebar } from "../src/ChatUI";
import { defaultIdentity } from "../src/direct/identity";
import { emptyConversations } from "../src/direct/conversations";

describe("Companion identity controls", () => {
  it("labels templates honestly and exposes both editable documents without resource IDs", () => {
    const html = renderToStaticMarkup(
      <IdentityCards
        identity={defaultIdentity()}
        disabled={false}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Open SOUL.md"');
    expect(html).toContain('aria-label="Open MEMORY.md"');
    expect(html).toContain("Not saved yet");
    expect(html).not.toContain("store_id");
    expect(html).not.toContain("Nightly");
  });
  it("disables document navigation while loading and exposes malformed identity warnings", () => {
    const html = renderToStaticMarkup(
      <IdentityCards
        identity={{ ...defaultIdentity(), warning: "Repair the saved name" }}
        disabled
        onOpen={() => {}}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Repair the saved name");
    expect(html).toContain('disabled="" aria-label="Open MEMORY.md"');
  });
  it("propagates the cloud name to the header and sidebar", () => {
    const header = renderToStaticMarkup(
      <ChatHeader
        name="Willow"
        status="Connected"
        onSidebar={() => {}}
        onMore={() => {}}
        onStatus={() => {}}
      />,
    );
    expect(header).toContain('aria-label="Willow status: Connected"');
    const sidebar = renderToStaticMarkup(
      <ConversationSidebar
        name="Willow"
        sessions={[]}
        index={emptyConversations()}
        onClose={() => {}}
        onNew={() => {}}
        onArchive={() => {}}
        busy={false}
      />,
    );
    expect(sidebar).toContain("<strong>Willow</strong>");
  });
});
