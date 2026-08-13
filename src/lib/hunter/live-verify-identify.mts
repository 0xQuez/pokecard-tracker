// Live acceptance harness for T22.3 vision-identify.
// Runs against the real nous inference endpoint using the module's own
// defaultVisionFn (env-configured). NOT part of the test suite.
// Run: node src/lib/hunter/live-verify-identify.mts
import { extractCardIdentity, defaultVisionFn } from "./vision-identify.ts";

const IMAGES = [
  { label: "Charmander SVP-44 (PC promo)", url: "https://images.pokemontcg.io/svp/44.png" },
  { label: "Charizard Base Set 4 (holo)", url: "https://images.pokemontcg.io/base1/4.png" },
  { label: "Charmander Obsidian Flames 26", url: "https://images.pokemontcg.io/sv3/26.png" },
];

let pass = 0, fail = 0;
for (const img of IMAGES) {
  console.log(`\n=== ${img.label} ===`);
  console.log("url:", img.url);
  try {
    const r = await extractCardIdentity(img.url, defaultVisionFn);
    console.log("result:", JSON.stringify(r, null, 2));
    if ("error" in r) {
      console.log("-> UNREADABLE (fail for a known-good card)");
      fail++;
    } else {
      console.log(`-> name=${r.name} number=${r.collectorNumber} variant=${r.variant} print=${r.print} stamp=${r.stamp} conf=${r.confidence}`);
      if (r.name) pass++;
    }
  } catch (e) {
    console.log("-> ERROR:", (e as Error).message);
    fail++;
  }
}
console.log(`\n=== live result: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
