import { canonicalJson } from "../../shared/session-refresh";
import { digest, uuid } from "../../shared/crypto";
import { modelChoiceInput } from "../../shared/models";
import type { InspirationItem } from "../../shared/inspiration";
import type { LibraryItem } from "../../shared/types";
import {
  FEED_SETTINGS_ID,
  MAIN_CHAT_ID,
  MODEL_ITEM_ID,
  SYNC_LIMITS,
  syncNamespaces,
  syncValue,
  type MainChatValue,
  type SyncItem,
  type SyncMutation,
  type SyncNamespace,
  type SyncPullResponse,
  type SyncPushResponse,
} from "../../shared/account-sync";
import type { ConversationIndex } from "./conversations";
import type { LocalDatabase } from "./storage";

// Keeps the account's chosen model, Feed reactions and posts, saved replies,
// archived side chats, and main chat in step across the account's devices.
//
// Each item has a base: the copy last known to match the service. A local
// value that differs from its base goes to an outbox (persisted with a stable
// mutation ID before it is sent) and is written at the base revision only.
// When the service has a newer copy, it is merged field by field against the
// base: a field changed only here is kept and sent again on top of the
// service's copy; a field changed on both sides takes the service's value and
// counts as a conflict. A value the service rejects stays on this device and
// is not offered again until it changes.
//
// Only account builds sync, and only the signed-in account's own workspace:
// the outbox lives under the workspace key, which includes the verified
// account, so signing out or switching accounts never sends another
// account's pending changes.
export type SyncTransport = {
  pull(workspace: string, after: number): Promise<SyncPullResponse>;
  push(workspace: string, mutations: SyncMutation[]): Promise<SyncPushResponse>;
};
// Reads and changes one namespace's local records. `update` runs `change`
// inside one local transaction with the item's current value (null when
// absent, undefined when the item does not apply on this device) and writes
// what it returns; undefined leaves the record untouched.
export type SyncAdapter = {
  namespace: SyncNamespace;
  snapshot(): Promise<{ values: Map<string, unknown>; ignored: Set<string> }>;
  update(id: string, change: (local: unknown) => unknown): Promise<void>;
  // Whether this app can use a value the service holds.
  accepts?(id: string, value: unknown): boolean;
};
type Base = { revision: number; value: unknown; skip?: string };
type Pending = { mutation_id: string; value: unknown; base_revision: number };
type State = {
  owner: string;
  cursor: number;
  base: Record<string, Base>;
  outbox: Record<string, Pending>;
};
export type SyncReport = {
  pulled: number;
  // Local records changed by the service's copies.
  applied: number;
  pushed: number;
  conflicts: number;
  rejected: number;
};

const same = (a: unknown, b: unknown) =>
  canonicalJson(a ?? null) === canonicalJson(b ?? null);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const itemKey = (namespace: string, id: string) => `${namespace}/${id}`;

// Three-way merge of a local value with the service's copy against the base.
export function mergeSynced(
  base: unknown,
  local: unknown,
  server: unknown,
): { value: unknown; conflict: boolean } {
  if (same(local, base)) return { value: server ?? null, conflict: false };
  if (same(server, base) || same(server, local))
    return { value: local ?? null, conflict: false };
  if (isRecord(base) && isRecord(local) && isRecord(server)) {
    const value: Record<string, unknown> = { ...server };
    let conflict = false;
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(server),
    ])) {
      if (same(local[key], base[key])) continue;
      if (same(server[key], base[key])) {
        if (local[key] === undefined) delete value[key];
        else value[key] = local[key];
      } else if (!same(server[key], local[key])) conflict = true;
    }
    return { value, conflict };
  }
  return { value: server ?? null, conflict: true };
}

