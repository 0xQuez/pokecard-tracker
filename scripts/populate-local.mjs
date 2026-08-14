#!/usr/bin/env node
// Populate the LOCAL embed_test.card_embeddings with REAL CLIP embeddings so the
// verification pipeline runs against a real ANN index (mirrors T23.2's approach).
import { CLIPVisionModelWithProjection, AutoProcessor, RawImage } from "@huggingface/transformers";
const MODEL = "Xenova/clip-vit-base-patch32";
const DIM = 512;
const PG = "http://127.0.0.1:5800";

async function embed(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const image = await RawImage.fromBlob(new Blob([buf]));
  const [processor, model] = await Promise.all([AutoProcessor.from_pretrained(MODEL), CLIPVisionModelWithProjection.from_pretrained(MODEL)]);
  const { pixel_values } = await processor(image);
  const out = await model({ pixel_values });
  return "[" + Array.from(out.image_embeds.data.slice(0, DIM)).map((x) => x.toFixed(6)).join(",") + "]";
}

async function searchCards(query) {
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=250&select=id,name,number,set,images`);
      if (res.ok) { const body = await res.json(); return body.data || []; }
      if (res.status === 429) { await new Promise(r => setTimeout(r, 3000)); continue; }
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  } catch (e) { console.warn(`  search ${query} failed: ${e.message}`); }
  console.warn(`  search ${query}: giving up, returning []`);
  return [];
}

async function insert(card, embedding) {
  const res = await fetch(`${PG}/card_embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      card_id: card.id, set_id: card.set.id, number: String(card.number),
      name: card.name, image_url: card.images?.large || card.images?.small, embedding,
    }),
  });
  if (!res.ok) throw new Error(`insert ${card.id} failed: HTTP ${res.status} ${await res.text()}`);
}

const targets = [];
const seen = new Set();
const add = (c) => { if (c?.id && !seen.has(c.id) && c.images?.large) { seen.add(c.id); targets.push(c); } };

// All Charmander arts (the confusable family the regression targets)
for (const c of await searchCards('name:charmander')) add(c);
// Plus a spread of other cards for ANN density
for (const q of ["name:charizard", "name:pikachu", "name:mew", "name:umbreon", "name:eevee", "name:snorlax"]) {
  for (const c of await searchCards(q)) add(c);
}

console.log(`embedding ${targets.length} unique cards...`);
// Resume-safe: skip card_ids already in the table.
const existingRes = await fetch(`${PG}/card_embeddings?select=card_id&limit=2000`);
let existing = new Set();
if (existingRes.ok) {
  const rows = await existingRes.json();
  existing = new Set((rows || []).map((r) => r.card_id));
}
const todo = targets.filter((c) => !existing.has(c.id));
console.log(`  ${targets.length - todo.length} already present, embedding ${todo.length} new...`);
let ok = 0, fail = 0;
const CONC = 2;
for (let i = 0; i < todo.length; i += CONC) {
  const batch = todo.slice(i, i + CONC);
  await Promise.all(batch.map(async (card) => {
    try { await insert(card, await embed(card.images.large)); ok++; }
    catch (e) { console.error(`  FAIL ${card.id}: ${e.message}`); fail++; }
  }));
  if (ok % 40 === 0) console.log(`  ${ok} embedded...`);
}
console.log(`done. ${ok} inserted, ${fail} failed`);
