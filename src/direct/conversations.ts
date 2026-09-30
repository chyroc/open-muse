import { ApiError } from "../../shared/ark";
import { uuid } from "../../shared/crypto";
import type { Category, Session } from "../../shared/types";
import { LocalDatabase } from "./storage";

export type ConversationKind = "main" | "side";
export interface ConversationIndex {
  mainId?: string;
  sending?: { session: string; event: string };
  entries: Record<
    string,
    {
      title: string;
      kind: ConversationKind;
      archived: boolean;
      previousIds?: string[];
      continuedBy?: string;
    }
  >;
  pending?: {
    token: string;
    title: string;
    kind: ConversationKind;
    category: Category;
    previous?: string;
    phase?: "preparing" | "creating";
  };
}
export const emptyConversations = (): ConversationIndex => ({ entries: {} });
type Remote = {
  list(): Promise<Session[]>;
  get(id: string): Promise<Session>;
  prepare(previous?: Session): Promise<void>;
  needsContinuation?(session: Session): Promise<boolean>;
  create(title: string, category: Category): Promise<Session>;
  rename(id: string, title: string): Promise<unknown>;
};

export function currentConversation(index: ConversationIndex, id: string) {
  const seen = new Set<string>();
  while (index.entries[id]?.continuedBy) {
    if (seen.has(id))
      throw new ApiError(
        409,
        "Conversation links are inconsistent. No messages were sent.",
      );
    seen.add(id);
    id = index.entries[id].continuedBy!;
  }
  return id;
}

