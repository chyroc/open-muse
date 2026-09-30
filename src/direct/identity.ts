import { t } from "../../shared/i18n";
import { z } from "zod";
import { ApiError, type ArkClient } from "../../shared/ark";
import { digest, uuid } from "../../shared/crypto";
import {
  identityDefaults,
  type CompanionIdentity,
  type IdentityDocument,
  type IdentityDocumentName,
} from "../../shared/identity";
import type { Page } from "../../shared/types";
import type { conversationArchive } from "../../shared/conversation-history";
import { LocalDatabase } from "./storage";
import { defaultFeedInstructions } from "../../shared/inspiration";
import { emptyGoalsDocument, parseGoals } from "../../shared/goals";

type Store = { id: string; metadata?: Record<string, string> };
type Memory = {
  id: string;
  path: string;
  content?: string;
  updated_at?: string;
};
type Mapping = { store_id?: string; pending?: string };
type Write = { token: string; content: string; before: string };
const names = Object.keys(identityDefaults) as IdentityDocumentName[];
const nameInput = z.enum(["SOUL.md", "MEMORY.md", "IDENTITY.md"]);
const profileInput = z
  .object({ name: z.string().trim().min(1).max(40) })
  .strict();
const validId = (id: string) => {
  if (!/^[\w-]{1,200}$/.test(id))
    throw new ApiError(502, t("Invalid memory resource ID."));
  return id;
};
// MA normalizes leading/trailing whitespace in the read response.
export const canonicalDocument = (content: string) => content.trim();
export function defaultIdentity(): CompanionIdentity {
  return {
    name: "Muse",
    documents: Object.fromEntries(
      names.map((name) => {
        const content = canonicalDocument(identityDefaults[name]);
        return [name, { name, content, revision: digest(content) }];
      }),
    ) as CompanionIdentity["documents"],
  };
}

