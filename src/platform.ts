import { t } from "../shared/i18n";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { uuid } from "../shared/crypto";
import type { Surface } from "../shared/turn-context";
export const nativeMobile = () => Capacitor.isNativePlatform();
// The Android app, which mirrors the iPhone app's native features with
// Android's own: Health Connect, the system share sheet and viewers.
export const onAndroid = () => Capacitor.getPlatform() === "android";

// Which Open Muse app this page runs in: the iPhone or Android app, the Mac
// shell (known by its computer-control bridge), or a browser.
export function appSurface(): Surface {
  if (Capacitor.getPlatform() === "ios") return "iphone";
  if (onAndroid()) return "android";
  const shell = globalThis as unknown as {
    webkit?: { messageHandlers?: { museComputer?: unknown } };
  };
  return shell.webkit?.messageHandlers?.museComputer ? "mac" : "web";
}

// Saves text as a file: a save panel on the Mac, the share sheet on phones, and a
// download on the web. The labels default to a conversation's Markdown.
export async function exportText(
  name: string,
  content: string,
  labels: {
    saved?: string;
    dialogTitle?: string;
    downloaded?: string;
    type?: string;
  } = {},
): Promise<string> {
  const desktop = window as unknown as {
    webkit?: {
      messageHandlers?: {
        museExport?: { postMessage: (value: object) => void };
      };
    };
  };
  if (desktop.webkit?.messageHandlers?.museExport) {
    const id = uuid();
    const promise = new Promise<string>((resolve, reject) => {
      const listener = (event: Event) => {
        const result = (event as CustomEvent).detail;
        if (result.id !== id) return;
        window.removeEventListener("muse-export-result", listener);
        if (result.success) resolve(labels.saved ?? t("Conversation saved"));
        else if (result.cancelled) resolve(t("Export canceled"));
        else
          reject(new Error(t("Save failed. Please check file permissions.")));
      };
      window.addEventListener("muse-export-result", listener);
    });
    desktop.webkit.messageHandlers.museExport.postMessage({
      id,
      name,
      content,
    });
    return promise;
  }
  if (nativeMobile()) {
    const result = await Share.share({
      title: name,
      text: content,
      dialogTitle: labels.dialogTitle ?? t("Export conversation"),
    });
    return result.activityType
      ? t("Handed off to the selected app")
      : t("Share sheet closed");
  }
  const url = URL.createObjectURL(
    new Blob([content], {
      type: labels.type ?? "text/markdown;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return labels.downloaded ?? t("Markdown download started");
}

// Shares plain text through the system share sheet, or copies it where no
// share sheet is available.
export async function shareText(text: string) {
  if (nativeMobile()) {
    await Share.share({ text });
    return;
  }
  if (navigator.share) {
    await navigator.share({ text });
    return;
  }
  await navigator.clipboard.writeText(text);
}
