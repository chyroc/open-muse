import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SentFiles } from "../ui/Attachments";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount(element: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Mac sent photos", () => {
  it("shows a photo it has a copy of, and names one it has not", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    if (!URL.createObjectURL)
      Object.assign(URL, {
        createObjectURL: () => "",
        revokeObjectURL: () => {},
      });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const load = vi.fn(async (fileId: string) =>
      fileId === "file_kept"
        ? {
            kind: "image" as const,
            blob: new Blob(["x"], { type: "image/png" }),
          }
        : undefined,
    );
    await mount(
      <SentFiles
        load={load}
        items={[
          { key: "file_kept", name: "cat.png", kind: "image" },
          { key: "file_gone", name: "dog.png", kind: "image" },
          { key: "file_doc", name: "notes.pdf", kind: "document" },
        ]}
      />,
    );
    expect(load).toHaveBeenCalledTimes(2);
    const image = host!.querySelector<HTMLImageElement>(".mac-sent-image img");
    expect(image?.getAttribute("src")).toBe("blob:photo");
    // One with no copy yet is named, and looked for again while it may be
    // on its way; once found it shows.
    expect(host!.textContent).toContain("dog.png");
    load.mockImplementation(async () => ({
      kind: "image" as const,
      blob: new Blob(["x"], { type: "image/png" }),
    }));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(load).toHaveBeenCalledTimes(3);
    expect(host!.textContent).not.toContain("dog.png");
    expect(host!.querySelectorAll(".mac-sent-image img")).toHaveLength(2);
    expect(host!.textContent).toContain("notes.pdf");
    expect(host!.textContent).not.toContain("cat.png");
  });
});
