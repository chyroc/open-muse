import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Capacitor } from "@capacitor/core";
import "./motion.css";
import "./styles.css";
import "./muse.css";
import "./chat.css";
import "./dark.css";
import "./appearance.css";
import { applyAppearance } from "./appearance";
import { initializeLanguage } from "../shared/i18n";
import { followAndroidTextScale, followDynamicType } from "./dynamic-type";

initializeLanguage();
applyAppearance();

const desktop = Boolean(
  (window as unknown as { __OPEN_MUSE_DESKTOP__?: boolean })
    .__OPEN_MUSE_DESKTOP__,
);
if (desktop) document.documentElement.classList.add("native-desktop");
if (Capacitor.getPlatform() === "ios") followDynamicType();
if (Capacitor.getPlatform() === "android") followAndroidTextScale();
// The display's corner radius, from the iPhone or Android app, for concentric
// sheets.
const corner = (window as unknown as { __OPEN_MUSE_DEVICE_CORNER__?: number })
  .__OPEN_MUSE_DEVICE_CORNER__;
if (typeof corner === "number" && corner > 0 && corner < 200)
  document.documentElement.style.setProperty("--device-corner", `${corner}px`);

// iOS does not include the software keyboard in dynamic viewport units. Size
// the app to the visible viewport so focusing the composer cannot pan the
// entire document (including the header) underneath the status bar.
const viewport = window.visualViewport;
const updateViewport = () => {
  if (viewport && viewport.scale === 1) {
    document.documentElement.style.setProperty(
      "--app-height",
      `${viewport.height}px`,
    );
    document.documentElement.style.setProperty(
      "--app-top",
      `${viewport.offsetTop}px`,
    );
  }
};
viewport?.addEventListener("resize", updateViewport);
viewport?.addEventListener("scroll", updateViewport);
updateViewport();

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
    /* If the offline shell is unavailable, online functionality is unaffected. */
  });
}
