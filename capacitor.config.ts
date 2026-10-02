import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.openmuse.mobile",
  appName: "Open Muse",
  webDir: "dist",
  backgroundColor: "#fcfcfc",
  ios: { contentInset: "never" },
};
export default config;
