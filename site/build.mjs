// Builds the getopenmuse.com website into .build/site: the pages in
// site/public, the README screenshots from docs/images, and the app icons.
// The screenshots are copied at build time so the repository keeps one copy.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".build/site");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, "site/public"), out, { recursive: true });
cpSync(path.join(root, "docs/images"), path.join(out, "images"), {
  recursive: true,
});
for (const icon of ["icon-192.png", "icon-512.png", "icon.svg"])
  cpSync(path.join(root, "public", icon), path.join(out, icon));
console.log(`Built ${path.relative(root, out)}`);
