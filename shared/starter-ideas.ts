import type { InspirationItem } from "./inspiration";

// Things the companion can already do, offered before any personal ideas
// have been found. They are app-authored and translated where shown.
const starters = [
  {
    emoji: "🏷️",
    title: "Waiting for a price drop? I’ll tell you when it fits your budget.",
    body: "Tell me what you want to buy and the most you want to pay. I’ll check the official price on a schedule and let you know as soon as it falls within your budget, with a link to buy.",
    prompt:
      "Help me watch a price: ask what I want and my budget, then set up a recurring check and tell me when it drops below it.",
  },
  {
    emoji: "🎉",
    title: "Name the occasion and I’ll plan the whole thing.",
    body: "Tell me what it is, how many people and your budget. I’ll put together the plan: a theme, the guest list, the invitation text, a timeline and a shopping list, and remind you of each step.",
    prompt:
      "Help me plan an event: ask about the occasion, guests and budget, then draft the plan, invitation and timeline, and set reminders.",
  },
  {
    emoji: "📬",
    title: "Let me sort your Lark messages and keep only what matters.",
    body: "Connect your Lark account and I’ll read through unread chats and mail, set aside announcements and routine notices, and give you a short list of what needs your reply.",
    prompt:
      "Help me triage my Lark messages: connect to Lark with minimal access, then summarize what needs my reply.",
  },
  {
    emoji: "🔍",
    title: "Comparing products? I’ll check the official sites side by side.",
    body: "Name two or three products. I’ll open their official pages in the cloud browser, compare prices and specs, save a screenshot of each as evidence, and put the comparison table in your Library.",
    prompt:
      "Help me compare products: ask which ones and what matters to me, then compare them from official pages and save a table to my Library.",
  },
  {
    emoji: "😴",
    title: "Sleeping badly? I’ll look at your nights and suggest one change.",
    body: "With Apple Health connected, I’ll read your recent sleep, spot patterns like late nights or frequent waking, and suggest one small change to try this week.",
    prompt:
      "Look at my recent sleep in Apple Health and suggest one small change to try this week.",
  },
  {
    emoji: "🏃",
    title: "A weekly recap of your workouts, every Sunday evening.",
    body: "I’ll read your workouts and activity from Apple Health each week, tell you how the week went compared with the last, and keep you on track toward your goal.",
    prompt:
      "Set up a weekly workout recap from Apple Health every Sunday evening.",
  },
  {
    emoji: "🧳",
    title: "Plan a weekend away that fits your time and budget.",
    body: "Tell me where you might go, when and how much you want to spend. I’ll suggest a route, places to stay and eat, and a packing list, and remind you before you leave.",
    prompt:
      "Help me plan a weekend trip: ask about destination, dates and budget, then suggest a plan and packing list.",
  },
  {
    emoji: "📚",
    title: "Too much to read? Send it to me for a one-page brief.",
    body: "Share a long article, report or PDF. I’ll pull out the main points, what they mean for you and what to do next, in a page you can read in two minutes.",
    prompt:
      "I’ll share something long to read; give me a one-page brief with the main points and next steps.",
  },
] as const;

export const starterIdeaPrefix = "starter-";

// The starters as idea items, with their copy passed through `translate`.
export function starterIdeas(
  translate: (text: string) => string,
): InspirationItem[] {
  return starters.map((idea, index) => ({
    id: `${starterIdeaPrefix}${index + 1}`,
    kind: "ideas",
    title: translate(idea.title),
    body: translate(idea.body),
    emoji: idea.emoji,
    reason: translate("Something Muse can already do for you."),
    category: translate("Getting started"),
    prompt: translate(idea.prompt),
    sources: [],
    session_id: "",
    event_id: "",
    created_at: "",
    liked: false,
  }));
}
