#!/usr/bin/env node
// Card artwork embedding backfill (T23.1).
//
// One-time batch pipeline that builds the artwork-embedding knowledge base for every
// ~19k Pokemon card. For each card it downloads the canonical art, computes a CLIP image
// embedding locally (no per-image API cost), and upserts it into Supabase pgvector
// (`card_embeddings`, see supabase/migrations/005_card_embeddings.sql). This powers the
// scan-time artwork matcher that replaces text-only matching.
//
// EMBEDDING MODEL CHOICE
//   Xenova/clip-vit-base-patch32 via @huggingface/transformers (ONNX runtime, runs fully
//   locally on CPU — no external embedding API, so 19k images cost nothing). We use
//   CLIPVisionModelWithProjection, whose `image_embeds` is a 512-dim L2-normalized vector
//   (the table column is `vector(512)`). The model + processor weights are cached under
//   ~/.cache/huggingface (or node_modules/.cache/huggingface) after the first run. If you
//   swap models, update the column type in the migration and DIM below together.
//
// RUN:
//   node scripts/embed-cards.mjs                 # full ~19k backfill
//   node scripts/embed-cards.mjs --limit=50      # smoke: the first 50 cards by catalog id
//
// The script loads .env.local automatically (SUPABASE_URL + a key). It uses the service
// role key if SUPABASE_SERVICE_ROLE_KEY is present, else the anon key (the migration grants
// anon read/write on card_embeddings, matching the repo's no-real-auth model).
//
// RESUME / IDEMPOTENCY: card_id is the pokemontcg.io id and the table's primary key. The
// script first fetches every card_id already present and skips those, so re-running after a
// crash (or for new sets) continues where it left off and inserts 0 duplicates. Upserts use
// ON CONFLICT (card_id) DO UPDATE, so an interrupted flush re-runs cleanly.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  CLIPVisionModelWithProjection,
  AutoProcessor,
  RawImage,
} from "@huggingface/transformers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ── config ──────────────────────────────────────────────────────────────────
const MODEL = "Xenova/clip-vit-base-patch32";
const DIM = 512; // CLIP ViT-B/32 image embedding dimension — keep in sync with migration 005
const API_BASE = "https://api.pokemontcg.io/v2";
const CONCURRENCY = 5; // max parallel downloads/embeds (pokemontcg.io 500s under bursts)
const CONCURRENT_ENUM_FETCH = 5; // parallel catalog page fetches during enumeration
const MAX_RETRIES = 6; // exponential backoff retries per request
const FLUSH_BATCH = 20; // upsert rows per Supabase write
const LOG_EVERY = 10; // progress log cadence (cards processed)

// ── tiny .env loader (no dotenv dependency) ────────────────────────────────
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      const text = readFileSync(join(REPO_ROOT, f), "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
      }
    } catch {
      /* file absent — rely on ambient env */
    }
  }
}

// ── retry-with-backoff fetch (jittered exponential backoff on 429/5xx) ─────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      // 429 and 5xx are retryable; 4xx (other than 429) are not.
      if (res.status < 500 && res.status !== 429) throw lastErr;
    } catch (e) {
      if (e === lastErr && res?.status && res.status < 500 && res.status !== 429) throw e;
      lastErr = e;
    }
    const base = Math.pow(2, attempt) * 250; // 250ms, 500ms, 1s, 2s, 4s, 8s
    const jitter = Math.random() * 250;
    await sleep(base + jitter);
  }
  throw lastErr ?? new Error(`request failed: ${url}`);
}

async function fetchJson(url) {
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json" },
  });
  return res.json();
}

