import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ArkClient } from "../shared/ark";
import { t } from "../shared/i18n";
import {
  fileSizeLabel,
  libraryDownloadURL,
  libraryFile,
  libraryFileKind,
  type LibraryFile,
} from "../shared/library";
import { DirectLibrary } from "../src/direct/library";
import {
  LibraryEmpty,
  LibraryFileCard,
  LibrarySegments,
  loadThumbnails,
  wantsThumbnail,
} from "../src/LibraryPage";
import {
  canRenderThumbnails,
  libraryThumbnail,
  openLibraryFile,
} from "../src/library-platform";

afterEach(() => vi.unstubAllGlobals());

const signed =
  "https://storage-cn.tos-cn-beijing.volces.com/object/1?X-Tos-Signature=test";
// Relative to the real clock: DirectLibrary drops files that have expired.
const now = Math.floor(Date.now() / 1000) * 1000;
function raw(id: string, overrides: Record<string, unknown> = {}) {
  return {
    object: "file",
    id,
    purpose: "agent",
    filename: `${id}.md`,
    bytes: 2048,
    mime_type: "text/plain; charset=utf-8",
    created_at: now / 1000 - 60,
    expire_at: now / 1000 + 86_400,
    status: "active",
    scope: { type: "session", id: "sesn-owned" },
    download_url: signed,
    ...overrides,
  };
}
const sessions = new Map([["sesn-owned", "Trip notes"]]);

function ark(handler: (path: string, init?: RequestInit) => unknown) {
  const request = vi.fn(async (path: string, init?: RequestInit) =>
    handler(path, init),
  );
  return { request, ark: { request } as unknown as ArkClient };
}

describe("Library files", () => {
  it("classifies media without treating SVG markup as an image", () => {
    expect(libraryFileKind("image/png")).toBe("image");
    expect(libraryFileKind("IMAGE/JPEG; q=1")).toBe("image");
    expect(libraryFileKind("image/svg+xml")).toBe("artifact");
    expect(libraryFileKind("audio/mpeg")).toBe("audio");
    expect(libraryFileKind("video/mp4")).toBe("video");
    expect(libraryFileKind("application/pdf")).toBe("artifact");
  });
  it("keeps only unexpired agent outputs from known sessions and drops URLs", () => {
    const item = libraryFile(raw("file-one"), sessions, now);
    expect(item).toMatchObject({
      id: "file-one",
      name: "file-one.md",
      kind: "artifact",
      session_id: "sesn-owned",
      session_title: "Trip notes",
    });
    expect(item?.expires_at).toBe(new Date(now + 86_400_000).toISOString());
    expect(JSON.stringify(item)).not.toContain("X-Tos-Signature");
    for (const rejected of [
      raw("file-two", { scope: { type: "session", id: "sesn-foreign" } }),
      raw("file-three", { scope: null }),
      raw("file-four", { scope: { type: "agent", id: "sesn-owned" } }),
      raw("file-five", { purpose: "user_data" }),
      raw("file-six", { expire_at: now / 1000 }),
      raw("../file", {}),
      { id: "file-seven" },
    ])
      expect(libraryFile(rejected, sessions, now)).toBeUndefined();
    expect(
      libraryFile(raw("file-eight", { mime_type: null }), sessions, now),
    ).toMatchObject({ mime_type: "application/octet-stream" });
  });
  it("accepts only HTTPS TOS capabilities without credentials or fragments", () => {
    expect(libraryDownloadURL(signed)).toBe(signed);
    for (const bad of [
      "http://storage-cn.tos-cn-beijing.volces.com/a",
      "https://storage-cn.tos-cn-beijing.volces.com.evil.test/a",
      "https://evil.test/storage-cn.tos-cn-beijing.volces.com",
      "https://user:pass@storage-cn.tos-cn-beijing.volces.com/a",
      "https://storage-cn.tos-cn-beijing.volces.com:8443/a",
      "https://storage-cn.tos-cn-beijing.volces.com/a#frag",
      "javascript:alert(1)",
      42,
      undefined,
    ])
      expect(() => libraryDownloadURL(bad)).toThrow(ApiError);
  });
  it("formats sizes for people", () => {
    expect(fileSizeLabel(512)).toMatch(/512/);
    expect(fileSizeLabel(2048)).toMatch(/2/);
    expect(fileSizeLabel(3 * 1024 * 1024)).toMatch(/3/);
  });
});