export class AccountSync {
  private key: string;
  private running?: Promise<SyncReport>;
  private timer?: ReturnType<typeof setTimeout>;
  private lastRun = 0;
  // Called after a pass that changed a local record.
  onApplied?: () => void;
  constructor(
    private db: LocalDatabase,
    readonly owner: string,
    readonly workspace: string,
    private transport: SyncTransport,
    private adapters: SyncAdapter[],
    // False once the account, key, or runtime this instance belongs to is
    // gone; nothing is sent or applied after that.
    private active: () => boolean,
    private now: () => number = Date.now,
  ) {
    this.key = `${workspace}:sync:v1`;
  }
  private guard() {
    if (!this.active()) throw new Error("account sync stopped");
  }
  private async load(): Promise<State> {
    const state = await this.db.get<State>(this.key);
    if (state && state.owner !== this.owner)
      throw new Error("account sync state belongs to another account");
    return state ?? { owner: this.owner, cursor: 0, base: {}, outbox: {} };
  }
  private save(state: State) {
    this.guard();
    return this.db.set(this.key, state);
  }
  private adapter(namespace: string) {
    return this.adapters.find((adapter) => adapter.namespace === namespace);
  }
  // Pending changes waiting for the service, for tests and diagnostics.
  async pending() {
    return Object.keys((await this.load()).outbox).length;
  }
  // Runs one pull-then-push pass; concurrent calls share it.
  sync() {
    return (this.running ??= this.run()
      .then((report) => {
        if (report.applied && this.active()) this.onApplied?.();
        return report;
      })
      .finally(() => {
        this.running = undefined;
        this.lastRun = this.now();
      }));
  }
  // After a local change: wait briefly so several changes go together.
  changed(delay = 2000) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // A pass already running may have read before this change; run
      // another one after it.
      void (this.running ?? Promise.resolve())
        .catch(() => {})
        .then(() => (this.active() ? this.sync() : undefined))
        .catch(() => {});
    }, delay);
  }
  // On launch and foreground; skipped when a pass ran very recently.
  soon(interval = 60_000) {
    if (this.running || (this.lastRun && this.now() - this.lastRun < interval))
      return;
    void this.sync().catch(() => {});
  }
  stop() {
    clearTimeout(this.timer);
  }
  private async run(): Promise<SyncReport> {
    const report: SyncReport = {
      pulled: 0,
      applied: 0,
      pushed: 0,
      conflicts: 0,
      rejected: 0,
    };
    this.guard();
    const state = await this.load();
    for (let page = 0; page < 100; page++) {
      this.guard();
      const result = await this.transport.pull(this.workspace, state.cursor);
      for (const item of result.items) {
        await this.receive(state, item, report);
        report.pulled++;
      }
      state.cursor = Math.max(state.cursor, result.cursor);
      await this.save(state);
      if (!result.hasMore) break;
    }
    for (let round = 0; round < 3; round++) {
      await this.queue(state, report);
      await this.save(state);
      const entries = Object.entries(state.outbox);
      if (!entries.length) break;
      for (const chunk of chunks(entries)) {
        this.guard();
        const mutations = chunk.map(([key, entry]) => {
          const [namespace, id] = split(key);
          return { namespace, id, ...entry } as SyncMutation;
        });
        const { results } = await this.transport.push(
          this.workspace,
          mutations,
        );
        for (const result of results) {
          const key = itemKey(result.namespace, result.id);
          const entry = state.outbox[key];
          if (!entry) continue;
          if (result.status === "applied") {
            state.base[key] = { revision: result.revision, value: entry.value };
            delete state.outbox[key];
            report.pushed++;
          } else if (result.status === "rejected") {
            delete state.outbox[key];
            state.base[key] = {
              ...(state.base[key] ?? { revision: 0, value: null }),
              skip: canonicalJson(entry.value),
            };
            report.rejected++;
          } else if (result.item?.mutation_id === entry.mutation_id) {
            state.base[key] = {
              revision: result.item.revision,
              value: result.item.value,
            };
            delete state.outbox[key];
            report.pushed++;
          } else {
            delete state.outbox[key];
            await this.reconcile(
              state,
              result.namespace,
              result.id,
              result.item?.value ?? null,
              result.item?.revision ?? 0,
              report,
            );
          }
        }
        await this.save(state);
      }
    }
    return report;
  }
  private async receive(state: State, item: SyncItem, report: SyncReport) {
    const key = itemKey(item.namespace, item.id);
    const entry = state.outbox[key];
    if (entry) {
      // This device's own write arrived; otherwise the push resolves it.
      if (item.mutation_id === entry.mutation_id) {
        state.base[key] = { revision: item.revision, value: item.value };
        delete state.outbox[key];
      }
      return;
    }
    if ((state.base[key]?.revision ?? 0) >= item.revision) return;
    await this.reconcile(
      state,
      item.namespace,
      item.id,
      item.value,
      item.revision,
      report,
    );
  }
  // Brings the service's copy into the local record, keeping local changes
  // the merge allows, and queues what still differs from the service.
  private async reconcile(
    state: State,
    namespace: SyncNamespace,
    id: string,
    server: unknown,
    revision: number,
    report: SyncReport,
  ) {
    const key = itemKey(namespace, id);
    const base = state.base[key];
    const adapter = this.adapter(namespace);
    const checked = syncValue(namespace, id, server);
    const usable =
      checked.ok &&
      (server === null || (adapter?.accepts?.(id, server) ?? true));
    const out: { merged?: { value: unknown; conflict: boolean } } = {};
    if (adapter && usable) {
      this.guard();
      await adapter.update(id, (current) => {
        if (current === undefined) return undefined;
        let merged = mergeSynced(base?.value ?? null, current, server);
        // A merged value this app cannot send keeps the service's copy.
        if (!syncValue(namespace, id, merged.value).ok)
          merged = { value: server, conflict: true };
        out.merged = merged;
        if (same(merged.value, current)) return undefined;
        report.applied++;
        return merged.value;
      });
    }
    state.base[key] = { revision, value: server };
    const { merged } = out;
    if (!merged) {
      // A value this app cannot use leaves the local record alone, and the
      // local value is not offered over it until it changes. An item that
      // does not apply on this device needs nothing more.
      if (adapter && !usable)
        state.base[key].skip = canonicalJson(
          (await adapter.snapshot()).values.get(id) ?? null,
        );
      return;
    }
    if (merged.conflict) report.conflicts++;
    if (!same(merged.value, server))
      state.outbox[key] = {
        mutation_id: uuid(),
        value: merged.value,
        base_revision: revision,
      };
  }
  // Every local value that differs from its base and has nothing in flight.
  private async queue(state: State, report: SyncReport) {
    for (const adapter of this.adapters) {
      this.guard();
      const { values, ignored } = await adapter.snapshot();
      const ids = new Set(values.keys());
      for (const key of Object.keys(state.base)) {
        const [namespace, id] = split(key);
        if (namespace === adapter.namespace) ids.add(id);
      }
      for (const id of ids) {
        const key = itemKey(adapter.namespace, id);
        if (state.outbox[key] || ignored.has(id)) continue;
        const local = values.get(id) ?? null;
        const base = state.base[key];
        if (same(local, base?.value ?? null)) continue;
        if (base?.skip === canonicalJson(local)) continue;
        const checked = syncValue(adapter.namespace, id, local);
        if (!checked.ok) {
          state.base[key] = {
            ...(base ?? { revision: 0, value: null }),
            skip: canonicalJson(local),
          };
          report.rejected++;
          continue;
        }
        state.outbox[key] = {
          mutation_id: uuid(),
          value: checked.value,
          base_revision: base?.revision ?? 0,
        };
      }
    }
  }
}

