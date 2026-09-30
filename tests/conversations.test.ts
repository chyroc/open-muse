import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  Conversations,
  currentConversation,
} from "../src/direct/conversations";
import { LocalDatabase } from "../src/direct/storage";
import { uuid } from "../shared/crypto";
import { ApiError } from "../shared/ark";
import { IncompatibleConversation } from "../shared/session-refresh";
import type { Category, Session } from "../shared/types";

function fixture() {
  const database = new LocalDatabase(`conversation-test-${uuid()}`);
  const rows: Session[] = [];
  const remote = {
    list: vi.fn(async () => rows),
    get: vi.fn(async (id: string) => {
      const row = rows.find((s) => s.id === id);
      if (!row) throw new ApiError(404, "Not found");
      return row;
    }),
    prepare: vi.fn(async (_previous?: Session) => {}),
    needsContinuation: vi.fn(async (_session: Session) => false),
    create: vi.fn(async (title: string, category: Category) => {
      const session: Session = {
        id: uuid(),
        title,
        category,
        status: "idle",
        created_at: "",
        updated_at: "",
      };
      rows.push(session);
      return session;
    }),
    rename: vi.fn(async (id: string, title: string) => {
      rows.find((s) => s.id === id)!.title = title;
    }),
  };
  return {
    database,
    remote,
    rows,
    store: new Conversations("identity-a", database, remote),
  };
}
describe("Main and side conversations", () => {
  it("releases only a recognized incompatible preparation so a side chat can still be created", async () => {
    const f = fixture();
    const original = await f.store.create("main", "Main chat", "general");
    f.remote.needsContinuation.mockResolvedValue(true);
    f.remote.prepare.mockRejectedValueOnce(new IncompatibleConversation());
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("history is intact");
    expect((await f.store.index()).pending).toBeUndefined();
    expect((await f.store.index()).mainId).toBe(original.id);
    const side = await f.store.create("side", "Continue safely", "general");
    expect((await f.store.index()).entries[side.id].kind).toBe("side");
    expect(f.remote.create).toHaveBeenCalledTimes(2);
  });
  it("continues the main chat as linked chapters without deleting or hiding its history", async () => {
    const f = fixture();
    const original = await f.store.create("main", "Main chat", "general");
    const side = await f.store.create("side", "A separate topic", "general");
    f.remote.needsContinuation.mockImplementation(
      async (row) => row.id === original.id,
    );
    const continued = await f.store.create("main", "Main chat", "general");
    const index = await f.store.index();
    expect(continued.id).not.toBe(original.id);
    expect(index.mainId).toBe(continued.id);
    expect(index.entries[continued.id].previousIds).toEqual([original.id]);
    expect(currentConversation(index, original.id)).toBe(continued.id);
    expect(currentConversation(index, side.id)).toBe(side.id);
    expect(f.rows).toHaveLength(3);
    expect((await f.store.create("main", "Main chat", "general")).id).toBe(
      continued.id,
    );
    await expect(f.store.archive(original, true)).rejects.toThrow(
      "cannot be archived",
    );
    await expect(f.store.claimSend(original.id, "new-event")).rejects.toThrow(
      "has continued",
    );
  });
  it("retains older chapters over successive continuations", async () => {
    const f = fixture();
    const first = await f.store.create("main", "Main chat", "general");
    f.remote.needsContinuation.mockResolvedValue(true);
    const second = await f.store.create("main", "Main chat", "general");
    const third = await f.store.create("main", "Main chat", "general");
    const index = await f.store.index();
    expect(index.entries[third.id].previousIds).toEqual([first.id, second.id]);
    expect(currentConversation(index, first.id)).toBe(third.id);
  });
  it("resumes failed preparation without submitting a duplicate session", async () => {
    const f = fixture();
    const original = await f.store.create("main", "Main chat", "general");
    f.remote.needsContinuation.mockResolvedValue(true);
    f.remote.prepare.mockRejectedValueOnce(
      new TypeError("Archive read failed"),
    );
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("Archive read failed");
    expect((await f.store.index()).mainId).toBe(original.id);
    expect((await f.store.index()).pending?.phase).toBe("preparing");
    await expect(f.store.claimSend(original.id, "too-early")).rejects.toThrow(
      "being prepared",
    );
    await expect(
      f.store.create("side", "Another topic", "general"),
    ).rejects.toThrow("unfinished");
    const restored = new Conversations("identity-a", f.database, f.remote);
    const continued = await restored.create("main", "Main chat", "general");
    expect((await restored.index()).entries[continued.id].previousIds).toEqual([
      original.id,
    ]);
    expect(f.remote.create).toHaveBeenCalledTimes(2);
  });
  it("recovers an accepted continuation after the create response is lost", async () => {
    const f = fixture();
    const original = await f.store.create("main", "Main chat", "general");
    f.remote.needsContinuation.mockResolvedValue(true);
    const create = f.remote.create.getMockImplementation()!;
    f.remote.create.mockImplementationOnce(async (title, category) => {
      await create(title, category);
      throw new TypeError("Response lost");
    });
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("Response lost");
    expect((await f.store.index()).mainId).toBe(original.id);
    const restored = new Conversations("identity-a", f.database, f.remote);
    const continued = await restored.create("main", "Main chat", "general");
    expect(continued.id).toBe(f.rows[1].id);
    expect(f.remote.create).toHaveBeenCalledTimes(2);
    expect((await restored.index()).pending).toBeUndefined();
  });
  it("does not repeat an unresolved continuation POST", async () => {
    const f = fixture();
    await f.store.create("main", "Main chat", "general");
    f.remote.needsContinuation.mockResolvedValue(true);
    f.remote.create.mockRejectedValueOnce(new TypeError("Network lost"));
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("Network lost");
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("unconfirmed");
    expect(f.remote.create).toHaveBeenCalledTimes(2);
  });
  it("rechecks preparation after a definitive continuation rejection", async () => {
    const f = fixture();
    await f.store.create("main", "Main chat", "general");
    f.remote.needsContinuation.mockResolvedValue(true);
    f.remote.create.mockRejectedValueOnce(new ApiError(429, "Throttled"));
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("Throttled");
    expect((await f.store.index()).pending?.phase).toBe("preparing");
    await f.store.create("main", "Main chat", "general");
    expect(f.remote.prepare).toHaveBeenCalledTimes(3);
  });
  it("serializes continuation and main-message submissions across local windows", async () => {
    const f = fixture();
    const original = await f.store.create("main", "Main chat", "general");
    f.remote.needsContinuation.mockResolvedValue(true);
    const other = new Conversations("identity-a", f.database, f.remote);
    await f.store.claimSend(original.id, "in-flight-message");
    await expect(other.create("main", "Main chat", "general")).rejects.toThrow(
      "Another operation",
    );
    await expect(other.claimSend(original.id, "duplicate")).rejects.toThrow(
      "unconfirmed",
    );
    await other.confirmSend(original.id, ["unrelated"]);
    expect((await f.store.index()).sending?.event).toBe("in-flight-message");
    await other.confirmSend(original.id, ["in-flight-message"]);
    await Promise.allSettled([
      f.store.create("main", "Main chat", "general"),
      other.create("main", "Main chat", "general"),
    ]);
    expect(f.remote.create).toHaveBeenCalledTimes(2);
  });
  it("does not create or mutate cloud records during navigation", async () => {
    const f = fixture();
    expect(await f.store.index()).toEqual({ entries: {} });
    expect(f.remote.prepare).not.toHaveBeenCalled();
    expect(f.remote.create).not.toHaveBeenCalled();
  });
  it("reuses the main session after relaunch and preserves independent side chats", async () => {
    const f = fixture();
    const main = await f.store.create("main", "Main chat", "general");
    const side = await f.store.create("side", "A project", "code");
    const restored = new Conversations("identity-a", f.database, f.remote);
    expect((await restored.create("main", "Main chat", "general")).id).toBe(
      main.id,
    );
    expect((await restored.index()).entries[side.id].kind).toBe("side");
    expect(f.remote.create).toHaveBeenCalledTimes(2);
    expect(f.remote.rename).toHaveBeenCalledWith(main.id, "Main chat");
  });
  it("isolates main session and archive state by identity", async () => {
    const f = fixture();
    await f.store.create("main", "Main chat", "general");
    expect(
      await new Conversations("identity-b", f.database, f.remote).index(),
    ).toEqual({ entries: {} });
  });
  it("archives legacy sessions locally without renaming or deleting them", async () => {
    const f = fixture();
    const old = {
      id: "legacy",
      title: "Existing work",
      status: "idle",
      category: "general",
      created_at: "",
      updated_at: "",
    } as Session;
    await f.store.archive(old, true);
    expect((await f.store.index()).entries.legacy.archived).toBe(true);
    await f.store.archive(old, false);
    expect((await f.store.index()).entries.legacy.archived).toBe(false);
    expect(f.remote.rename).not.toHaveBeenCalled();
  });
  it("prevents archiving the main conversation", async () => {
    const f = fixture();
    const main = await f.store.create("main", "Main chat", "general");
    await expect(f.store.archive(main, true)).rejects.toThrow(
      "cannot be archived",
    );
  });
  it("does not replace a missing or terminated main chat automatically", async () => {
    const f = fixture();
    await f.store.create("main", "Main chat", "general");
    f.rows[0].status = "terminated";
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("has ended");
    f.rows.length = 0;
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("Not found");
    expect(f.remote.create).toHaveBeenCalledTimes(1);
  });
  it("blocks duplicates after ambiguous failure when recovery finds no matching marker", async () => {
    const f = fixture();
    f.remote.create.mockRejectedValueOnce(new TypeError("Network lost"));
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("Network lost");
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("unconfirmed");
    expect(f.remote.create).toHaveBeenCalledTimes(1);
  });
  it("recovers a committed POST after timeout/relaunch before sending another POST", async () => {
    const f = fixture();
    const create = f.remote.create.getMockImplementation()!;
    f.remote.create.mockImplementationOnce(async (title, category) => {
      await create(title, category);
      throw new TypeError("Network lost");
    });
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow();
    const restored = new Conversations("identity-a", f.database, f.remote);
    expect((await restored.create("main", "Main chat", "general")).id).toBe(
      f.rows[0].id,
    );
    expect(f.remote.create).toHaveBeenCalledTimes(1);
    expect((await restored.index()).pending).toBeUndefined();
  });
  it("does not adopt an unrelated session just because its title matches", async () => {
    const f = fixture();
    f.rows.push({
      id: "unrelated",
      title: "Main chat",
      status: "idle",
      category: "general",
      created_at: "",
      updated_at: "",
    });
    const session = await f.store.create("main", "Main chat", "general");
    expect(session.id).not.toBe("unrelated");
    expect(f.rows[0].title).toBe("Main chat");
  });
  it("recovers an earlier side chat without sending a new topic into it", async () => {
    const f = fixture();
    const create = f.remote.create.getMockImplementation()!;
    f.remote.create.mockImplementationOnce(async (title, category) => {
      await create(title, category);
      throw new TypeError("Network lost");
    });
    await expect(
      f.store.create("side", "First topic", "general"),
    ).rejects.toThrow();
    await expect(
      f.store.create("side", "Different topic", "general"),
    ).rejects.toThrow("previous conversation was recovered");
    expect((await f.store.index()).entries[f.rows[0].id].title).toBe(
      "First topic",
    );
    expect(f.remote.create).toHaveBeenCalledTimes(1);
  });
  it("retains the confirmed ID even when cosmetic title update fails", async () => {
    const f = fixture();
    f.remote.rename.mockRejectedValueOnce(new TypeError("Network lost"));
    const main = await f.store.create("main", "Main chat", "general");
    expect((await f.store.create("main", "Main chat", "general")).id).toBe(
      main.id,
    );
    expect(f.remote.create).toHaveBeenCalledTimes(1);
  });
  it("releases a definitely rejected creation but not a potentially committed one", async () => {
    const f = fixture();
    f.remote.create.mockRejectedValueOnce(new ApiError(400, "Rejected"));
    await expect(
      f.store.create("main", "Main chat", "general"),
    ).rejects.toThrow("Rejected");
    expect((await f.store.index()).pending).toBeUndefined();
    await f.store.create("main", "Main chat", "general");
    expect(f.remote.create).toHaveBeenCalledTimes(2);
  });
  it("serializes concurrent windows through an IndexedDB transaction", async () => {
    const f = fixture();
    const second = new Conversations("identity-a", f.database, f.remote);
    await Promise.allSettled([
      f.store.create("main", "Main chat", "general"),
      second.create("main", "Main chat", "general"),
    ]);
    expect(f.remote.create).toHaveBeenCalledTimes(1);
    expect((await f.store.index()).mainId).toBe(f.rows[0].id);
  });
});
