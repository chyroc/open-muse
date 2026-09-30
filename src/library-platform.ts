import { t } from "../shared/i18n";
import { libraryDownloadURL } from "../shared/library";

function nativeFiles() {
  return (
    window as unknown as {
      webkit?: {
        messageHandlers?: {
          museFiles?: { postMessage: (body: object) => Promise<unknown> };
        };
      };
    }
  ).webkit?.messageHandlers?.museFiles;
}

export function canRenderThumbnails() {
  return !!nativeFiles();
}

export async function openLibraryFile(
  url: string,
  name: string,
  action: "preview" | "share",
) {
  const native = nativeFiles();
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

// Native code returns re-encoded pixels only. Anything else, including an
// address or markup, is discarded so the page never renders untrusted bytes.
const thumbnailData = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
let activeThumbnails = 0;
const waitingThumbnails: (() => void)[] = [];

// One shared limit for the whole page, matching the native bridge's own cap.
async function thumbnailSlot<T>(work: () => Promise<T>) {
  if (activeThumbnails >= 2)
    await new Promise<void>((resolve) => waitingThumbnails.push(resolve));
  activeThumbnails++;
  try {
    return await work();
  } finally {
    activeThumbnails--;
    waitingThumbnails.shift()?.();
  }
}

export async function libraryThumbnail(signedURL: () => Promise<string>) {
  const native = nativeFiles();
  if (!native) return;
  return thumbnailSlot(async () => {
    // Request the capability only once a slot is free, so it cannot expire in the queue.
    const result = await native.postMessage({
      url: libraryDownloadURL(await signedURL()),
      action: "thumbnail",
    });
    return typeof result === "string" &&
      result.length <= 2 * 1024 * 1024 &&
      thumbnailData.test(result)
      ? result
      : undefined;
  });
}