export class DirectIdentity {
  private key: string;
  private provisioning?: Promise<string>;
  constructor(
    private owner: string,
    private ark: ArkClient,
    private db: LocalDatabase,
    private timing = {
      wait: (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
    },
    // Account workspaces record the memory store with the service right after
    // it is created or adopted, before it is used.
    private claim?: (kind: "memory_store", id: string) => Promise<void>,
  ) {
    this.key = `${owner}:identity:v1`;
  }
  private async collect<T>(path: string) {
    const rows: T[] = [],
      seen = new Set<string>();
    let page = "";
    do {
      const result = await this.ark.request<Page<T>>(
        `${path}${page ? `&page=${encodeURIComponent(page)}` : ""}`,
      );
      if (!Array.isArray(result.data))
        throw new ApiError(
          502,
          t("Invalid memory list. No changes were made."),
        );
      rows.push(...result.data);
      page = result.next_page ?? "";
      if (page && (seen.has(page) || seen.size >= 100))
        throw new ApiError(
          502,
          t("Memory pagination did not finish. No changes were made."),
        );
      seen.add(page);
    } while (page);
    return rows;
  }
  private async store(create: boolean): Promise<string | undefined> {
    const mapping = await this.db.get<Mapping>(this.key);
    if (mapping?.store_id) {
      const store = await this.ark.request<Store>(
        `/memory_stores/${validId(mapping.store_id)}`,
      );
      if (store.id !== mapping.store_id)
        throw new ApiError(
          502,
          t(
            "The personal memory store response did not match the requested resource.",
          ),
        );
      if (store.metadata?.open_muse_identity !== this.owner)
        throw new ApiError(
          409,
          t(
            "The personal memory store is not owned by this connection. No changes were made.",
          ),
        );
      return validId(store.id);
    }
    const rows = await this.collect<Store>("/memory_stores?limit=100");
    const owned = rows.filter(
      (s) => s.metadata?.open_muse_identity === this.owner,
    );
    if (owned.length > 1)
      throw new ApiError(
        409,
        t(
          "Multiple personal memory stores were found. No store was selected or changed.",
        ),
      );
    if (owned[0]) {
      const id = validId(owned[0].id);
      await this.claim?.("memory_store", id);
      await this.db.set<Mapping>(this.key, { store_id: id });
      return id;
    }
    if (!create) return;
    const token = uuid();
    await this.db.update<Mapping>(this.key, (old) => {
      if (old?.pending || old?.store_id)
        throw new ApiError(
          409,
          t(
            "Memory setup is unconfirmed or running in another window. Refresh before trying again.",
          ),
        );
      return { pending: token };
    });
    try {
      const store = await this.ark.request<Store>("/memory_stores", {
        method: "POST",
        body: JSON.stringify({
          name: "Open Muse personal memory",
          metadata: { open_muse_identity: this.owner },
        }),
      });
      const id = validId(store.id);
      await this.claim?.("memory_store", id);
      await this.db.set<Mapping>(this.key, { store_id: id });
      return id;
    } catch (error) {
      if (definitelyRejected(error))
        await this.db.update<Mapping>(this.key, (old) =>
          old?.pending === token ? {} : (old ?? {}),
        );
      throw error;
    }
  }
  private path(store: string) {
    return `/memory_stores/${validId(store)}/memories`;
  }
  private writeKey(store: string, name: string) {
    return `${this.key}:${store}:${name}:write`;
  }
  private async document<Name extends string>(
    store: string,
    name: Name,
    rows?: Memory[],
  ): Promise<IdentityDocument<Name> | undefined> {
    const memories =
      rows ?? (await this.collect<Memory>(`${this.path(store)}?limit=100`));
    const hits = memories.filter((memory) => memory.path === `/${name}`);
    if (hits.length > 1)
      throw new ApiError(
        409,
        t("Multiple {name} documents were found. No changes were made.", {
          name,
        }),
      );
    if (!hits[0]) return;
    const memory = await this.ark.request<Memory>(
      `${this.path(store)}/${validId(hits[0].id)}`,
    );
    if (typeof memory.content !== "string")
      throw new ApiError(
        502,
        t("Could not read {name}. No changes were made.", { name }),
      );
    const content = canonicalDocument(memory.content);
    const pending = await this.db.get<Write | null>(this.writeKey(store, name));
    if (pending?.content === content)
      await this.db.set(this.writeKey(store, name), null);
    return {
      name,
      id: hits[0].id,
      content,
      revision: digest(content),
      updated_at: memory.updated_at,
    };
  }
  async read(): Promise<CompanionIdentity> {
    const store = await this.store(false);
    if (!store) return defaultIdentity();
    return this.readStore(store);
  }
  storeId() {
    return this.store(false);
  }
  async goalsDocument() {
    const store = await this.store(false);
    return (
      (store ? await this.document(store, "GOALS.md") : undefined) ?? {
        content: emptyGoalsDocument,
        revision: digest(emptyGoalsDocument),
        id: undefined,
      }
    );
  }
  async saveGoalsDocument(content: string, revision: string) {
    parseGoals(content);
    const store = await this.ensure();
    const current = await this.document(store, "GOALS.md");
    if (await this.db.get<Write | null>(this.writeKey(store, "GOALS.md")))
      throw new ApiError(
        409,
        t(
          "The previous goal change is unconfirmed. Refresh goals before trying again.",
        ),
      );
    if ((current?.revision ?? digest(emptyGoalsDocument)) !== revision)
      throw new ApiError(
        409,
        t(
          "Your goals changed. Refresh and review the latest progress before saving.",
        ),
      );
    if (!current || current.content !== content)
      await this.write(store, "GOALS.md", content, current);
    return this.goalsDocument();
  }
  async feedInstructions() {
    const store = await this.store(false);
    const doc = store ? await this.document(store, "FEED.md") : undefined;
    return (
      doc ?? {
        content: defaultFeedInstructions,
        revision: digest(defaultFeedInstructions),
      }
    );
  }
  async saveFeedInstructions(content: string, revision: string) {
    content = canonicalDocument(
      z.string().trim().min(1).max(4000).parse(content),
    );
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(revision);
    const store = await this.ensure();
    const current = await this.document(store, "FEED.md");
    if (await this.db.get<Write | null>(this.writeKey(store, "FEED.md")))
      throw new ApiError(
        409,
        t(
          "The previous feed-instructions write is unconfirmed. Reload to check its result before saving again.",
        ),
      );
    if ((current?.revision ?? digest(defaultFeedInstructions)) !== revision)
      throw new ApiError(
        409,
        t(
          "Feed instructions changed since you opened them. Your draft is preserved; reload and review before saving.",
        ),
      );
    if (!current || current.content !== content)
      await this.write(store, "FEED.md", content, current);
    return this.feedInstructions();
  }
  private async readStore(store: string) {
    const result = defaultIdentity();
    result.store_id = store;
    const rows = await this.collect<Memory>(`${this.path(store)}?limit=100`);
    const docs = await Promise.all(
      names.map((name) => this.document(store, name, rows)),
    );
    docs.forEach((doc) => {
      if (doc) result.documents[doc.name] = doc;
    });
    try {
      result.name = profileInput.parse(
        JSON.parse(result.documents["IDENTITY.md"].content),
      ).name;
    } catch {
      result.warning = t(
        "The saved name is invalid. Edit your identity to repair it; the original document is preserved.",
      );
    }
    return result;
  }
  async ensure() {
    if (!this.provisioning)
      this.provisioning = this.provision().finally(() => {
        this.provisioning = undefined;
      });
    return this.provisioning;
  }
  async archive(archive: ReturnType<typeof conversationArchive>) {
    const store = await this.ensure();
    for (const file of [...archive.chunks, archive.manifest]) {
      if (!/^history\/[a-f0-9]{64}\/(HISTORY|part-\d{4,})\.md$/.test(file.name))
        throw new ApiError(400, t("Invalid conversation archive path."));
      const content = canonicalDocument(file.content);
      const existing = await this.document(store, file.name);
      if (existing && existing.content !== content)
        throw new ApiError(
          409,
          t(
            "The conversation archive changed unexpectedly. No history was overwritten.",
          ),
        );
      if (!existing) await this.write(store, file.name, content);
    }
    return { store, manifest: archive.manifest.name };
  }
  private async provision() {
    const store = (await this.store(true))!;
    for (const name of names) {
      if (await this.document(store, name)) continue;
      await this.write(
        store,
        name,
        canonicalDocument(identityDefaults[name]),
        undefined,
      );
    }
    return store;
  }
  async save(name: IdentityDocumentName, content: string, revision: string) {
    nameInput.parse(name);
    content = canonicalDocument(z.string().max(64000).parse(content));
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(revision);
    if (name === "IDENTITY.md") {
      try {
        content = JSON.stringify(
          profileInput.parse(JSON.parse(content)),
          null,
          2,
        );
      } catch {
        throw new ApiError(400, t("Enter a name between 1 and 40 characters."));
      }
    }
    const store = await this.ensure();
    const current = (await this.document(store, name))!;
    if (await this.db.get<Write | null>(this.writeKey(store, name)))
      throw new ApiError(
        409,
        t(
          "The previous memory write is unconfirmed. Reload the document to check its result; it has not been submitted twice.",
        ),
      );
    if (current.revision !== revision)
      throw new ApiError(
        409,
        t(
          "This document changed since you opened it. Your draft is preserved; reload and review the latest version before saving.",
        ),
      );
    if (current.content !== content)
      await this.write(store, name, content, current);
    return this.readStore(store);
  }
  private async write(
    store: string,
    name: string,
    content: string,
    current?: IdentityDocument<string>,
  ) {
    const key = this.writeKey(store, name);
    const token = uuid();
    await this.db.update<Write | null>(key, (old) => {
      if (old)
        throw new ApiError(
          409,
          t(
            "The previous memory write is unconfirmed. Reload the document to check its result; it has not been submitted twice.",
          ),
        );
      return { token, content, before: current?.revision ?? "" };
    });
    let accepted = false;
    try {
      await this.ark.request(
        `${this.path(store)}${current?.id ? `/${validId(current.id)}` : ""}`,
        {
          method: "POST",
          body: JSON.stringify(
            current?.id ? { content } : { path: `/${name}`, content },
          ),
        },
      );
      accepted = true;
      const verified = await this.verify(store, name, content);
      if (verified?.content !== content)
        throw new ApiError(
          409,
          t(
            "The saved document could not be verified. Reload before trying again.",
          ),
        );
    } catch (error) {
      if (!accepted && definitelyRejected(error))
        await this.db.update<Write | null>(key, (old) =>
          old?.token === token ? null : (old ?? null),
        );
      throw error;
    }
  }
  private async verify(store: string, name: string, content: string) {
    // MA may briefly return 404 or the old version after accepting an update.
    // Only repeat reads. Never repeat the POST to resolve propagation delay.
    for (let attempt = 0; attempt < 7; attempt++) {
      if (attempt)
        await this.timing.wait(Math.min(300 * 2 ** (attempt - 1), 3000));
      try {
        const result = await this.document(store, name);
        if (result?.content === content || attempt === 6) return result;
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.status !== 404 ||
          attempt === 6
        )
          throw error;
      }
    }
  }
}

function definitelyRejected(error: unknown) {
  return (
    error instanceof ApiError &&
    [400, 401, 403, 404, 413, 429].includes(error.status)
  );
}
