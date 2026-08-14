/**
 * T25.1 verification: load the vendored quantized CLIP model fully locally.
 * Run: node scripts/verify-vendored-model.mjs
 * It sets the same env config as embedding-lookup.ts (allowRemoteModels=false,
 * cacheDir=src/lib/hunter/models) and asserts the quantized ONNX is used and
 * no remote fetch happens.
 */
import path from "node:path";
import fs from "node:fs";

process.env.TRANSFORMERS_OFFLINE = "1"; // belt + suspenders

const { env } = await import("@huggingface/transformers");

const ROOT = path.resolve(process.cwd());
const cacheDir = path.join(ROOT, "src/lib/hunter/models");

// Mirror embedding-lookup.ts config
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.useFSCache = true;
env.cacheDir = cacheDir;

// Confirm the quantized file exists on disk
const quantized = path.join(
  cacheDir,
  "Xenova/clip-vit-base-patch32/onnx/vision_model_quantized.onnx",
);
if (!fs.existsSync(quantized)) {
  throw new Error(`Vendored quantized model missing at ${quantized}`);
}
const sizeMB = (fs.statSync(quantized).size / 1e6).toFixed(1);
console.log(`[ok] vendored quantized ONNX present (${sizeMB}MB): ${quantized}`);

const { CLIPVisionModelWithProjection, AutoProcessor } = await import(
  "@huggingface/transformers"
);

console.log("[..] loading processor + quantized model (local only)...");
const [processor, model] = await Promise.all([
  AutoProcessor.from_pretrained("Xenova/clip-vit-base-patch32", {
    local_files_only: true,
  }),
  CLIPVisionModelWithProjection.from_pretrained("Xenova/clip-vit-base-patch32", {
    dtype: "q8",
    local_files_only: true,
  }),
]);
console.log("[ok] loaded locally, no HF Hub download.");

// Smoke: embed a synthetic 224x224 rgba image (all-grey noise is fine for
// exercising the model graph; we only assert shape/dim).
const { RawImage } = await import("@huggingface/transformers");
const data = new Uint8ClampedArray(224 * 224 * 4).fill(128);
const img = new RawImage(data, 224, 224, 4);
const { pixel_values } = await processor(img);
const out = await model({ pixel_values });
const emb = out.image_embeds.data;
console.log(`[ok] embed dim = ${emb.length}`);
if (emb.length !== 512) throw new Error(`expected dim 512, got ${emb.length}`);
console.log(`[ok] embedding[0..3] = ${Array.from(emb.slice(0, 4)).map((x) => x.toFixed(4))}`);
console.log("VERIFY-VENDORED-MODEL: PASS");
