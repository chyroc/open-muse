// Reporting a problem on GitHub: the project's new-issue page, prefilled with
// what the person wrote and the app's setup. A link cannot carry a picture,
// so the shell puts the window's picture on the clipboard to paste there.
export const reportPage = "https://github.com/chyroc/open-muse/issues/new?";
const limit = 7600;

type Bridge = {
  postMessage: (body: Record<string, string>) => Promise<unknown>;
};
const bridge = () =>
  (
    window as unknown as {
      webkit?: { messageHandlers?: { museReport?: Bridge } };
    }
  ).webkit?.messageHandlers?.museReport;

export const reportAvailable = () => Boolean(bridge());

// A picture of the main window as it is now, or nothing.
export async function reportSnapshot() {
  const value = await bridge()
    ?.postMessage({ operation: "snapshot" })
    .catch(() => undefined);
  return typeof value === "string" && value.startsWith("data:image/png;base64,")
    ? value
    : undefined;
}

export function discardSnapshot() {
  void bridge()
    ?.postMessage({ operation: "discard" })
    .catch(() => undefined);
}

// The new-issue address: a title from the first line, the person's words, a
// place for the picture, and the setup. The words are shortened, never the
// setup, when the address would be too long.
export function issueLink({
  description,
  diagnostics,
  picture,
}: {
  description: string;
  diagnostics: string;
  picture: boolean;
}) {
  const words = description.trim();
  const firstLine = words.split("\n")[0]?.trim() ?? "";
  const title =
    firstLine.length > 80
      ? `${firstLine.slice(0, 79)}…`
      : firstLine || "Problem report";
  const body = (text: string) =>
    [
      "### What happened",
      text || "_No description._",
      ...(picture
        ? [
            "",
            "### Screenshot",
            "<!-- Paste the screenshot from your clipboard here (⌘V). -->",
          ]
        : []),
      "",
      "### About this Mac",
      "```",
      diagnostics,
      "```",
    ].join("\n");
  const link = (text: string) =>
    `${reportPage}${new URLSearchParams({ title, body: body(text) }).toString()}`;
  let text = words;
  while (link(text).length > limit && text.length > 0)
    text = text.slice(0, Math.max(0, text.length - 200));
  return link(text === words ? text : `${text}…`);
}

// Opens the issue page; the picture goes to the clipboard when kept.
export async function submitReport(url: string, picture: boolean) {
  const result = await bridge()?.postMessage({
    operation: "submit",
    url,
    image: picture ? "true" : "false",
  });
  return result === true;
}
