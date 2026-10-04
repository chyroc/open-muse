// Renders the companion's plush body (hood, arms, and the soft edge around
// the face) to src/assets/companion/plush.png. The face is drawn in CSS on
// top so it can blink and look around; this image is only the fur.
//
// The drawing is a 68 × 68 SVG matching .companion-avatar, rendered at 3×.
// Fur comes from two noise fields: one nudges every edge into soft fuzz, the
// other, stretched vertically into strands, shades the surface.
//
// Usage: node scripts/generate-companion.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const fur = (id, seed) => `
  <filter id="${id}" x="-15%" y="-15%" width="130%" height="130%"
    color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="1.6 0.9" numOctaves="2"
      seed="${seed}" result="edge"/>
    <feDisplacementMap in="SourceGraphic" in2="edge" scale="2.4"
      xChannelSelector="R" yChannelSelector="G" result="fuzzy"/>
    <feTurbulence type="fractalNoise" baseFrequency="2.8 0.8" numOctaves="3"
      seed="${seed + 1}" result="strands"/>
    <feColorMatrix in="strands" type="matrix" values="
      .3 .3 0 0 .2
      .3 .3 0 0 .2
      .3 .3 0 0 .2
      0 0 0 0 1" result="gray"/>
    <feComposite in="gray" in2="fuzzy" operator="in" result="texture"/>
    <feBlend in="texture" in2="fuzzy" mode="soft-light"/>
  </filter>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68"
  viewBox="0 0 68 68">
  <defs>
    ${fur("body", 7)}
    ${fur("rim", 11)}
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.2"/>
    </filter>
    <radialGradient id="body-shade" cx="42%" cy="20%" r="85%">
      <stop offset="0" stop-color="#f3ebe0"/>
      <stop offset=".45" stop-color="#e3d7c6"/>
      <stop offset=".75" stop-color="#d0c1ad"/>
      <stop offset="1" stop-color="#b6a48d"/>
    </radialGradient>
    <radialGradient id="rim-shade" cx="45%" cy="30%" r="70%">
      <stop offset="0" stop-color="#f5eee4"/>
      <stop offset="1" stop-color="#e2d6c5"/>
    </radialGradient>
  </defs>
  <g filter="url(#body)">
    <!-- Arms, tucked behind the body at its lower corners. -->
    <rect x="3" y="36" width="17" height="28" rx="8.5" fill="#d9ccb9"
      transform="rotate(20 11.5 50)"/>
    <rect x="48" y="36" width="17" height="28" rx="8.5" fill="#c8b8a3"
      transform="rotate(-25 56.5 50)"/>
    <!-- The body and hood, lit from the upper left. -->
    <rect x="7" y="6" width="54" height="60" rx="24" ry="26"
      fill="url(#body-shade)"/>
  </g>
  <!-- The hood's soft edge around the face, raised a little off the body. -->
  <rect x="15" y="12.2" width="39" height="34" rx="18" ry="16"
    fill="#a8957c" opacity=".35" filter="url(#shadow)"/>
  <rect x="15" y="11" width="39" height="34" rx="18" ry="16"
    fill="url(#rim-shade)" filter="url(#rim)"/>
</svg>`;

const out = new URL("../src/assets/companion/", import.meta.url);
await mkdir(out, { recursive: true });
await sharp(Buffer.from(svg), { density: 72 * 3 })
  .png({ compressionLevel: 9 })
  .toFile(new URL("plush.png", out).pathname);
