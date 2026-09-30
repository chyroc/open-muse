import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentEditor } from "../ui/DocumentEditor";
import { defaultIdentity } from "../../src/direct/identity";

let root: Root;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
});

async function setup() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const initial = defaultIdentity();
  const saved = defaultIdentity();
  saved.name = "Aster";
  saved.documents["IDENTITY.md"].content = '{"name":"Aster"}';
  saved.documents["IDENTITY.md"].revision = "next-revision";
  const client = {
    saveIdentityDocument: vi.fn(async () => saved),
    companionIdentity: vi.fn(async () => saved),
  };
  const onSaved = vi.fn(),
    onClose = vi.fn();
  await act(async () =>
    root.render(
      <DocumentEditor
        initial={initial.documents["IDENTITY.md"]}
        client={client}
        connected
        onSaved={onSaved}
        onClose={onClose}
        onChat={vi.fn()}
      />,
    ),
  );
  return { client, initial, saved, onSaved, onClose };
}
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
async function edit(content: string) {
  const input = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, content);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Mac document editing", () => {
  it("blocks duplicate saves and marks an in-flight native save", async () => {
    const { client, saved } = await setup();
    let finish!: (value: typeof saved) => void;
    client.saveIdentityDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await edit('{"name":"Aster"}');
    await act(async () => {
      button("Save document").click();
      button("Save document").click();
    });
    expect(client.saveIdentityDocument).toHaveBeenCalledTimes(1);
    expect(
      (window as unknown as Record<string, unknown>)
        .__OPEN_MUSE_DOCUMENT_SAVING__,
    ).toBe(true);
    expect(button("Close document").disabled).toBe(true);
    await act(async () => finish(saved));
    expect(
      (window as unknown as Record<string, unknown>)
        .__OPEN_MUSE_DOCUMENT_SAVING__,
    ).toBe(false);
  });
  it("opens without a write, then saves once with the original revision", async () => {
    const { client, initial, onSaved } = await setup();
    expect(client.saveIdentityDocument).not.toHaveBeenCalled();
    await edit('{"name":"Aster"}');
    expect(button("Save document")).not.toBeNull();
    await act(async () => button("Save document").click());
    expect(client.saveIdentityDocument).toHaveBeenCalledExactlyOnceWith(
      "IDENTITY.md",
      '{"name":"Aster"}',
      initial.documents["IDENTITY.md"].revision,
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Saved and verified");
  });
  it("retains a rejected draft and does not replace it when inspecting the cloud", async () => {
    const { client } = await setup();
    client.saveIdentityDocument.mockRejectedValueOnce(
      new Error("This document changed since you opened it."),
    );
    await edit('{"name":"My draft"}');
    await act(async () => button("Save document").click());
    expect(host.querySelector("textarea")!.value).toBe('{"name":"My draft"}');
    expect(host.textContent).toContain("Your draft is still here");
    await act(async () => button("Review latest cloud version").click());
    expect(host.querySelector("textarea")!.value).toBe('{"name":"My draft"}');
    expect(client.saveIdentityDocument).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Latest cloud version");
  });
  it("guards both the editor close action and the native window close state", async () => {
    const { onClose } = await setup();
    await edit('{"name":"Unsaved"}');
    expect(
      (window as unknown as Record<string, unknown>)
        .__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__,
    ).toBe(true);
    await act(async () => button("Close document").click());
    expect(onClose).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Unsaved changes");
  });
});
