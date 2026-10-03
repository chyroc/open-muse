import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SupabaseAuth } from "../src/supabase-auth";
import { BackgroundClient } from "../src/background-client";
import { AccountPanel } from "../src/AccountPanel";
import { exportText } from "../src/platform";
import { supabaseOwner } from "../shared/supabase-auth";
import { LocalDatabase } from "../src/direct/storage";

const origin = "https://auth.example.com";
const background = "https://background.example.com";
const key = "sb_publishable_test_public_anon_key";
const subject = "6a1f0f43-5c2e-4f4e-9d0e-6a7b8c9d0e1f";
const access = "test-account-access-token-export-1";
const owner = supabaseOwner(origin, subject);
const status = () => ({
  connected: true,
  owner,
  backgroundReady: false,
  credentialStorageReady: true,
  account: {
    provider: "supabase",
    credential: { configured: true, revision: 1, updatedAt: 1 },
  },
  connection: { configured: false, revision: 0, updatedAt: null },
  schedule: {
    enabled: false,
    timezone: "UTC",
    local_time: "09:00",
    next_run_at: null,
    revision: 0,
  },
});
const exported = {
  format: 1,
  exportedAt: Date.UTC(2026, 9, 3),
  owner,
  tables: {
    account_credentials: [
      { configured: true, credential: { project: "", api_key_last4: "wxyz" } },
    ],
    account_devices: [{ device_id: "d", name: "Studio Mac" }],
  },
};

function fixture(exportResponse: () => Response) {
  vi.stubGlobal("navigator", {
    language: "en-US",
    languages: ["en-US"],
    locks: {
      request: (_name: string, run: () => Promise<unknown>) => run(),
    },
  });
  let saved = "";
  const vault = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value: string) => {
      saved = value;
    }),
  };
  const authFetch = vi.fn<typeof fetch>(async () =>
    Response.json({
      access_token: access,
      refresh_token: "short_refresh_token",
      expires_in: 3600,
      token_type: "bearer",
      user: { id: subject, is_anonymous: false },
    }),
  );
  const serviceFetch = vi.fn<typeof fetch>(async (input, init) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${access}`,
    );
    const path = new URL(String(input)).pathname;
    if (path === "/v1/status") return Response.json(status());
    if (path === "/v1/account/export") return exportResponse();
    return Response.json({ items: [], cursor: 0, hasMore: false });
  });
  const client = new BackgroundClient(
    background,
    vault,
    new LocalDatabase(`account-export-${crypto.randomUUID()}`),
    serviceFetch,
    new SupabaseAuth(origin, key, authFetch, () => 1000),
  );
  return { client, serviceFetch };
}
afterEach(() => vi.unstubAllGlobals());

describe("Exporting account data", () => {
  it("reads the account's export once with its verified session", async () => {
    const f = fixture(() => Response.json(exported));
    await f.client.signInAccount("person@example.com", "never-saved-pass");
    expect(await f.client.exportAccount()).toEqual(exported);
    const calls = f.serviceFetch.mock.calls.filter(([input]) =>
      String(input).endsWith("/v1/account/export"),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][1]?.method ?? "GET").toBe("GET");
    expect(calls[0][1]?.body).toBeUndefined();
  });

  it("explains a failed export and rejects a malformed document", async () => {
    const f = fixture(() =>
      Response.json({ error: "unavailable" }, { status: 503 }),
    );
    await f.client.signInAccount("person@example.com", "never-saved-pass");
    await expect(f.client.exportAccount()).rejects.toThrow(
      "could not be exported",
    );
    const g = fixture(() => Response.json({ format: 2, tables: {} }));
    await g.client.signInAccount("person@example.com", "never-saved-pass");
    await expect(g.client.exportAccount()).rejects.toThrow();
  });

  it("saves the JSON as a download in a browser", async () => {
    const link = { href: "", download: "", click: vi.fn() };
    const blobs: Blob[] = [];
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { createElement: () => link });
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return "blob:export";
      },
      revokeObjectURL: () => {},
    });
    const message = await exportText("open-muse-account.json", "{}", {
      downloaded: "Your data download started",
      type: "application/json;charset=utf-8",
    });
    expect(message).toBe("Your data download started");
    expect(link.download).toBe("open-muse-account.json");
    expect(link.click).toHaveBeenCalledOnce();
    expect(blobs[0].type).toBe("application/json;charset=utf-8");
  });

  it.each([[["en-US"]], [["zh-Hans-CN"]], [["fr-FR"]]])(
    "offers the export next to account deletion %j",
    async (languages) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", languages);
      const f = fixture(() => Response.json(exported));
      await f.client.signInAccount("person@example.com", "never-saved-pass");
      const html = renderToStaticMarkup(
        <AccountPanel
          service={f.client}
          client={{ accountChanged: async () => {} }}
          onChanged={() => {}}
        />,
      );
      const chinese = languages[0].startsWith("zh");
      expect(html).toContain(chinese ? "导出我的数据" : "Export my data");
      expect(html).toContain(
        chinese ? "只显示最后四个字符" : "only by its last four characters",
      );
      expect(html).toContain(chinese ? "删除账号" : "Delete account");
      expect(
        html.indexOf(chinese ? "导出我的数据" : "Export my data"),
      ).toBeLessThan(html.indexOf(chinese ? "删除账号" : "Delete account"));
    },
  );
});
