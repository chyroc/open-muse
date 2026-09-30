import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ArkClient } from "../shared/ark";
import { t } from "../shared/i18n";
import {
  attachmentAccept,
  attachmentBlocks,
  attachmentType,
  checkAttachment,
  messageAttachments,
} from "../shared/attachments";
import type { AgentEvent } from "../shared/types";
import { DirectAttachments } from "../src/direct/attachments";
import { MessageAttachments, StagedAttachments } from "../src/Attachments";
import { ChatComposer } from "../src/ChatUI";

describe("Attachment rules", () => {
  it("accepts model-supported images and documents, inferring types from names", () => {
    expect(attachmentType("cat.png", "image/png")).toEqual({
      kind: "image",
      mime: "image/png",
      inline: false,
    });
    expect(attachmentType("notes.md", "")).toEqual({
      kind: "document",
      mime: "text/markdown",
      inline: true,
    });
    expect(attachmentType("data.CSV", "text/plain").mime).toBe("text/csv");
    for (const reported of [
      "text/x-markdown",
      "application/octet-stream",
      "text/vnd.daringfireball.markdown",
    ])
      expect(attachmentType("notes.md", reported)).toEqual({
        kind: "document",
        mime: "text/markdown",
        inline: true,
      });
    expect(attachmentType("data.csv", "application/vnd.ms-excel").mime).toBe(
      "text/csv",
    );
    expect(() => attachmentType("paper.pdf", "text/plain")).toThrow();
    expect(attachmentType("paper.pdf", "application/pdf").kind).toBe(
      "document",
    );
    for (const [name, type] of [
      ["photo.heic", "image/heic"],
      ["vector.svg", "image/svg+xml"],
      ["page.html", "text/html"],
      ["notes.md", "text/html"],
      ["archive.zip", "application/zip"],
      ["noextension", ""],
    ])
      expect(() => attachmentType(name, type)).toThrow(
        "Attach images (JPEG, PNG, GIF, WebP)",
      );
    expect(attachmentAccept).toContain("image/png");
    expect(attachmentAccept).toContain(".md");
    expect(attachmentAccept).not.toContain("svg");
  });
  it("limits count, size and empty files", () => {
    expect(() => checkAttachment("a.png", "image/png", 1, 4)).toThrow(
      "Attach up to 4 files per message.",
    );
    expect(() => checkAttachment("a.png", "image/png", 0, 0)).toThrow(
      "This file is empty.",
    );
    expect(() =>
      checkAttachment("a.png", "image/png", 10 * 1024 * 1024 + 1, 0),
    ).toThrow("Attachments can be at most 10 MB each.");
    expect(
      checkAttachment("a.png", "image/png", 10 * 1024 * 1024, 3).kind,
    ).toBe("image");
  });
  it("builds MA file and inline text blocks and reads them back without trusting malformed ids", () => {
    const blocks = attachmentBlocks([
      { file_id: "file-img", name: "cat.png", kind: "image" },
      { file_id: "file-doc", name: "paper.pdf", kind: "document" },
      { text: "# Notes", name: "notes.md", kind: "document" },
    ]);
    expect(blocks).toEqual([
      { type: "image", source: { type: "file", file_id: "file-img" } },
      {
        type: "document",
        source: { type: "file", file_id: "file-doc" },
        title: "paper.pdf",
      },
      {
        type: "document",
        source: { type: "text", media_type: "text/plain", data: "# Notes" },
        title: "notes.md",
      },
    ]);
    const event = {
      id: "evt",
      type: "user.message",
      content: [
        ...blocks,
        { type: "image", source: { type: "file", file_id: "../x" } },
        { type: "image", source: { type: "url", url: "https://x" } },
        { type: "text", text: "What is this?" },
      ],
    } as unknown as AgentEvent;
    expect(messageAttachments(event, { "file-img": "cat.png" })).toEqual([
      { key: "file-img", kind: "image", name: "cat.png" },
      { key: "file-doc", kind: "document", name: "paper.pdf" },
      { key: "evt:2", kind: "document", name: "notes.md" },
    ]);
    expect(messageAttachments(event)[0].name).toBe("Image");
    expect(JSON.stringify(messageAttachments(event))).not.toContain("# Notes");
    expect(messageAttachments({ ...event, type: "agent.message" })).toEqual([]);
  });
  it("classifies PDFs for upload and text formats for inline sending", () => {
    expect(attachmentType("a.pdf", "application/pdf").inline).toBe(false);
    expect(attachmentType("a.png", "image/png").inline).toBe(false);
    expect(attachmentType("a.md", "").inline).toBe(true);
    expect(attachmentType("a.csv", "text/csv").inline).toBe(true);
  });
});

