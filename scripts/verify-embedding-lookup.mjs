#!/usr/bin/env node
// T23.2 real end-to-end verification (local pgvector + PostgREST + real CLIP).
//
// 1. Loads the real CLIP model (Xenova/clip-vit-base-patch32), same as the app.
// 2. Downloads several REAL card artworks from pokemontcg.io, embeds each.
// 3. Inserts them into the local embed_test.card_embeddings via PostgREST
//    (anon role, same as the app's no-real-auth model).
// 4. Runs the actual match_card_embeddings RPC (HNSW index) for svp-44's
//    embedding and asserts svp-44 is rank 1.
// 5. Runs it for a DIFFERENT card's embedding and asserts svp-44 is NOT top 3.
//
// Run: node scripts/verify-embedding-lookup.mjs
import { CLIPVisionModelWithProjection, AutoProcessor, RawImage } from "@huggingface/transformers";

const MODEL = "Xenova/clip-vit-base-patch32";
const DIM = 512;
const PG = "http://127.0.0.1:5800";

// Cards: [card_id, set_id, number, name, imageUrl]
const CARDS = [
  ["svp-44", "svp", "44", "Charmander", "https://images.pokemontcg.io/svp/44.png"],
  ["det1-4", "det1", "4", "Detective Pikachu's Charmander", "https://images.pokemontcg.io/det1/4.png"],
  ["base1-46", "base1", "46", "Charmander", "https://images.pokemontcg.io/base1/46.png"],
  ["base1-4", "base1", "4", "Charizard", "https://images.pokemontcg.io/base1/4.png"],
  ["base1-25", "base1", "25", "Pikachu", "https://images.pokemontcg.io/base1/25.png"],
  ["sv1-151", "sv1", "151", "Mew ex", "https://images.pokemontcg.io/sv1/151.png"],
];

async function embed(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const image = await RawImage.fromBlob(new Blob([buf]));
  const [processor, model] = await Promise.all([AutoProcessor.from_pretrained(MODEL), CLIPVisionModelWithProjection.from_pretrained(MODEL)]);
  const { pixel_values } = await processor(image);
  const out = await model({ pixel_values });
  return "[" + Array.from(out.image_embeds.data.slice(0, DIM)).map((x) => x.toFixed(6)).join(",") + "]";
}

async function insert(card, embedding) {
  const res = await fetch(`${PG}/card_embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      card_id: card[0], set_id: card[1], number: card[2], name: card[3], image_url: card[4], embedding,
    }),
  });
  if (!res.ok) throw new Error(`insert ${card[0]} failed: HTTP ${res.status} ${await res.text()}`);
  console.log(`  inserted ${card[0]} (${card[3]})`);
}

async function rpc(queryEmbedding) {
  const res = await fetch(`${PG}/rpc/match_card_embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ query_embedding: queryEmbedding, match_count: 20 }),
  });
  if (!res.ok) throw new Error(`RPC failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log("Embedding real card art and inserting into local pgvector...");
  const embeds = {};
  for (const card of CARDS) {
    const e = await embed(card[4]);
    embeds[card[0]] = e;
    await insert(card, e);
  }

  // 1. svp-44 photo -> svp-44 must be rank 1.
  const svpRes = await rpc(embeds["svp-44"]);
  console.log("\nsvp-44 query -> top-5:");
  svpRes.slice(0, 5).forEach((r, i) => console.log(`  ${i + 1}. ${r.card_id} ${r.name} sim=${r.similarity.toFixed(4)}`));
  if (svpRes[0]?.card_id !== "svp-44") {
    console.error("FAIL: svp-44 not rank 1 for its own embedding");
    process.exit(1);
  }
  console.log("PASS: svp-44 is rank 1 for its own embedding");

  // 2. A DIFFERENT card's photo -> svp-44 must NOT be in top 3.
  for (const diff of ["det1-4", "base1-4"]) {
    const res = await rpc(embeds[diff]);
    const top3 = res.slice(0, 3).map((r) => r.card_id);
    const inTop3 = top3.includes("svp-44");
    console.log(`\n${diff} query -> top-5:`);
    res.slice(0, 5).forEach((r, i) => console.log(`  ${i + 1}. ${r.card_id} ${r.name} sim=${r.similarity.toFixed(4)}`));
    if (inTop3) {
      console.error(`FAIL: svp-44 is in top-3 for ${diff}'s embedding: ${top3.join(", ")}`);
      process.exit(1);
    }
    console.log(`PASS: svp-44 not in top-3 for ${diff} (top3=${top3.join(",")})`);
  }

  console.log("\nALL EMBEDDING-LOOKUP CHECKS PASSED");
}

main().catch((e) => { console.error("verification failed:", e); process.exit(1); });