// ── pokemontcg.io enumeration (paginate /cards, pageSize max 250) ─────────
// Collects { id, set_id, number, name, image_url } for EVERY card, then sorts the result
// by card id so the catalog order is deterministic (pokemontcg.io's raw /cards ordering is
// not guaranteed stable across calls). Sorting by id is what makes a smoke `--limit=N`
// always target the SAME N cards, so re-running it is a no-op (idempotent). The caller
// applies the limit to this fixed ordering and then filters out already-present ids.
async function enumerateAllCards() {
  // First page tells us totalCount so we can fan out the rest concurrently.
  const first = await fetchJson(`${API_BASE}/cards?page=1&pageSize=250`);
  const totalCount = first.totalCount ?? 0;
  const pageCount = Math.ceil(totalCount / 250);
  const pageData = new Map(); // page -> cards (transient fetch failures retried)
  pageData.set(1, first.data ?? []);

  // Fetch remaining pages in parallel, retrying any that fail under the flaky API until
  // every page succeeds. A complete catalog is what makes a smoke `--limit=N` deterministic
  // (same N cards every run) and hence a re-run a true no-op.
  const pending = [];
  for (let p = 2; p <= pageCount; p++) pending.push(p);
  let failedPages = pending;
  for (let round = 0; round < 5 && failedPages.length > 0; round++) {
    const todo = failedPages;
    failedPages = [];
    let i = 0;
    async function worker() {
      while (i < todo.length) {
        const p = todo[i++];
        try {
          const body = await fetchJson(`${API_BASE}/cards?page=${p}&pageSize=250`);
          pageData.set(p, body.data ?? []);
        } catch {
          failedPages.push(p); // retry next round
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENT_ENUM_FETCH }, worker));
    if (failedPages.length > 0) {
      console.warn(`[embed-cards] enumeration: retrying ${failedPages.length} failed page(s) (round ${round + 1})`);
      await sleep(1500); // back off before the next retry round
    }
  }
  if (failedPages.length > 0) {
    console.error(`[embed-cards] FATAL: ${failedPages.length} catalog page(s) still failing after retries — re-run to resume (idempotent)`);
    process.exit(1);
  }

  const out = [];
  for (const pageCards of pageData.values()) {
    for (const c of pageCards) {
      const imageUrl = c.images?.large || c.images?.small || null;
      if (!imageUrl) continue;
      out.push({
        id: c.id,
        set_id: c.set?.id ?? "",
        number: c.number ?? "",
        name: c.name ?? "",
        image_url: imageUrl,
      });
    }
  }
  // Deterministic ordering: for a smoke run the same cards must be targeted every time.
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// ── CLIP embedding ─────────────────────────────────────────────────────────
let processorPromise, modelPromise;
function getModels() {
  processorPromise ??= AutoProcessor.from_pretrained(MODEL);
  modelPromise ??= CLIPVisionModelWithProjection.from_pretrained(MODEL);
  return Promise.all([processorPromise, modelPromise]);
}

// Download image bytes (with retry) then compute a 512-dim embedding.
async function embedImage(imageUrl) {
  const res = await fetchWithRetry(imageUrl);
  const buf = await res.arrayBuffer();
  const image = await RawImage.fromBlob(new Blob([buf]));
  const [processor, model] = await getModels();
  const { pixel_values } = await processor(image);
  const out = await model({ pixel_values });
  const emb = out.image_embeds;
  const arr = Array.from(emb.data.slice(0, DIM));
  // Store as a Postgres array literal string; pgvector casts text -> vector.
  return "[" + arr.map((x) => x.toFixed(6)).join(",") + "]";
}

// ── worker pool (bounded concurrency) ─────────────────────────────────────
async function runPool(items, worker, concurrency) {
  let i = 0;
  const results = new Array(items.length);
  async function workerLoop() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try {
        results[idx] = { ok: true, value: await worker(items[idx], idx) };
      } catch (e) {
        results[idx] = { ok: false, error: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, workerLoop));
  return results;
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  loadEnv();

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / key. Check .env.local (SUPABASE_URL + a key).");
    process.exit(2);
  }
  const supabase = createClient(url, key);

  // Parse args.
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
  if (limit <= 0) { console.error("--limit must be a positive integer"); process.exit(2); }
  const mode = Number.isFinite(limit) ? `smoke (limit=${limit})` : "full";

  console.log(`[embed-cards] ${mode} run | model=${MODEL} dim=${DIM} concurrency=${CONCURRENCY}`);
  console.log(`[embed-cards] enumerating cards from ${API_BASE} ...`);
  await getModels(); // load CLIP once up front (weight download on first run)
  console.log(`[embed-cards] CLIP model loaded`);

  // Existing ids for resume.
  const { data: existingRows, error: existingErr } = await supabase
    .from("card_embeddings")
    .select("card_id");
  if (existingErr) { console.error("Failed to read existing embeddings:", existingErr.message); process.exit(1); }
  const existingIds = new Set(existingRows.map((r) => r.card_id));
  console.log(`[embed-cards] ${existingIds.size} card(s) already in DB — skipping those`);

  const cards = await enumerateAllCards();
  // Apply the limit to the deterministic (id-sorted) catalog, THEN drop already-present
  // ids. A smoke `--limit=N` therefore always targets the same N cards, and re-running it
  // is a no-op once they're embedded (idempotent). The full run embeds every new card.
  const targets = Number.isFinite(limit) ? cards.slice(0, limit) : cards;
  const toEmbed = targets.filter((c) => !existingIds.has(c.id));
  console.log(`[embed-cards] ${cards.length} cards in catalog, ${targets.length} targeted, ${toEmbed.length} new to embed`);
  if (toEmbed.length === 0) { console.log("[embed-cards] nothing to do — table is up to date"); return; }

  // Download + embed.
  let done = 0;
  const results = await runPool(
    toEmbed,
    async (card, idx) => {
      try {
        const embedding = await embedImage(card.image_url);
        done++;
        if (done % LOG_EVERY === 0 || done === toEmbed.length) {
          console.log(`[embed-cards] progress ${done}/${toEmbed.length} (${card.id})`);
        }
        return { card, embedding };
      } catch (e) {
        done++;
        console.warn(`[embed-cards] FAILED ${card.id} (${card.image_url}): ${e?.message ?? e}`);
        return null;
      }
    },
    CONCURRENCY
  );

  const rows = results
    .map((r) => r.ok ? r.value : null)
    .filter(Boolean)
    .map(({ card, embedding }) => ({
      card_id: card.id,
      set_id: card.set_id,
      number: card.number,
      name: card.name,
      image_url: card.image_url,
      embedding,
      updated_at: new Date().toISOString(),
    }));

  const failed = results.filter((r) => !r.ok || !r.value).length;
  console.log(`[embed-cards] ${rows.length} embedded, ${failed} failed`);

  // Upsert in batches (idempotent via ON CONFLICT).
  for (let i = 0; i < rows.length; i += FLUSH_BATCH) {
    const batch = rows.slice(i, i + FLUSH_BATCH);
    const { error } = await supabase
      .from("card_embeddings")
      .upsert(batch, { onConflict: "card_id" });
    if (error) {
      console.error(`[embed-cards] upsert batch ${i / FLUSH_BATCH} failed: ${error.message}`);
      process.exit(1);
    }
    console.log(`[embed-cards] upserted ${Math.min(i + FLUSH_BATCH, rows.length)}/${rows.length}`);
  }

  console.log(`[embed-cards] done. ${rows.length} rows upserted, ${failed} failed, ${toEmbed.length - rows.length - failed} skipped.`);
}

main().catch((e) => {
  console.error("[embed-cards] fatal:", e);
  process.exit(1);
});
