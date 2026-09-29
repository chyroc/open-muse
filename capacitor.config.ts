import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.openmuse.mobile",
  appName: "Open Muse",
  webDir: "dist",
  backgroundColor: "#f5f5f5",
  ios: { contentInset: "never" },
};
export default config;
