// T25.2 verification: confirm the q8 backfill wrote correct embeddings and that
// match_card_embeddings self-matches svp-44.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLIPVisionModelWithProjection, AutoProcessor, env, RawImage } from "@huggingface/transformers";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      const text = readFileSync(f, "utf8");
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
      }
    } catch {}
  }
}
loadEnv();

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key);

// 1. Row count
const { count, error: countErr } = await sb
  .from("card_embeddings")
  .select("*", { count: "exact", head: true });
console.log("TOTAL ROWS:", count, countErr ? `ERROR ${countErr.message}` : "");
if (countErr) process.exit(1);

// 2. Presence of svp-44 and det1-4
for (const id of ["svp-44", "det1-4"]) {
  const { data, error } = await sb
    .from("card_embeddings")
    .select("card_id,set_id,number,name,image_url")
    .eq("card_id", id);
  if (error) { console.log(`${id}: ERROR ${error.message}`); continue; }
  if (data.length === 0) { console.log(`${id}: MISSING`); continue; }
  console.log(`${id}: PRESENT name=${data[0].name} set=${data[0].set_id} num=${data[0].number}`);
}

// 3. Self-match: embed svp-44 with q8 model, call RPC
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.useFSCache = true;
env.cacheDir = join(process.cwd(), "src/lib/hunter/models");
const [proc, model] = await Promise.all([
  AutoProcessor.from_pretrained("Xenova/clip-vit-base-patch32", { local_files_only: true }),
  CLIPVisionModelWithProjection.from_pretrained("Xenova/clip-vit-base-patch32", { dtype: "q8", local_files_only: true }),
]);
const img = await RawImage.fromBlob(new Blob([readFileSync("fixtures/svp44.jpg")]));
const { pixel_values } = await proc(img);
const out = await model({ pixel_values });
const emb = out.image_embeds.data.slice(0, 512);
const vecLit = "[" + Array.from(emb).map((x) => x.toFixed(6)).join(",") + "]";

const { data: match, error: matchErr } = await sb.rpc("match_card_embeddings", {
  query_embedding: vecLit,
  match_count: 5,
});
if (matchErr) { console.log("RPC ERROR:", matchErr.message); process.exit(1); }
console.log("\nTOP-5 self-match results for svp-44:");
let svpRank = null;
for (let i = 0; i < match.length; i++) {
  const r = match[i];
  if (r.card_id === "svp-44") svpRank = i + 1;
  console.log(`  #${i + 1} ${r.card_id} name=${r.name} sim=${r.similarity.toFixed(4)}`);
}
console.log("\nsvp-44 rank:", svpRank);
if (svpRank !== 1) { console.log("FAIL: svp-44 did not rank #1"); process.exit(1); }
console.log("PASS: svp-44 self-matches at rank #1, sim=", match[0].similarity.toFixed(4));
