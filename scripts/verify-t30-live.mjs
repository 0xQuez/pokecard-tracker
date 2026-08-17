#!/usr/bin/env node
// T30.3 live integration verification harness.
// POSTs card image URLs to the DEPLOYED identify endpoint (prod alias) and
// prints full request/response evidence (candidates, needsConfirmation,
// confirmationReason, variantHints, extracted) per scenario.
// Uses browser-like headers to satisfy the endpoint's bot protection.
//
// Run: node scripts/verify-t30-live.mjs [baseUrl]
//   baseUrl defaults to https://hipjumpers.vercel.app
import { writeFileSync } from "node:fs";

const BASE = process.argv[2] || "https://hipjumpers.vercel.app";

const SCENARIOS = [
  {
    id: 1,
    label: "Latios δ EX Holon Phantoms 22 (reverse-holo regression) — regular art",
    imageUrl: "https://images.pokemontcg.io/ex13/22.png",
  },
  {
    id: "1b",
    label: "Latios δ EX Holon Phantoms 22 — hires",
    imageUrl: "https://images.pokemontcg.io/ex13/22_hires.png",
  },
  {
    id: "2",
    label: "Single-print common — Charmander Obsidian Flames 26",
    imageUrl: "https://images.pokemontcg.io/sv3/26.png",
  },
  {
    id: "2b",
    label: "Single-print candidate B — Pikachu Scarlet & Violet 25",
    imageUrl: "https://images.pokemontcg.io/sv1/25.png",
  },
  {
    id: "3",
    label: "svp-44 Charmander (PC promo vs regular)",
    imageUrl: "https://images.pokemontcg.io/svp/44.png",
  },
  {
    id: "4",
    label: "Psyduck same-name refinement — Lost Thunder 26",
    imageUrl: "https://images.pokemontcg.io/sm9/26.png",
  },
  {
    id: "4b",
    label: "Psyduck same-name refinement — Base Black Star Promo 20",
    imageUrl: "https://images.pokemontcg.io/basep/20.png",
  },
];

const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: `${BASE}/`,
  Origin: BASE,
};

async function post(imageUrl) {
  const res = await fetch(`${BASE}/api/hunter/identify`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ imageUrl }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { _raw: text.slice(0, 500) };
  }
  return { status: res.status, parsed };
}

const evidence = {};
for (const sc of SCENARIOS) {
  console.log(`\n${"=".repeat(72)}\nSCENARIO ${sc.id}: ${sc.label}\n${"=".repeat(72)}`);
  let res;
  try {
    res = await post(sc.imageUrl);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    evidence[sc.id] = { error: e.message };
    continue;
  }
  console.log(`  HTTP ${res.status}`);
  console.log(JSON.stringify(res.parsed, null, 2));
  evidence[sc.id] = { status: res.status, ...res.parsed };
}

writeFileSync(
  new URL("../.hermes-t30-evidence.json", import.meta.url),
  JSON.stringify(evidence, null, 2),
);
console.log(`\n=== T30.3 probe complete — evidence written to .hermes-t30-evidence.json ===`);
