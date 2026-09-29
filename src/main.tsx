import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Capacitor } from "@capacitor/core";
import "./styles.css";
import "./muse.css";

const desktop = Boolean(
  (window as unknown as { __OPEN_MUSE_DESKTOP__?: boolean })
    .__OPEN_MUSE_DESKTOP__,
);
if (desktop) document.documentElement.classList.add("native-desktop");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  ["http:", "https:"].includes(location.protocol) &&
  !Capacitor.isNativePlatform() &&
  !desktop
) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    /* 离线外壳不可用时，不影响在线功能。 */
  });
}
