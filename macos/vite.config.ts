import { defineConfig } from "vite";
import { buildCommit } from "../scripts/build-commit.mjs";
import react from "@vitejs/plugin-react";
import path from "node:path";
import {
  backgroundConnectSource,
  backgroundOrigin,
} from "../shared/background-origin";
import { supabaseOrigin, supabasePublicKey } from "../shared/supabase-auth";
import { arkProvider, maProvider } from "../shared/ma-provider";

const background = backgroundOrigin(process.env.VITE_MUSE_BACKGROUND_URL);
const auth = supabaseOrigin(process.env.VITE_MUSE_SUPABASE_URL);
const authKey = supabasePublicKey(process.env.VITE_MUSE_SUPABASE_ANON_KEY);
// The Managed Agents backend; Volcano Ark unless VITE_MUSE_MA_PROVIDER says otherwise.
const ma = maProvider(process.env.VITE_MUSE_MA_PROVIDER);
if (Boolean(auth) !== Boolean(authKey))
  throw new Error(
    "Configure the Supabase Auth origin and public key together.",
  );

export default defineConfig({
  define: {
    "import.meta.env.VITE_MUSE_BACKGROUND_URL": JSON.stringify(background),
    "import.meta.env.VITE_MUSE_SUPABASE_URL": JSON.stringify(auth),
    "import.meta.env.VITE_MUSE_SUPABASE_ANON_KEY": JSON.stringify(authKey),
    "import.meta.env.VITE_MUSE_MA_PROVIDER": JSON.stringify(ma.id),
    "import.meta.env.VITE_OPEN_MUSE_COMMIT": JSON.stringify(buildCommit()),
  },
  root: path.join(import.meta.dirname, "ui"),
  base: "./",
  publicDir: false,
  plugins: [
    react(),
    {
      name: "muse-background-csp",
      // The page names Ark's origin; the build swaps in the chosen backend
      // and adds the account service.
      transformIndexHtml(html) {
        return html.replace(
          `connect-src 'self' ${arkProvider.origin}`,
          `connect-src 'self' ${[ma.origin, backgroundConnectSource(background), auth].filter(Boolean).join(" ")}`,
        );
      },
    },
  ],
  build: {
    outDir: path.join(import.meta.dirname, "../.build/macos-ui"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
});
