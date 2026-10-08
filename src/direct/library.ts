import { z } from "zod";
import { ApiError, type ArkClient } from "../../shared/ark";
import { t } from "../../shared/i18n";
import {
  fileId,
  fileObject,
  libraryFile,
  libraryDownloadURL,
  type LibraryFile,
} from "../../shared/library";

const filePage = z.object({
  data: z.array(z.unknown()),
  has_more: z.boolean(),
  last_id: z.string(),
});

export class DirectLibrary {
  constructor(
    private ark: ArkClient,
    private sessions: (fresh: boolean) => Promise<ReadonlyMap<string, string>>,
  ) {}

  async list(): Promise<LibraryFile[]> {
    const sessions = await this.sessions(true);
    if (!sessions.size) return [];
    const files = new Map<string, LibraryFile>();
    const cursors = new Set<string>();
    let after = "";
    do {
      const query = new URLSearchParams({
        purpose: "agent",
        limit: "100",
        order: "desc",
      });
      if (after) query.set("after", after);
      const result = filePage.safeParse(
        await this.ark.request(`/files?${query}`),
      );
      if (!result.success)
        throw new ApiError(502, t("MA returned an invalid file list."));
      for (const raw of result.data.data) {
        const item = libraryFile(raw, sessions);
        if (item && !files.has(item.id)) files.set(item.id, item);
      }
      if (!result.data.has_more) break;
      after = result.data.last_id;
      // A cursor that repeats or does not look like a file ends the list
      // with what was read, as does the page limit: the Library only shows
      // files, so a long or inconsistent list is cut rather than refused.
      if (
        !fileId.safeParse(after).success ||
        cursors.has(after) ||
        cursors.size >= 100
      )
        break;
      cursors.add(after);
    } while (after);
    return [...files.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }

  async download(id: string) {
    if (!fileId.safeParse(id).success)
      throw new ApiError(400, t("Invalid resource ID."));
    // Ask for a short-lived capability on every open; it is never stored.
    const raw = await this.ark.request(`/files/${encodeURIComponent(id)}`, {
      headers: { "X-Ark-PreSignedURL-ExpiresAfter": "300" },
    });
    const item =
      libraryFile(raw, await this.sessions(false)) ??
      libraryFile(raw, await this.sessions(true));
    if (!item || item.id !== id)
      throw new ApiError(404, t("This file is not available in your Library."));
    if (item.status !== "active")
      throw new ApiError(
        409,
        t(
          "This file is not ready to open. Refresh the Library to check its status.",
        ),
      );
    if (item.bytes != null && item.bytes > 10 * 1024 * 1024)
      throw new ApiError(
        413,
        t("File previews and sharing support files up to 10 MB."),
      );
    return {
      item,
      url: libraryDownloadURL(fileObject.parse(raw).download_url),
    };
  }
}
