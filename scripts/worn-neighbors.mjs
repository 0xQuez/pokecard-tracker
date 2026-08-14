import { embedQueryImage } from "../src/lib/hunter/embedding-lookup.ts";
import fs from "node:fs";
const wornBytes = fs.readFileSync("fixtures/worn-angled-svp44.png");
const emb = await embedQueryImage(new Uint8Array(wornBytes));
const vec = "[" + Array.from(emb).map((x) => x.toFixed(6)).join(",") + "]";
const res = await fetch("http://127.0.0.1:5800/rpc/match_card_embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json", Prefer: "return=representation" },
  body: JSON.stringify({ query_embedding: vec, match_count: 20 }),
});
const rows = await res.json();
console.log("worn-capture nearest neighbors:");
rows.slice(0, 6).forEach((r, i) => console.log(`  ${i + 1}. ${r.card_id} ${r.name} sim=${r.similarity.toFixed(4)}`));
console.log(`gap #1-#2 = ${(rows[0].similarity - rows[1].similarity).toFixed(4)}`);