describe("DirectAttachments", () => {
  function ark(responses: unknown[]) {
    const request = vi.fn(async () => responses.shift());
    return { request, ark: { request } as unknown as ArkClient };
  }
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], {
    type: "image/png",
  });
  it("uploads user data as multipart and waits for MA to finish processing", async () => {
    const { ark: client, request } = ark([
      { id: "file-1", purpose: "user_data", status: "processing" },
      { id: "file-1", purpose: "user_data", status: "active" },
    ]);
    const wait = vi.fn(async () => {});
    const item = await new DirectAttachments(client, wait).upload(
      png,
      "folder/cat.png",
      0,
    );
    expect(item).toEqual({
      file_id: "file-1",
      name: "folder-cat.png",
      kind: "image",
    });
    const [path, init] = request.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe("/files");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("purpose")).toBe("user_data");
    expect((form.get("file") as File).name).toBe("folder-cat.png");
    expect((form.get("file") as File).type).toBe("image/png");
    expect((request.mock.calls[1] as unknown as [string])[0]).toBe(
      "/files/file-1",
    );
    expect(wait).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid files before any write and reports failures without retrying", async () => {
    const local = ark([]);
    expect(
      await new DirectAttachments(local.ark).upload(
        new Blob(["# Notes\n"], { type: "text/x-markdown" }),
        "notes.md",
        0,
      ),
    ).toEqual({ name: "notes.md", kind: "document", text: "# Notes\n" });
    await expect(
      new DirectAttachments(local.ark).upload(
        new Blob([new Uint8Array([0xff, 0xfe, 0xfd])], { type: "" }),
        "binary.txt",
        0,
      ),
    ).rejects.toThrow("This text file is not valid UTF-8.");
    await expect(
      new DirectAttachments(local.ark).upload(
        new Blob(["x".repeat(200_001)], { type: "text/plain" }),
        "long.txt",
        0,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      new DirectAttachments(local.ark).upload(
        new Blob(["   \n"], { type: "text/plain" }),
        "blank.txt",
        0,
      ),
    ).rejects.toThrow("This file is empty.");
    expect(local.request).not.toHaveBeenCalled();
    const none = ark([]);
    await expect(
      new DirectAttachments(none.ark).upload(
        new Blob(["x"], { type: "text/html" }),
        "page.html",
        0,
      ),
    ).rejects.toThrow("Attach images");
    expect(none.request).not.toHaveBeenCalled();
    const failed = ark([
      { id: "file-2", purpose: "user_data", status: "failed" },
    ]);
    await expect(
      new DirectAttachments(failed.ark).upload(png, "a.png", 0),
    ).rejects.toMatchObject({ status: 422 });
    expect(failed.request).toHaveBeenCalledTimes(1);
    const odd = ark([{ id: "file-3", purpose: "agent", status: "active" }]);
    await expect(
      new DirectAttachments(odd.ark).upload(png, "a.png", 0),
    ).rejects.toThrow("MA returned an unexpected upload result.");
    const stuck = ark(
      Array.from({ length: 21 }, () => ({
        id: "file-4",
        purpose: "user_data",
        status: "processing",
      })),
    );
    await expect(
      new DirectAttachments(stuck.ark, async () => {}).upload(png, "a.png", 0),
    ).rejects.toMatchObject({ status: 504 });
    expect(stuck.request).toHaveBeenCalledTimes(21);
  });
});

describe("Attachment UI", () => {
  it("replaces the composer's plus action with a native file picker", () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        value=""
        setValue={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        onAttach={() => {}}
        attachmentsReady
        busy={false}
        running={false}
        disabled={false}
      />,
    );
    expect(html).toContain('aria-label="Add attachment"');
    expect(html).toContain('type="file"');
    expect(html).toContain("multiple");
    expect(html).not.toContain('aria-label="Chat actions"');
    expect(html).toMatch(/aria-label="Send message"(?! disabled)/);
    const pending = renderToStaticMarkup(
      <ChatComposer
        value="Look"
        setValue={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        onAttach={() => {}}
        attachmentsReady
        attachmentsPending
        busy={false}
        running={false}
        disabled={false}
      />,
    );
    expect(pending).toContain('aria-label="Send message" disabled=""');
  });
  it("shows upload state and removal for each staged file", () => {
    const html = renderToStaticMarkup(
      <StagedAttachments
        items={[
          { key: "a", name: "cat.png", kind: "image", state: "uploading" },
          {
            key: "b",
            name: "notes.md",
            kind: "document",
            state: "failed",
            error: "MA could not process this file.",
          },
          {
            key: "c",
            name: "plan.pdf",
            kind: "document",
            state: "ready",
            value: { file_id: "file-c", name: "plan.pdf", kind: "document" },
          },
        ]}
        onRemove={() => {}}
      />,
    );
    expect(html).toContain("Uploading…");
    expect(html).toContain('role="alert"');
    expect(html).toContain("MA could not process this file.");
    expect(html).toContain("Ready to send");
    expect(html).toContain('aria-label="Remove attachment: notes.md"');
    expect(html).toMatch(/Remove attachment: cat.png" disabled=""/);
    expect(html).not.toContain("file-c");
    expect(
      renderToStaticMarkup(
        <MessageAttachments
          items={[{ key: "file-c", name: "plan.pdf", kind: "document" }]}
        />,
      ),
    ).toContain("plan.pdf");
  });
  it("translates attachment copy", () => {
    expect(t("Add attachment", {}, "zh-CN")).toBe("添加附件");
    expect(t("Remove attachment: {name}", { name: "a.md" }, "zh-CN")).toBe(
      "移除附件：a.md",
    );
  });
});
