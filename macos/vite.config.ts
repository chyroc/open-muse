import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { backgroundOrigin } from "../shared/background-origin";
import { supabaseOrigin, supabasePublicKey } from "../shared/supabase-auth";

const background = backgroundOrigin(process.env.VITE_MUSE_BACKGROUND_URL);
const auth = supabaseOrigin(process.env.VITE_MUSE_SUPABASE_URL);
const authKey = supabasePublicKey(process.env.VITE_MUSE_SUPABASE_ANON_KEY);
if (Boolean(auth) !== Boolean(authKey))
  throw new Error(
    "Configure the Supabase Auth origin and public key together.",
  );

export default defineConfig({
  define: {
    "import.meta.env.VITE_MUSE_BACKGROUND_URL": JSON.stringify(background),
    "import.meta.env.VITE_MUSE_SUPABASE_URL": JSON.stringify(auth),
    "import.meta.env.VITE_MUSE_SUPABASE_ANON_KEY": JSON.stringify(authKey),
  },
  root: path.join(import.meta.dirname, "ui"),
  base: "./",
  publicDir: false,
  plugins: [
    react(),
    {
      name: "muse-background-csp",
      transformIndexHtml(html) {
        return background || auth
          ? html.replace(
              "connect-src 'self'",
              `connect-src 'self' ${[background, auth].filter(Boolean).join(" ")}`,
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
