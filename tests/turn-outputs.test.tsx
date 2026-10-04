import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LibraryFile } from "../shared/library";
import { TurnOutputs } from "../src/TurnOutputs";

const file = (
  name: string,
  mime_type: string,
  bytes = 593_200,
): LibraryFile => ({
  id: `file-${name}`,
  name,
  mime_type,
  bytes,
  status: "active",
  kind: "artifact",
  session_id: "session-1",
  session_title: "Main chat",
  created_at: "2026-10-05T00:00:00Z",
});
const client = {
  libraryFileDownload: async () => {
    throw new Error("not in tests");
  },
};

describe("Files from a turn", () => {
  it("shows a PDF as a card with room for its first page", () => {
    const html = renderToStaticMarkup(
      <TurnOutputs
        files={[file("杭州一日游.pdf", "application/pdf")]}
        client={client}
      />,
    );
    expect(html).toContain("turn-output-document");
    expect(html).toContain('class="turn-output-page"');
    expect(html).toContain("杭州一日游.pdf");
    expect(html).toContain("PDF · 579.3 kB");
  });

  it("keeps other files and oversized PDFs as plain cards", () => {
    const html = renderToStaticMarkup(
      <TurnOutputs
        files={[
          file("notes.md", "text/markdown"),
          file("scan.pdf", "application/pdf", 30 * 1024 * 1024),
        ]}
        client={client}
      />,
    );
    expect(html.match(/turn-output-file/g)).toHaveLength(2);
    // Too large to draw on the device: no page area.
    expect(html).not.toContain('class="turn-output-page"');
  });
});