function split(key: string): [SyncNamespace, string] {
  const at = key.indexOf("/");
  return [key.slice(0, at) as SyncNamespace, key.slice(at + 1)];
}
function chunks<T>(entries: [string, T][]) {
  const out: [string, T][][] = [];
  let current: [string, T][] = [];
  let size = 0;
  for (const entry of entries) {
    const bytes = JSON.stringify(entry).length * 3;
    if (
      current.length &&
      (current.length >= SYNC_LIMITS.batch ||
        size + bytes > SYNC_LIMITS.bodyBytes / 2)
    ) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += bytes;
  }
  if (current.length) out.push(current);
  return out;
}

// ---- Adapters for the existing local stores ----

const drop = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  );

export function modelAdapter(db: LocalDatabase, key: string): SyncAdapter {
  const storage = `${key}:model`;
  const read = (stored: unknown) => {
    const parsed = modelChoiceInput.safeParse(stored);
    return parsed.success ? parsed.data : null;
  };
  return {
    namespace: "model",
    async snapshot() {
      const value = read(await db.get(storage));
      return {
        values: new Map(value ? [[MODEL_ITEM_ID, value]] : []),
        ignored: new Set(),
      };
    },
    async update(id, change) {
      if (id !== MODEL_ITEM_ID) return;
      await db.update<unknown>(storage, (stored) => {
        const next = change(read(stored));
        return next === undefined ? (stored ?? null) : next;
      });
    },
    accepts: (_id, value) => modelChoiceInput.safeParse(value).success,
  };
}

