import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
export const nativeMobile = () => Capacitor.isNativePlatform();
export async function openAuthorization(url: string) {
  if (new URL(url).origin !== "https://signin.volcengine.com")
    throw new Error("授权站点不正确。");
  if (nativeMobile()) await Browser.open({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

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
    const id = crypto.randomUUID();
    const promise = new Promise<string>((resolve, reject) => {
      const listener = (event: Event) => {
        const result = (event as CustomEvent).detail;
        if (result.id !== id) return;
        window.removeEventListener("muse-export-result", listener);
        if (result.success) resolve("对话已保存");
        else if (result.cancelled) resolve("已取消导出");
        else reject(new Error("保存失败，请检查文件权限。"));
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
      dialogTitle: "导出对话",
    });
    return result.activityType ? "已交给所选应用" : "分享窗口已关闭";
  }
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "已发起 Markdown 下载";
}
