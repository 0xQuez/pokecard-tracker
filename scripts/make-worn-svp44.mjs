#!/usr/bin/env node
// Build a realistic worn/angled variant of the canonical svp-44 art and save it,
// so TEST 2 queries a genuinely degraded capture rather than the exact stored row.
import sharp from "sharp";

const SRC = "https://images.pokemontcg.io/svp/44_hires.png";
const OUT = "fixtures/worn-angled-svp44.png";
const W = 700, H = 1000;

const res = await fetch(SRC);
const buf = await res.arrayBuffer();

const overlay = Buffer.from(
  `<svg width="${W}" height="${H}">
     <defs>
       <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0%" stop-color="black" stop-opacity="0.4"/>
         <stop offset="55%" stop-color="black" stop-opacity="0.05"/>
         <stop offset="100%" stop-color="black" stop-opacity="0"/>
       </linearGradient>
     </defs>
     <rect width="${W}" height="${H}" fill="url(#g)"/>
   </svg>`
);

const out = sharp(buf)
  .rotate(9, { background: { r: 120, g: 120, b: 120, alpha: 1 } })
  .resize(W, H, { fit: "fill", background: { r: 120, g: 120, b: 120, alpha: 1 } })
  .composite([{ input: overlay, blend: "multiply" }])
  .blur(0.5)
  .modulate({ brightness: 0.9, saturation: 0.88 });

await out.png().toFile(OUT);
console.log(`wrote ${OUT} (${W}x${H})`);
