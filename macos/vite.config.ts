import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { backgroundOrigin } from "../shared/background-origin";

const background = backgroundOrigin(process.env.VITE_MUSE_BACKGROUND_URL);

export default defineConfig({
  define: {
    "import.meta.env.VITE_MUSE_BACKGROUND_URL": JSON.stringify(background),
  },
  root: path.join(import.meta.dirname, "ui"),
  base: "./",
  publicDir: false,
  plugins: [
    react(),
    {
      name: "muse-background-csp",
      transformIndexHtml(html) {
        return background
          ? html.replace(
              "connect-src 'self'",
              `connect-src 'self' ${background}`,
            )
          : html;
      },
    },
  ],
  build: {
    outDir: path.join(import.meta.dirname, "../.build/macos-ui"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
});
