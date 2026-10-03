import { z } from "zod";

// Personal settings and lists an Open Muse account keeps in step across its
// devices. The service stores each item sealed per account and workspace key;
// both sides validate every value with these schemas.
export const syncNamespaces = [
  "model",
  "feed",
  "saved",
  "archive",
  "main",
] as const;
export type SyncNamespace = (typeof syncNamespaces)[number];

export const SYNC_LIMITS = {
  // Serialized JSON of one value, in UTF-8 bytes.
  valueBytes: 64 * 1024,
  // Mutations in one push, and its request body.
  batch: 25,
  bodyBytes: 2_000_000,
  // Items (tombstones included) one account keeps, across workspaces.
  items: 5000,
  // Items returned by one pull.
  page: 200,
};

const text = (max: number) => z.string().max(max);
const resourceId = z.string().regex(/^[\w-]{1,200}$/);
const httpUrl = (protocols: string[]) =>
  z
    .string()
    .url()
    .max(2000)
    .refine((value) => {
      const url = new URL(value);
      return protocols.includes(url.protocol) && !url.username && !url.password;
    });

// The chosen model and thinking level. The service checks only its shape, so
// a newer app's model is kept; each app applies it only if it offers it.
const modelValue = z
  .object({
    model: z.string().regex(/^[\w.:/-]{1,100}$/),
    effort: z.string().regex(/^[a-z_]{1,20}$/),
  })
  .strict();
// One generated Feed or Ideas post with its reactions. MA remains the source
// of the generated content; this is the presentation copy.
export const feedPostValue = z
  .object({
    title: text(180),
    body: text(5000),
    emoji: text(16),
    reason: text(600),
    category: text(40),
    prompt: text(3000),
    sources: z
      .array(
        z
          .object({ title: text(200), url: httpUrl(["https:", "http:"]) })
          .strict(),
      )
      .max(8),
    images: z
      .array(z.object({ url: httpUrl(["https:"]), alt: text(200) }).strict())
      .max(4)
      .optional(),
    kind: z.enum(["feed", "ideas"]),
    session_id: resourceId,
    event_id: resourceId,
    created_at: text(40),
    liked: z.boolean(),
    discussion_id: resourceId.optional(),
  })
  .strict();
export type FeedPostValue = z.infer<typeof feedPostValue>;
export const feedSettingsValue = z
  .object({ instructionsDismissed: z.literal(true) })
  .strict();
export const FEED_SETTINGS_ID = "settings";
// A saved reply, keyed by its original session and event.
export const savedValue = z
  .object({
    id: text(100),
    title: text(500),
    text: z.string().min(1).max(20_000),
    session_id: resourceId,
    event_id: resourceId,
    created_at: text(40),
  })
  .strict();
export type SavedValue = z.infer<typeof savedValue>;
// An archived side chat; restoring it removes the item.
export const archiveValue = z
  .object({ archived: z.literal(true), title: text(500) })
  .strict();
export const MODEL_ITEM_ID = "choice";
// The account's main chat: the session every device opens as its main chat
// and its earlier chapters, oldest first.
export const mainChatValue = z
  .object({ id: resourceId, previous: z.array(resourceId).max(500) })
  .strict()
  .refine((value) => !value.previous.includes(value.id));
export type MainChatValue = z.infer<typeof mainChatValue>;
export const MAIN_CHAT_ID = "chat";

export const syncItemId = z.string().regex(/^[\w.-]{1,200}$/);

// Validates one item's value for its namespace and ID; a null value is a
// deletion. Returns the parsed value, or undefined when it is not allowed.
export function syncValue(
  namespace: SyncNamespace,
  id: string,
  value: unknown,
): { ok: true; value: unknown } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const schema =
    namespace === "model"
      ? id === MODEL_ITEM_ID
        ? modelValue
        : undefined
      : namespace === "feed"
        ? id === FEED_SETTINGS_ID
          ? feedSettingsValue
          : feedPostValue
        : namespace === "saved"
          ? /^[0-9a-f]{64}$/.test(id)
            ? savedValue
            : undefined
          : namespace === "main"
            ? id === MAIN_CHAT_ID
              ? mainChatValue
              : undefined
            : resourceId.safeParse(id).success
              ? archiveValue
              : undefined;
  const parsed = schema?.safeParse(value);
  if (!parsed?.success) return { ok: false };
  if (
    new TextEncoder().encode(JSON.stringify(parsed.data)).length >
    SYNC_LIMITS.valueBytes
  )
    return { ok: false };
  return { ok: true, value: parsed.data };
}

export const syncMutationId = z.string().regex(/^[\w-]{16,80}$/);
export const syncMutation = z
  .object({
    namespace: z.enum(syncNamespaces),
    id: syncItemId,
    value: z.unknown(),
    base_revision: z.number().int().nonnegative(),
    mutation_id: syncMutationId,
  })
  .strict();
export type SyncMutation = z.infer<typeof syncMutation>;
export const syncPushInput = z
  .object({
    workspace: z.string().regex(/^[0-9a-f]{64}$/),
    mutations: z.array(syncMutation).min(1).max(SYNC_LIMITS.batch),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.mutations.map((m) => `${m.namespace}/${m.id}`)).size ===
      input.mutations.length,
  );

export const syncItem = z.object({
  namespace: z.enum(syncNamespaces),
  id: syncItemId,
  revision: z.number().int().positive(),
  value: z.unknown(),
  mutation_id: z.string(),
  seq: z.number().int().positive(),
  updated_at: z.number(),
});
export type SyncItem = z.infer<typeof syncItem>;
export const syncPullResponse = z.object({
  items: z.array(syncItem).max(SYNC_LIMITS.page),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof syncPullResponse>;
export const syncResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("applied"),
    namespace: z.enum(syncNamespaces),
    id: syncItemId,
    revision: z.number().int().positive(),
    seq: z.number().int().positive(),
  }),
  // The item changed since base_revision; nothing was written. The server's
  // copy comes back so the client can reconcile.
  z.object({
    status: z.literal("conflict"),
    namespace: z.enum(syncNamespaces),
    id: syncItemId,
    item: syncItem.nullable(),
  }),
  z.object({
    status: z.literal("rejected"),
    namespace: z.enum(syncNamespaces),
    id: syncItemId,
    reason: z.enum(["invalid", "limit"]),
  }),
]);
export type SyncResult = z.infer<typeof syncResult>;
export const syncPushResponse = z.object({
  results: z.array(syncResult).max(SYNC_LIMITS.batch),
});
export type SyncPushResponse = z.infer<typeof syncPushResponse>;
