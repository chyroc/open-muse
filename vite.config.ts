import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { backgroundOrigin } from "./shared/background-origin";
import { supabaseOrigin, supabasePublicKey } from "./shared/supabase-auth";

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
  plugins: [
    react(),
    {
      name: "muse-offline-shell",
      transformIndexHtml(html, context) {
        if (context.server) return html;
        return [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://ark.cn-beijing.volces.com${background ? ` ${background}` : ""}${auth ? ` ${auth}` : ""}; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'`,
            },
            injectTo: "head-prepend",
          },
        ];
      },
      generateBundle(_options, bundle) {
        const assets = Object.keys(bundle).filter((name) =>
          /\.(js|css|html)$/.test(name),
        );
        const revision = createHash("sha256")
          .update(assets.join("|"))
          .digest("hex")
          .slice(0, 12);
        const cache = `open-muse-${revision}`;
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `
const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(["/", "/icon.svg", ...assets.map((name) => "/" + name)])};
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('open-muse-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/'))); return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname === '/icon.svg') {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
      return response;
    })));
  }
});`,
        });
      },
    },
  ],
  server: {
    port: 4310,
    strictPort: true,
    watch: {
      ignored: [
        "**/ios/**",
        "**/android/**",
        "**/references/**",
        "**/.data/**",
      ],
    },
  },
  build: { chunkSizeWarningLimit: 650 },
});
