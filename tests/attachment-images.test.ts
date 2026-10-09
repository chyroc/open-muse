import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { BackgroundClient } from "../src/background-client";
import { SupabaseAuth } from "../src/supabase-auth";
import { LocalDatabase } from "../src/direct/storage";
import { supabaseOwner } from "../shared/supabase-auth";

const authOrigin = "https://auth.example";
const subject = "ea36b4c3-a456-4787-bf54-a6c735545072";
const token = "test-account-access-token-123456789";
const owner = supabaseOwner(authOrigin, subject);
const status = {
  connected: true,
  owner,
  backgroundReady: true,
  account: {
    provider: "supabase",
    credential: { configured: true, revision: 1, updatedAt: 1 },
  },
  schedule: {
    enabled: true,
    timezone: "UTC",
    local_time: "09:00",
    next_run_at: null,
    revision: 1,
  },
};

// The account's storage folder, as the workspace's storage keeps it.
function fixture() {
  let value = "";
  const vault = {
    read: vi.fn(async () => value),
    write: vi.fn(async (v: string) => {
      value = v;
    }),
  };
  const stored = new Map<string, Blob>();
  const storage: { method: string; path: string; headers: Headers }[] = [];
  const order: string[] = [];
  const authFetch = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(String(input));
    if (!url.pathname.startsWith("/storage/v1/"))
      return Response.json({
        access_token: token,
        refresh_token: "short_refresh_token",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: subject, is_anonymous: false },
      });
    const path = url.pathname.slice("/storage/v1".length);
    const method = init.method ?? "GET";
    storage.push({ method, path, headers: new Headers(init.headers) });
    order.push(`storage ${method}`);
    const object = path.match(
      /^\/object\/(?:authenticated\/)?attachments\/([^/]+)\/([^/]+)$/,
    );
    if (object && method === "POST") {
      stored.set(`${object[1]}/${object[2]}`, init.body as Blob);
      return Response.json({ Key: path });
    }
    if (object) {
      const blob = stored.get(`${object[1]}/${object[2]}`);
      return blob
        ? new Response(blob, { headers: { "Content-Type": blob.type } })
        : Response.json({ statusCode: "404" }, { status: 400 });
    }
    if (path === "/object/list/attachments") {
      const { prefix } = JSON.parse(String(init.body));
      return Response.json(
        [...stored.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, blob]) => ({
            name: key.slice(prefix.length),
            created_at: "2026-10-09T00:00:00Z",
            metadata: { size: blob.size },
          })),
      );
    }
    if (path === "/object/attachments" && method === "DELETE") {
      for (const name of JSON.parse(String(init.body)).prefixes)
        stored.delete(name);
      return Response.json([]);
    }
    return Response.json({}, { status: 404 });
  });
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    url.pathname = url.pathname.replace("/functions/v1/open-muse", "");
    if (url.pathname === "/v1/status") return Response.json(status);
    if (url.pathname === "/v1/account" && init?.method === "DELETE") {
      order.push("service DELETE");
      return Response.json({ deleted: true });
    }
    if (url.pathname === "/v1/account/export")
      return Response.json({
        format: 1,
        exportedAt: 1,
        owner,
        tables: { devices: [] },
      });
    return Response.json({}, { status: 404 });
  });
  const client = new BackgroundClient(
    "https://background.example/functions/v1/open-muse",
    vault,
    new LocalDatabase(`attachment-images-${crypto.randomUUID()}`),
    fetcher,
    new SupabaseAuth(
      authOrigin,
      "sb_publishable_test_public_anon_key",
      authFetch,
      () => 1000,
    ),
  );
  return { client, stored, storage, order };
}

const photo = (type = "image/png") =>
  new Blob([new Uint8Array([137, 80, 78, 71])], { type });

describe("Attached images kept in the account", () => {
  it("saves and reads a photo in the signed-in user's own folder", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", "never-saved");
    await f.client.storeAttachmentImage("file_abc-1", photo());
    expect(f.storage[0]).toMatchObject({
      method: "POST",
      path: `/object/attachments/${subject}/file_abc-1`,
    });
    const headers = f.storage[0].headers;
    expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("apikey")).toBe("sb_publishable_test_public_anon_key");
    expect(headers.get("Content-Type")).toBe("image/png");
    expect(headers.get("x-upsert")).toBe("true");
    const read = await f.client.attachmentImage("file_abc-1");
    expect(read?.type).toBe("image/png");
    expect(read?.size).toBe(4);
    expect(f.storage[1].path).toBe(
      `/object/authenticated/attachments/${subject}/file_abc-1`,
    );
    // Nothing kept is nothing shown.
    expect(await f.client.attachmentImage("file_none")).toBeUndefined();
  });

  it("keeps only images within the attachment limits", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", "never-saved");
    await f.client.storeAttachmentImage("file_svg", photo("image/svg+xml"));
    await f.client.storeAttachmentImage(
      "file_empty",
      new Blob([], { type: "image/png" }),
    );
    expect(f.storage).toHaveLength(0);
    // A file ID that is not one never becomes a path.
    await expect(
      f.client.storeAttachmentImage("../other", photo()),
    ).rejects.toThrow();
    expect(f.storage).toHaveLength(0);
  });

  it("lists the copies in an export and removes them before deleting the account", async () => {
    const f = fixture();
    await f.client.signInAccount("person@example.com", "never-saved");
    await f.client.storeAttachmentImage("file_one", photo());
    await f.client.storeAttachmentImage("file_two", photo("image/jpeg"));
    const exported = await f.client.exportAccount();
    expect(exported.tables.attachment_images).toEqual([
      { name: "file_one", bytes: 4, created_at: "2026-10-09T00:00:00Z" },
      { name: "file_two", bytes: 4, created_at: "2026-10-09T00:00:00Z" },
    ]);
    f.order.length = 0;
    await f.client.deleteAccount();
    expect(f.stored.size).toBe(0);
    expect(f.order.indexOf("storage DELETE")).toBeLessThan(
      f.order.indexOf("service DELETE"),
    );
  });

  it("reaches no storage path other than the attachment images", async () => {
    const auth = new SupabaseAuth(
      authOrigin,
      "sb_publishable_test_public_anon_key",
      async () => new Response(),
    );
    for (const path of [
      "/object/public/attachments/x/y",
      "/object/avatars/" + subject + "/y",
      "/bucket",
      `/object/attachments/${subject}/../y`,
    ])
      await expect(auth.storage(path, token)).rejects.toThrow(
        "Invalid storage path.",
      );
  });
});