// A post's chart stays on the device that made it: the account service's
// copy of a post does not carry one yet.
const postValue = (item: InspirationItem) => {
  const { id: _id, chart: _chart, ...value } = item;
  return drop(value as unknown as Record<string, unknown>);
};
type FeedState = {
  items: InspirationItem[];
  runs: Record<string, unknown>;
  instructionsDismissed: boolean;
};
export function feedAdapter(db: LocalDatabase, key: string): SyncAdapter {
  const storage = `${key}:inspiration:v1`;
  return {
    namespace: "feed",
    async snapshot() {
      const state = await db.get<FeedState>(storage);
      const values = new Map<string, unknown>();
      if (state?.instructionsDismissed)
        values.set(FEED_SETTINGS_ID, { instructionsDismissed: true });
      for (const item of state?.items ?? [])
        if (item.id !== FEED_SETTINGS_ID) values.set(item.id, postValue(item));
      return { values, ignored: new Set() };
    },
    async update(id, change) {
      await db.update<FeedState>(storage, (old) => {
        const state = old ?? {
          items: [],
          runs: {},
          instructionsDismissed: false,
        };
        if (id === FEED_SETTINGS_ID) {
          const next = change(
            state.instructionsDismissed
              ? { instructionsDismissed: true }
              : null,
          );
          if (next !== undefined) state.instructionsDismissed = next !== null;
          return state;
        }
        const index = state.items.findIndex((item) => item.id === id);
        const next = change(index < 0 ? null : postValue(state.items[index]));
        if (next === undefined) return state;
        if (next === null) {
          if (index >= 0) state.items.splice(index, 1);
          return state;
        }
        const chart = index >= 0 ? state.items[index].chart : undefined;
        const item = {
          ...(next as object),
          id,
          ...(chart ? { chart } : {}),
        } as InspirationItem;
        if (index >= 0) state.items[index] = item;
        else {
          // Newest first, like posts generated here.
          const at = state.items.findIndex(
            (other) => other.created_at < item.created_at,
          );
          state.items.splice(at < 0 ? state.items.length : at, 0, item);
        }
        return state;
      });
    },
  };
}

// Saved replies are keyed by their original session and event, so the same
// reply saved on two devices is one item.
export const savedItemId = (
  item: Pick<LibraryItem, "session_id" | "event_id">,
) => digest(JSON.stringify([item.session_id, item.event_id]));
const savedFields = (item: LibraryItem) => ({
  id: item.id,
  title: item.title,
  text: item.text,
  session_id: item.session_id,
  event_id: item.event_id,
  created_at: item.created_at,
});
export function savedAdapter(db: LocalDatabase, key: string): SyncAdapter {
  const storage = `${key}:library`;
  return {
    namespace: "saved",
    async snapshot() {
      const values = new Map<string, unknown>();
      for (const item of (await db.get<LibraryItem[]>(storage)) ?? [])
        values.set(savedItemId(item), savedFields(item));
      return { values, ignored: new Set() };
    },
    async update(id, change) {
      await db.update<LibraryItem[]>(storage, (old) => {
        const rows = old ?? [];
        const index = rows.findIndex((item) => savedItemId(item) === id);
        const next = change(index < 0 ? null : savedFields(rows[index]));
        if (next === undefined) return rows;
        if (next === null) {
          if (index >= 0) rows.splice(index, 1);
        } else if (index >= 0) rows[index] = next as LibraryItem;
        else rows.unshift(next as LibraryItem);
        return rows;
      });
    },
  };
}

