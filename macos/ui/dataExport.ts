import { formatLocale, t } from "../../shared/i18n";
import { eventText, type AgentEvent } from "../../shared/types";
import type { Client } from "../../src/api";
import { exportLibraryDocument } from "./library";

// Everything this account's companion keeps, gathered into one Markdown file.
// It only reads from MA; nothing is changed or sent.
export async function agentDataMarkdown(client: Client, name: string) {
  const lines = [
    `# ${t("Open Muse data")}`,
    "",
    t("Exported {date}", { date: new Date().toLocaleString(formatLocale()) }),
    "",
  ];
  const identity = await client.companionIdentity();
  lines.push(`## ${t("Memory")}`, "");
  for (const document of Object.values(identity.documents))
    lines.push(`### ${document.name}`, "", document.content.trim(), "");
  const goals = await client.goals().catch(() => ({ data: [] }));
  lines.push(`## ${t("Goals")}`, "");
  for (const goal of goals.data)
    lines.push(
      `- ${goal.title} (${goal.status})${goal.description ? `: ${goal.description}` : ""}`,
    );
  const upcoming = await client.upcoming().catch(() => ({ items: [] }));
  lines.push("", `## ${t("Upcoming")}`, "");
  for (const item of upcoming.items)
    lines.push(`- ${item.title} (${item.status}): ${item.instruction}`);
  const [sessions, index] = await Promise.all([
    client.sessions(),
    client.conversationIndex(),
  ]);
  lines.push("", `## ${t("Conversations")}`);
  for (const session of sessions.data) {
    const title =
      session.id === index.mainId
        ? t("Main chat")
        : (index.entries[session.id]?.title ?? session.title);
    const events: AgentEvent[] = await client.events(session.id);
    lines.push("", `### ${title}`, "");
    for (const event of events) {
      if (event.app_initiation) continue;
      if (!["user.message", "agent.message"].includes(event.type)) continue;
      const text = eventText(event).trim();
      if (!text) continue;
      lines.push(
        `**${event.type === "user.message" ? t("Me") : name}:** ${text}`,
        "",
      );
    }
  }
  return lines.join("\n");
}

export function downloadAgentData(
  client: Client,
  name: string,
  signal: AbortSignal,
) {
  return agentDataMarkdown(client, name).then((text) =>
    exportLibraryDocument(
      {
        id: "export",
        title: `${t("Open Muse data")} ${new Date().toISOString().slice(0, 10)}`,
        text,
        session_id: "export",
        event_id: "export",
        created_at: new Date().toISOString(),
      },
      signal,
    ),
  );
}

// The prompt to give another assistant, and the draft made from its answer.
export const memoryExportPrompt = () =>
  t(
    "List everything you remember about me: my name, where I live and work, the people in my life, my preferences, routines, ongoing projects and goals. Write each as a short plain sentence. Do not include passwords, account numbers or one-time codes.",
  );
export const memoryImportDraft = (pasted: string) =>
  `${t(
    "Please add what's useful from this to my memory. It comes from another assistant, so check with me where it conflicts with what you already know:",
  )}\n\n${pasted.trim()}`;

export function draftInMainChat(text: string) {
  const bridge = (
    window as unknown as {
      webkit?: {
        messageHandlers?: { museWindow?: { postMessage: (v: object) => void } };
      };
    }
  ).webkit?.messageHandlers?.museWindow;
  if (!bridge) return false;
  bridge.postMessage({ name: "draft", value: text.slice(0, 16000) });
  return true;
}
