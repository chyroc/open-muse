import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.join(import.meta.dirname, "ui"),
  base: "./",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: path.join(import.meta.dirname, "../.build/macos-ui"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
});