// Only archived side chats are items; restoring one deletes its item. The
// main chat and its earlier chapters never take an archive state from
// another device.
export function archiveAdapter(db: LocalDatabase, key: string): SyncAdapter {
  const storage = `${key}:conversations:v1`;
  const fixed = (index: ConversationIndex, id: string) => {
    const entry = index.entries[id];
    return (
      id === index.mainId ||
      Boolean(entry?.continuedBy) ||
      entry?.kind === "main"
    );
  };
  return {
    namespace: "archive",
    async snapshot() {
      const index = (await db.get<ConversationIndex>(storage)) ?? {
        entries: {},
      };
      const values = new Map<string, unknown>();
      const ignored = new Set<string>();
      if (index.mainId) ignored.add(index.mainId);
      for (const [id, entry] of Object.entries(index.entries)) {
        if (fixed(index, id)) ignored.add(id);
        else if (entry.archived)
          values.set(id, { archived: true, title: entry.title });
      }
      return { values, ignored };
    },
    async update(id, change) {
      await db.update<ConversationIndex>(storage, (old) => {
        const index = old ?? { entries: {} };
        if (fixed(index, id)) {
          change(undefined);
          return index;
        }
        const entry = index.entries[id];
        const next = change(
          entry?.archived ? { archived: true, title: entry.title } : null,
        ) as { title: string } | null | undefined;
        if (next === undefined) return index;
        if (next === null) {
          if (entry) entry.archived = false;
        } else
          index.entries[id] = {
            ...entry,
            title: next.title,
            kind: "side",
            archived: true,
          };
        return index;
      });
    },
  };
}

// The main chat every device of the account opens. A device takes the
// account's main chat over its own; the one it had stays as an earlier
// chapter when it is one, and as a side chat otherwise. While this device is
// creating a new chapter, the service's copy waits; the newer chapter then
// becomes the account's main chat.
export function mainAdapter(db: LocalDatabase, key: string): SyncAdapter {
  const storage = `${key}:conversations:v1`;
  const value = (index: ConversationIndex): MainChatValue | null =>
    index.mainId
      ? {
          id: index.mainId,
          previous: (index.entries[index.mainId]?.previousIds ?? [])
            .filter((id) => id !== index.mainId)
            .slice(-500),
        }
      : null;
  return {
    namespace: "main",
    async snapshot() {
      const index = (await db.get<ConversationIndex>(storage)) ?? {
        entries: {},
      };
      const values = new Map<string, unknown>();
      const ignored = new Set<string>();
      const current = value(index);
      if (current) values.set(MAIN_CHAT_ID, current);
      if (index.pending?.kind === "main") ignored.add(MAIN_CHAT_ID);
      return { values, ignored };
    },
    async update(id, change) {
      await db.update<ConversationIndex>(storage, (old) => {
        const index = old ?? { entries: {} };
        // A main chat whose creation may already be under way here is
        // finished first.
        const creating =
          index.pending?.kind === "main" &&
          (index.pending.phase === "creating" || !index.pending.previous);
        if (id !== MAIN_CHAT_ID || creating) {
          change(undefined);
          return index;
        }
        const next = change(value(index)) as MainChatValue | null | undefined;
        // A removed item leaves this device's main chat as it is.
        if (!next) return index;
        adoptMain(index, next);
        return index;
      });
    },
  };
}

function adoptMain(index: ConversationIndex, main: MainChatValue) {
  const old = index.mainId;
  const chain = [...main.previous, main.id];
  const title =
    (old && index.entries[old]?.title) ??
    index.entries[main.id]?.title ??
    "Main chat";
  chain.forEach((id, i) => {
    const later = chain[i + 1];
    const entry = {
      ...index.entries[id],
      title,
      kind: "main" as const,
      archived: false,
    };
    delete entry.continuedBy;
    delete entry.previousIds;
    if (later) entry.continuedBy = later;
    else if (main.previous.length) entry.previousIds = main.previous;
    index.entries[id] = entry;
  });
  if (old && !chain.includes(old)) {
    const entry = { ...index.entries[old], kind: "side" as const };
    entry.title ??= title;
    entry.archived ??= false;
    delete entry.continuedBy;
    index.entries[old] = entry;
  }
  index.mainId = main.id;
  // A new chapter this device had only begun preparing gives way.
  if (index.pending?.kind === "main") delete index.pending;
}

export const syncAdapters = (db: LocalDatabase, key: string) =>
  syncNamespaces.map((namespace) =>
    ({
      model: modelAdapter,
      feed: feedAdapter,
      saved: savedAdapter,
      archive: archiveAdapter,
      main: mainAdapter,
    })[namespace](db, key),
  );
