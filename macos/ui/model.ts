import { eventText, type AgentEvent, type Session } from "../../shared/types";
import type { ConversationIndex } from "../../src/direct/conversations";
import type { LibraryView } from "./library";

export type Page = "chat" | "feed" | "ideas" | "goals" | "library";
export type Route = {
  page: Page;
  conversation?: string;
  newSide?: boolean;
  goal?: string;
  libraryView?: LibraryView;
};

export function chatMessages(events: AgentEvent[]) {
  return events.filter(
    (event) =>
      ["user.message", "agent.message"].includes(event.type) &&
      eventText(event),
  );
}

export function activityEvents(events: AgentEvent[]) {
  return events.filter((event) => event.type === "agent.tool_use");
}

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "");
  if (path === "/new") return { page: "chat", newSide: true };
  const match = /^\/chat\/([\w-]{1,200})$/.exec(path);
  if (match) return { page: "chat", conversation: match[1] };
  const goal = /^\/goals\/([\w-]{1,80})$/.exec(path);
  if (goal) return { page: "goals", goal: goal[1] };
  const library =
    /^\/library(?:\/(artifacts|media|podcasts|files))?(?:\?view=(all|documents|web|images|video))?$/.exec(
      path,
    );
  if (library) {
    const section = library[1];
    const view = library[2];
    return {
      page: "library",
      libraryView:
        section === "files" || section === "podcasts"
          ? section
          : section === "media"
            ? view === "video"
              ? "video"
              : "images"
            : view === "documents" || view === "web"
              ? view
              : "all",
    };
  }
  if (["/feed", "/ideas", "/goals", "/library"].includes(path))
    return { page: path.slice(1) as Page };
  return { page: "chat" };
}

export function sideChats(
  sessions: Session[],
  index: ConversationIndex,
  query: string,
  archived = false,
) {
  const term = query.trim().toLocaleLowerCase();
  return sessions.filter((session) => {
    const entry = index.entries[session.id];
    return (
      session.id !== index.mainId &&
      !entry?.continuedBy &&
      Boolean(entry?.archived) === archived &&
      (entry?.title ?? session.title).toLocaleLowerCase().includes(term)
    );
  });
}

export function shouldSendOnKey(event: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
