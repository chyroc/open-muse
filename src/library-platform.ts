import { t } from "../shared/i18n";
import { libraryDownloadURL } from "../shared/library";

export async function openLibraryFile(
  url: string,
  name: string,
  action: "preview" | "share",
) {
  const native = (
    window as unknown as {
      webkit?: {
        messageHandlers?: {
          museFiles?: { postMessage: (body: object) => Promise<unknown> };
        };
      };
    }
  ).webkit?.messageHandlers?.museFiles;
  if (!native)
    throw new Error(t("Open this file in the iOS app to preview or share it."));
  const result = await native.postMessage({
    url: libraryDownloadURL(url),
    name,
    action,
    closeLabel: t("Close preview"),
  });
  if (result === "too-large")
    throw new Error(t("File previews and sharing support files up to 10 MB."));
  if (result !== "opened")
    throw new Error(
      t("Couldn't open this file. Refresh the Library and try again."),
    );
}
