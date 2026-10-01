import type { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { macOwner } from "./owner";

// A mood left on a message stays on this Mac, in the account's scope. It is
// not sent to MA or shared with other devices.
export const moods = ["❤️", "😂", "😮", "😢", "👍", "👎"] as const;
export type Mood = (typeof moods)[number];
type Reactions = Record<string, Mood>;

const database = new LocalDatabase();
const key = (client: Client) => `${macOwner(client)}:macos-reactions:v1`;

export async function readReactions(client: Client, db = database) {
  return (await db.get<Reactions>(key(client))) ?? {};
}

// Choosing the current mood again clears it.
export function setReaction(
  client: Client,
  eventId: string,
  mood: Mood,
  db = database,
) {
  return db.update<Reactions>(key(client), (old) => {
    const next = { ...(old ?? {}) };
    if (next[eventId] === mood) delete next[eventId];
    else next[eventId] = mood;
    return next;
  });
}
