import { eventText, type AgentEvent, type Session } from "../../shared/types";
import { t } from "../../shared/i18n";
import { messageAttachments } from "../../shared/attachments";
import type { ConversationIndex } from "../../src/direct/conversations";
import type { LibraryView } from "./library";

export type Page = "chat" | "feed" | "ideas" | "goals" | "library";
export type Route = {
  page: Page;
  conversation?: string;
  newSide?: boolean;
  goal?: string;
  libraryView?: LibraryView;
  // A post or idea to bring into view: its id, or for messages that predate
  // ids, its title.
  focus?: { id?: string; title?: string };
};

// App-initiated prompts (welcome, check-in) stay in MA history but are not
// the person's words, so the chat never shows them.
export function chatMessages(events: AgentEvent[]) {
  return events.filter(
    (event) =>
      ["user.message", "agent.message"].includes(event.type) &&
      !event.app_initiation &&
      (eventText(event) || messageAttachments(event).length),
  );
}

// Built-in, MCP and this device's own tools (Mac control, Apple Health) all
// count as work the assistant did.
const toolUseTypes = new Set([
  "agent.tool_use",
  "agent.mcp_tool_use",
  "agent.custom_tool_use",
]);

export function activityEvents(events: AgentEvent[]) {
  return events.filter((event) => toolUseTypes.has(event.type));
}

// Plain-language names for the tools the activity list shows. Unknown tools,
// such as a person's own MCP or custom tools, keep their protocol name.
const activityLabels: Record<string, string> = {
  memory_ls: "Read personal memory",
  memory_read: "Read personal memory",
  memory_edit: "Update personal memory",
  memory_write: "Update personal memory",
  web_search: "Search the web",
  web_fetch: "Read a web page",
  bash: "Run a command",
  read: "Read a file",
  write: "Write a file",
  edit: "Write a file",
  glob: "Search files",
  grep: "Search files",
  mac_screenshot: "Look at the screen",
  mac_action: "Use your Mac",
  mac_open: "Open on your Mac",
  mac_apps: "Check open apps",
  mac_calendar: "Read your calendar",
  mac_location: "Check your location",
  health_read: "Read Apple Health",
  iphone_personal: "Read from your iPhone",
};

export function activityLabel(name: string | undefined) {
  if (!name) return t("Tool call");
  const label = activityLabels[name];
  return label ? t(label) : name;
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
  const item = /^\/(feed|ideas)\/(id|title)\/([^/?#]{1,600})$/.exec(path);
  if (item) {
    let value = "";
    try {
      value = decodeURIComponent(item[3]);
    } catch {
      return { page: item[1] as Page };
    }
    return {
      page: item[1] as Page,
      focus: item[2] === "id" ? { id: value } : { title: value },
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
      !session.generation &&
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