// A device-local index, scoped to the same identity as the rest of the client.
// Old cloud sessions remain accessible as side chats; none are renamed or removed
// during migration. Opening the app alone never provisions a cloud conversation.
export class Conversations {
  private storageKey: string;
  constructor(
    key: string,
    private db: LocalDatabase,
    private remote: Remote,
  ) {
    this.storageKey = `${key}:conversations:v1`;
  }
  async index() {
    return (
      (await this.db.get<ConversationIndex>(this.storageKey)) ??
      emptyConversations()
    );
  }
  private update(fn: (index: ConversationIndex) => void) {
    return this.db.update<ConversationIndex>(this.storageKey, (old) => {
      const value = old ?? emptyConversations();
      fn(value);
      return value;
    });
  }
  async archive(session: Session, archived: boolean) {
    return this.update((index) => {
      if (session.id === index.mainId || index.entries[session.id]?.continuedBy)
        throw new ApiError(409, "The main chat cannot be archived.");
      index.entries[session.id] = {
        title: index.entries[session.id]?.title ?? session.title,
        kind: "side",
        archived,
      };
    });
  }
  async claimSend(id: string, event: string) {
    const index = await this.index();
    if (index.mainId !== id && !index.entries[id]?.continuedBy) return false;
    await this.update((current) => {
      if (current.entries[id]?.continuedBy || current.mainId !== id)
        throw new ApiError(
          409,
          "This chat has continued. Refresh before sending; no message was submitted to the older conversation.",
        );
      if (current.pending?.previous === id)
        throw new ApiError(
          409,
          "Your main conversation is being prepared. Resume it before sending.",
        );
      if (current.sending)
        throw new ApiError(
          409,
          "A main-chat message is unconfirmed or still being sent. Refresh history before submitting another.",
        );
      current.sending = { session: id, event };
    });
    return true;
  }
  async confirmSend(id: string, eventIds: string[]) {
    const current = await this.index();
    if (
      current.sending?.session !== id ||
      !eventIds.includes(current.sending.event)
    )
      return;
    await this.update((index) => {
      if (
        index.sending?.session === id &&
        eventIds.includes(index.sending.event)
      )
        delete index.sending;
    });
  }
  async create(
    kind: ConversationKind,
    title: string,
    category: Category,
  ): Promise<Session> {
    let index = await this.index();
    if (index.pending?.previous) {
      if (kind !== "main")
        throw new ApiError(
          409,
          "The main conversation update is unfinished. Return to the main chat and resume it first.",
        );
      return this.resumeContinuation(index.pending);
    }
    if (kind === "main" && index.mainId) {
      const main = await this.remote.get(index.mainId);
      if (await this.remote.needsContinuation?.(main)) {
        const pending: NonNullable<ConversationIndex["pending"]> = {
          token: `open-muse-pending-${uuid()}`,
          title: index.entries[main.id]?.title ?? "Main chat",
          kind: "main",
          category: main.category ?? category,
          previous: main.id,
          phase: "preparing",
        };
        await this.update((current) => {
          if (current.pending || current.sending || current.mainId !== main.id)
            throw new ApiError(
              409,
              "Another operation is updating this conversation. Refresh to continue.",
            );
          current.pending = pending;
        });
        return this.resumeContinuation(pending);
      }
      if (main.status === "terminated")
        throw new ApiError(
          409,
          "The main chat has ended. Open a side chat to continue; its history is preserved.",
        );
      return { ...main, title: index.entries[main.id]?.title ?? "Main chat" };
    }
    if (index.pending) {
      const pending = index.pending;
      // A random marker saved before POST allows recovery after timeout/relaunch.
      // Friendly titles are not proof of ownership and are never used to recover.
      const rows = await this.remote.list();
      const matches = rows.filter((s) => s.title === pending.token);
      if (matches.length !== 1)
        throw new ApiError(
          409,
          "A conversation creation is unconfirmed. Refresh history and try again later; no duplicate was created.",
        );
      const recovered = await this.finish(pending, matches[0]);
      if (
        pending.kind !== kind ||
        pending.title !== title ||
        pending.category !== category
      )
        throw new ApiError(
          409,
          "The previous conversation was recovered. Open it from the sidebar before starting another.",
        );
      return recovered;
    }
    await this.remote.prepare();
    const pending: NonNullable<ConversationIndex["pending"]> = {
      token: `open-muse-pending-${uuid()}`,
      title,
      kind,
      category,
    };
    index = await this.update((current) => {
      if (current.pending || (kind === "main" && current.mainId))
        throw new ApiError(
          409,
          "Another window is opening this conversation. Refresh to continue.",
        );
      current.pending = pending;
    });
    let session: Session;
    try {
      session = await this.remote.create(pending.token, category);
      if (!session.id || !/^[\w-]{1,200}$/.test(session.id))
        throw new ApiError(
          502,
          "The conversation creation result is unconfirmed. Refresh history before retrying.",
        );
    } catch (error) {
      if (
        error instanceof ApiError &&
        [400, 401, 403, 404, 413, 429].includes(error.status)
      )
        await this.update((current) => {
          if (current.pending?.token === pending.token) delete current.pending;
        });
      throw error;
    }
    return this.finish(index.pending!, session);
  }
  private async resumeContinuation(
    pending: NonNullable<ConversationIndex["pending"]>,
  ) {
    if (pending.phase !== "preparing") {
      const rows = await this.remote.list();
      const matches = rows.filter((row) => row.title === pending.token);
      if (matches.length !== 1)
        throw new ApiError(
          409,
          "The main conversation update is unconfirmed. Refresh before trying again; no duplicate was created.",
        );
      return this.finish(pending, matches[0]);
    }
    // Freeze local writes to the old chapter before taking its snapshot. This
    // phase can be resumed: prepare only verifies or creates immutable archives.
    await this.remote.prepare(await this.remote.get(pending.previous!));
    await this.update((index) => {
      if (
        index.pending?.token !== pending.token ||
        index.pending.phase !== "preparing" ||
        index.mainId !== pending.previous
      )
        throw new ApiError(
          409,
          "Another window is continuing this chat. Refresh history before sending.",
        );
      index.pending.phase = "creating";
    });
    let session: Session;
    try {
      session = await this.remote.create(pending.token, pending.category);
      if (
        !session.id ||
        !/^[\w-]{1,200}$/.test(session.id) ||
        session.id === pending.previous
      )
        throw new ApiError(
          502,
          "The continuation result is unconfirmed. Refresh before trying again.",
        );
    } catch (error) {
      if (
        error instanceof ApiError &&
        [400, 401, 403, 404, 413, 429].includes(error.status)
      )
        await this.update((index) => {
          if (index.pending?.token === pending.token)
            index.pending.phase = "preparing";
        });
      throw error;
    }
    return this.finish(pending, session);
  }
  private async finish(
    pending: NonNullable<ConversationIndex["pending"]>,
    session: Session,
  ) {
    await this.update((index) => {
      if (index.pending?.token !== pending.token) {
        if (index.entries[session.id]) return;
        throw new ApiError(
          409,
          "Conversation state changed. Refresh history before continuing.",
        );
      }
      if (pending.previous && index.mainId !== pending.previous)
        throw new ApiError(
          409,
          "The main conversation changed during continuation. Its history has not been replaced.",
        );
      const previousIds = pending.previous
        ? [
            ...(index.entries[pending.previous]?.previousIds ?? []),
            pending.previous,
          ]
        : undefined;
      index.entries[session.id] = {
        title: pending.title,
        kind: pending.kind,
        archived: false,
        ...(previousIds ? { previousIds } : {}),
      };
      if (pending.previous)
        index.entries[pending.previous] = {
          ...index.entries[pending.previous],
          title: pending.title,
          kind: "main",
          archived: false,
          continuedBy: session.id,
        };
      if (pending.kind === "main") index.mainId = session.id;
      delete index.pending;
    });
    // The ID is durable before this cosmetic update. A failed rename must never
    // turn a confirmed creation into a duplicate creation on the next attempt.
    try {
      await this.remote.rename(session.id, pending.title);
    } catch {
      /* Local title remains authoritative. */
    }
    return { ...session, title: pending.title, category: pending.category };
  }
}
