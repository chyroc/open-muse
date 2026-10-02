import { t } from "../shared/i18n";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { uuid } from "../shared/crypto";
export const nativeMobile = () => Capacitor.isNativePlatform();

export async function exportText(
  name: string,
  content: string,
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
        if (result.success) resolve(t("Conversation saved"));
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
      dialogTitle: t("Export conversation"),
    });
    return result.activityType
      ? t("Handed off to the selected app")
      : t("Share sheet closed");
  }
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return t("Markdown download started");
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