describe("DirectLibrary", () => {
  it("follows after/last_id cursors, de-duplicates and filters by session", async () => {
    const { ark: client, request } = ark((path) => {
      const query = new URL(path, "https://ma.test").searchParams;
      expect(query.get("purpose")).toBe("agent");
      expect(query.get("limit")).toBe("100");
      expect(query.get("order")).toBe("desc");
      if (!query.get("after"))
        return {
          data: [
            raw("file-new", { created_at: now / 1000 }),
            raw("file-foreign", {
              scope: { type: "session", id: "sesn-other" },
            }),
          ],
          has_more: true,
          last_id: "file-foreign",
        };
      expect(query.get("after")).toBe("file-foreign");
      return {
        data: [raw("file-new"), raw("file-old", { created_at: 1 })],
        has_more: false,
        last_id: "file-old",
      };
    });
    const loader = vi.fn(async () => sessions);
    const files = await new DirectLibrary(client, loader).list();
    expect(files.map((file) => file.id)).toEqual(["file-new", "file-old"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenCalledWith(true);
  });
  it("skips the file API when no session belongs to this identity", async () => {
    const { ark: client, request } = ark(() => ({}));
    expect(
      await new DirectLibrary(client, async () => new Map()).list(),
    ).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
  it("stops on repeated cursors and malformed pages without guessing", async () => {
    const repeat = ark(() => ({ data: [], has_more: true, last_id: "file-a" }));
    await expect(
      new DirectLibrary(repeat.ark, async () => sessions).list(),
    ).rejects.toThrow(
      t("File pagination did not finish. Refresh the Library to try again."),
    );
    expect(repeat.request).toHaveBeenCalledTimes(2);
    const invalid = ark(() => ({ data: [], next_page: "x" }));
    await expect(
      new DirectLibrary(invalid.ark, async () => sessions).list(),
    ).rejects.toThrow(t("MA returned an invalid file list."));
  });
  it("requests a short-lived capability per open and enforces ownership and state", async () => {
    let file: Record<string, unknown> = raw("file-one");
    const { ark: client, request } = ark((path, init) => {
      expect(path).toBe("/files/file-one");
      expect(
        new Headers(init?.headers).get("X-Ark-PreSignedURL-ExpiresAfter"),
      ).toBe("300");
      return file;
    });
    const loader = vi.fn(async (fresh: boolean) =>
      fresh ? sessions : new Map<string, string>(),
    );
    const library = new DirectLibrary(client, loader);
    const opened = await library.download("file-one");
    expect(opened.url).toBe(signed);
    expect(loader.mock.calls).toEqual([[false], [true]]);
    file = raw("file-one", { status: "processing" });
    await expect(library.download("file-one")).rejects.toMatchObject({
      status: 409,
    });
    file = raw("file-one", { bytes: 10 * 1024 * 1024 + 1 });
    await expect(library.download("file-one")).rejects.toMatchObject({
      status: 413,
    });
    file = raw("file-one", { download_url: "https://evil.test/a" });
    await expect(library.download("file-one")).rejects.toMatchObject({
      status: 502,
    });
    file = raw("file-one", { scope: { type: "session", id: "sesn-other" } });
    await expect(library.download("file-one")).rejects.toMatchObject({
      status: 404,
    });
    await expect(library.download("../x")).rejects.toMatchObject({
      status: 400,
    });
    expect(request).toHaveBeenCalledTimes(5);
  });
});

describe("Library UI", () => {
  const item = libraryFile(
    raw("file-img", { filename: "cat.png", mime_type: "image/png" }),
    sessions,
    now,
  )!;
  it("renders the two reference sections as accessible tabs", () => {
    const html = renderToStaticMarkup(
      <LibrarySegments section="media" onSelect={() => {}} />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain(">Artifacts<");
    expect(html).toContain(">Media<");
    expect(html).toMatch(/id="library-media"[^>]*aria-selected="true"/);
    expect(html).not.toContain("<h1");
  });
  it("labels file cards and pending states without exposing addresses", () => {
    const html = renderToStaticMarkup(
      <LibraryFileCard item={item} onOpen={() => {}} />,
    );
    expect(html).toContain('aria-label="Open file: cat.png"');
    expect(html).toContain(">PNG<");
    expect(html).toContain("file-image");
    expect(html).not.toContain("tos-cn-beijing");
    expect(
      renderToStaticMarkup(
        <LibraryFileCard
          item={{ ...item, status: "processing" }}
          onOpen={() => {}}
        />,
      ),
    ).toContain("Processing file…");
  });
  it("describes empty sections without fabricated files", () => {
    expect(
      renderToStaticMarkup(<LibraryEmpty section="artifacts" />),
    ).toContain("Nothing created yet");
    expect(renderToStaticMarkup(<LibraryEmpty section="media" />)).toContain(
      "No media yet",
    );
  });
  it("translates Library copy for Simplified Chinese", () => {
    expect(t("Artifacts", {}, "zh-CN")).toBe("构件");
    expect(t("Media", {}, "zh-CN")).toBe("影音内容");
    expect(t("Available until {date}", { date: "10月1日" }, "zh-CN")).toBe(
      "保留至 10月1日",
    );
  });
});

describe("Native file bridge", () => {
  function bridge(result: unknown) {
    const postMessage = vi.fn(async () => result);
    vi.stubGlobal("window", {
      webkit: { messageHandlers: { museFiles: { postMessage } } },
    });
    return postMessage;
  }
  it("sends only the validated capability, name, action and close label", async () => {
    const post = bridge("opened");
    await openLibraryFile(signed, "cat.png", "share");
    expect(post).toHaveBeenCalledWith({
      url: signed,
      name: "cat.png",
      action: "share",
      closeLabel: "Close preview",
    });
    expect(t("Close preview", {}, "zh-CN")).toBe("关闭预览");
  });
  it("rejects unsafe addresses before reaching native code", async () => {
    const post = bridge("opened");
    await expect(
      openLibraryFile("https://evil.test/x", "x", "preview"),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it("maps native outcomes and missing bridges to localized errors", async () => {
    bridge("too-large");
    await expect(openLibraryFile(signed, "x", "preview")).rejects.toThrow(
      "File previews and sharing support files up to 10 MB.",
    );
    bridge("unavailable");
    await expect(openLibraryFile(signed, "x", "preview")).rejects.toThrow(
      "Couldn't open this file. Refresh the Library and try again.",
    );
    vi.stubGlobal("window", {});
    await expect(openLibraryFile(signed, "x", "preview")).rejects.toThrow(
      "Open this file in the iOS app to preview or share it.",
    );
  });
});

describe("Media thumbnails", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  function bridge(respond: (body: Record<string, string>) => unknown) {
    const postMessage = vi.fn(async (body: Record<string, string>) =>
      respond(body),
    );
    vi.stubGlobal("window", {
      webkit: { messageHandlers: { museFiles: { postMessage } } },
    });
    return postMessage;
  }
  const item = (overrides: Partial<LibraryFile> = {}) =>
    ({
      ...libraryFile(
        raw("file-img", { filename: "cat.png", mime_type: "image/png" }),
        sessions,
        now,
      )!,
      ...overrides,
    }) as LibraryFile;
  it("requests thumbnails only for active images within the size cap", () => {
    expect(wantsThumbnail(item())).toBe(true);
    expect(wantsThumbnail(item({ bytes: undefined }))).toBe(true);
    expect(wantsThumbnail(item({ bytes: 10 * 1024 * 1024 + 1 }))).toBe(false);
    expect(wantsThumbnail(item({ status: "processing" }))).toBe(false);
    expect(wantsThumbnail(item({ kind: "video" }))).toBe(false);
    expect(wantsThumbnail(item({ kind: "artifact" }))).toBe(false);
  });
  it("sends only a validated capability and accepts only re-encoded pixels", async () => {
    const post = bridge(() => png);
    const signedURL = vi.fn(async () => signed);
    expect(await libraryThumbnail(signedURL)).toBe(png);
    expect(post).toHaveBeenCalledWith({ url: signed, action: "thumbnail" });
    for (const result of [
      signed,
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:text/html;base64,PGI+",
      "data:image/png;base64,<script>",
      "data:image/jpeg;base64," + "A".repeat(2 * 1024 * 1024),
      "unavailable",
      "busy",
      42,
    ]) {
      bridge(() => result);
      expect(await libraryThumbnail(signedURL)).toBeUndefined();
    }
    const unsafe = bridge(() => png);
    await expect(
      libraryThumbnail(async () => "https://evil.test/x"),
    ).rejects.toThrow();
    expect(unsafe).not.toHaveBeenCalled();
    vi.stubGlobal("window", {});
    const unused = vi.fn(async () => signed);
    expect(await libraryThumbnail(unused)).toBeUndefined();
    expect(unused).not.toHaveBeenCalled();
    expect(canRenderThumbnails()).toBe(false);
  });
  it("keeps at most two native requests in flight and fetches URLs only when a slot is free", async () => {
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    bridge(
      () =>
        new Promise((resolve) => {
          active++;
          peak = Math.max(peak, active);
          releases.push(() => {
            active--;
            resolve(png);
          });
        }),
    );
    const signedURL = vi.fn(async () => signed);
    const all = Promise.all(
      Array.from({ length: 5 }, () => libraryThumbnail(signedURL)),
    );
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(signedURL).toHaveBeenCalledTimes(2);
    while (releases.length) {
      releases.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(await all).toEqual(Array(5).fill(png));
    expect(peak).toBe(2);
    expect(signedURL).toHaveBeenCalledTimes(5);
  });
  it("loads each id once with a bounded pool, tolerating failures and cancellation", async () => {
    const seen: string[] = [];
    const results: [string, string | undefined][] = [];
    await loadThumbnails(
      ["a", "b", "c"],
      async (id) => {
        seen.push(id);
        if (id === "b") throw new Error("offline");
        return `data-${id}`;
      },
      (id, data) => results.push([id, data]),
      () => false,
    );
    expect(seen.sort()).toEqual(["a", "b", "c"]);
    expect(Object.fromEntries(results)).toEqual({
      a: "data-a",
      b: undefined,
      c: "data-c",
    });
    let stop = false;
    const delivered: string[] = [];
    await loadThumbnails(
      ["x", "y", "z"],
      async (id) => {
        stop = true;
        return id;
      },
      (id) => delivered.push(id),
      () => stop,
      1,
    );
    expect(delivered).toEqual([]);
  });
  it("renders a thumbnail as a decorative image inside the labelled card", () => {
    const html = renderToStaticMarkup(
      <LibraryFileCard item={item()} thumbnail={png} onOpen={() => {}} />,
    );
    expect(html).toContain('aria-label="Open file: cat.png"');
    expect(html).toContain(`src="${png}"`);
    expect(html).toContain('alt=""');
    expect(html).not.toContain(">PNG<");
    expect(html).not.toContain("tos-cn-beijing");
  });
});
