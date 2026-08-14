/**
 * embedding-lookup.ts — Scan-time artwork embedding lookup (T23.2).
 *
 * The primary candidate source for the camera scan flow. Given the user's card
 * photo it (1) computes a CLIP image embedding with the SAME model the T23.1
 * backfill used, and (2) asks Supabase pgvector for the top-k nearest catalog
 * cards by cosine distance.
 *
 * MODEL CONSISTENCY IS THE WHOLE GAME
 * -----------------------------------
 * This module MUST use exactly the model the backfill wrote the table with:
 *   Xenova/clip-vit-base-patch32  (CLIPVisionModelWithProjection)
 *   dimension 512, L2-normalized image embedding
 * Embeddings from different models are incomparable — swapping models at scan
 * time silently breaks recall. See supabase/migrations/005_card_embeddings.sql
 * and scripts/embed-cards.mjs for the source of truth. If either changes, this
 * module and migration 006's vector(512) type must change together.
 *
 * PREPROCESSING
 * -------------
 * We run the photo through the model's own AutoProcessor (same call the backfill
 * used: `processor(image)`). For clip-vit-base-patch32 that is: decode -> resize
 * to 224x224 keeping aspect -> center-crop to 224 -> normalize with the model's
 * mean/std. Because the stored embeddings were produced with the exact same
 * processor, query and stored vectors live in the same feature space — that is
 * what makes cosine similarity meaningful.
 *
 * Deliberately NO corner-detection / edge-warping here: worn and angled photos
 * are a target use case, and over-cropping to the card edges would throw away
 * exactly the pixels that survive a rough scan. The processor's center-crop is
 * gentle and preserves the full card. (A future task may add perspective
 * correction; it is explicitly out of scope for T23.2.)
 *
 * RUNTIME / CACHING
 * -----------------
 * This runs server-side in the Next.js API route (nodejs runtime). The model +
 * processor are loaded once per process and cached in a module-level promise,
 * so warm invocations reuse the loaded model. @huggingface/transformers bundles
 * native deps (onnxruntime-node, sharp); next.config.ts lists it in
 * `serverExternalPackages` so it is NOT webpack-bundled and resolves from
 * node_modules at runtime. The pure candidate-mapping and RPC logic is fully
 * unit-testable offline — only `embedQueryImage` touches the model.
 */

// ── Model constants (must stay in sync with the backfill) ──────────────────
export const EMBEDDING_MODEL = "Xenova/clip-vit-base-patch32";
/** Onnx dtype for the vision model. `q8` selects the `_quantized` ONNX file,
 *  the int8 variant we vendor into the repo so Vercel ships it with the
 *  deploy instead of downloading 335MB fp32 at cold start (T25.1). The
 *  backfill (T25.2) MUST use the same model + dtype + cache dir so query and
 *  stored vectors stay in the same feature space. */
export const EMBEDDING_DTYPE = "q8";
export const EMBEDDING_DIM = 512;
/**
 * Repo-local transformers.js cache. We point transformers.js here so the
 * quantized weights ship with the deployment (committed to git) instead of
 * living in node_modules/.cache (which Vercel wipes on reinstall) or being
 * downloaded from the HF Hub at cold start. The layout mirrors the HF cache
 * key scheme: <cacheDir>/Xenova/clip-vit-base-patch32/<subfolder>/<file>.
 */
export const EMBEDDING_CACHE_DIR = "src/lib/hunter/models";
/** PostgREST function created by supabase/migrations/006_match_card_embeddings.sql */
export const MATCH_RPC = "match_card_embeddings";

// ── Public output shape (T23.2 deliverable 4) ──────────────────────────────

/** One nearest-neighbor candidate, camelCased for the pipeline/UI. */
export interface EmbeddingCandidate {
  /** pokemontcg.io card id, e.g. "svp-44". */
  cardId: string;
  /** Canonical card name, e.g. "Charmander". */
  name: string;
  /** Set code, e.g. "svp". */
  setId: string;
  /** Set name, e.g. "Scarlet & Violet Black Star Promos". */
  setName: string;
  /** Collector number, e.g. "44". */
  number: string;
  /** Canonical art URL the embedding was computed from. */
  imageUrl: string;
  /** Cosine similarity to the query photo, normalized to 0..1. */
  similarity: number;
}

// ── Warm model cache ────────────────────────────────────────────────────────

type ClipModel = {
  processor: { (image: unknown): Promise<{ pixel_values: unknown }> };
  model: { (inputs: { pixel_values: unknown }): Promise<{ image_embeds: { data: Float32Array } }> };
};

let clipPromise: Promise<ClipModel> | null = null;

/**
 * Load (once per process) and return the CLIP model + processor. Cached in a
 * module-level promise so repeated scan requests reuse the warm model instead of
 * re-downloading/re-initializing it — this is the "keep model warm between
 * invocations where Next.js allows" requirement. Cold starts re-pay the load.
 */
async function getClip(): Promise<ClipModel> {
  clipPromise ??= (async () => {
    // Dynamic import so offline unit tests of nearestCards never pull in the
    // ONNX runtime / sharp native deps. next.config.ts also marks the package
    // as serverExternal so the build doesn't webpack-bundle them.
    const [{ CLIPVisionModelWithProjection, AutoProcessor, env }, { default: path }] =
      await Promise.all([
        import("@huggingface/transformers"),
        // Resolve the vendored model dir against the serverless function root
        // (process.cwd()). In production on Vercel, outputFileTracingIncludes
        // (next.config.ts) ships src/lib/hunter/models/ inside the function
        // bundle and process.cwd() points at that root, so this finds the
        // quantized weights with no HF Hub download.
        import("node:path"),
      ]);

    // Point transformers.js at the repo-local cache and forbid remote fetches:
    // the vendored quantized model is committed to git, so cold starts load it
    // straight off disk. allowRemoteModels=false turns a missing/truncated file
    // into a loud error instead of a silent 335MB download at scan time.
    env.allowRemoteModels = false;
    env.useBrowserCache = false;
    env.useFSCache = true;
    env.cacheDir = path.join(process.cwd(), EMBEDDING_CACHE_DIR);

    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(EMBEDDING_MODEL, { local_files_only: true }),
      CLIPVisionModelWithProjection.from_pretrained(EMBEDDING_MODEL, {
        dtype: EMBEDDING_DTYPE,
        local_files_only: true,
      }),
    ]);
    return { processor, model };
  })();
  return clipPromise;
}

/** Load bytes -> RawImage via the same path the backfill used. */
async function decodeImage(buffer: ArrayBuffer): Promise<unknown> {
  const { RawImage } = await import("@huggingface/transformers");
  return RawImage.fromBlob(new Blob([buffer]));
}

// ── Embedding ───────────────────────────────────────────────────────────────

/**
 * Serialize a numeric embedding to the pgvector literal string form the backfill
 * stores ("[0.1,0.2,...]"), so a query vector matches the stored representation.
 */
export function toVectorLiteral(embedding: ArrayLike<number>): string {
  return "[" + Array.from(embedding).map((x) => x.toFixed(6)).join(",") + "]";
}

/**
 * Compute a 512-dim CLIP image embedding from raw image bytes. This is the exact
 * model+processor pipeline the backfill used, so the result is comparable to
 * every stored row.
 */
export async function embedImageBytes(
  buffer: ArrayBuffer,
  dim: number = EMBEDDING_DIM,
): Promise<Float32Array> {
  const image = await decodeImage(buffer);
  const { processor, model } = await getClip();
  const { pixel_values } = await processor(image);
  const out = await model({ pixel_values });
  return out.image_embeds.data.slice(0, dim);
}

/**
 * Fetch an image URL and embed it. Accepts either a full http(s) URL or raw
 * bytes, so callers can pass a Supabase public URL or a local buffer.
 */
export async function embedQueryImage(
  source: string | ArrayBuffer | Uint8Array,
): Promise<Float32Array> {
  let buffer: ArrayBuffer;
  if (typeof source === "string") {
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`embedQueryImage: failed to fetch ${source}: HTTP ${res.status}`);
    }
    buffer = await res.arrayBuffer();
  } else if (source instanceof Uint8Array) {
    // Copy the view's bytes into a standalone ArrayBuffer (slices of a
    // SharedArrayBuffer/offset view would otherwise break the ArrayBuffer type).
    const out = new ArrayBuffer(source.byteLength);
    new Uint8Array(out).set(source);
    buffer = out;
  } else {
    buffer = source;
  }
  return embedImageBytes(buffer);
}

// ── Nearest-neighbor search ─────────────────────────────────────────────────

/** Minimal Supabase `.rpc()` client shape (keeps tests offline). */
export interface RpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
}

export interface NearestOptions {
  /** Injectable PostgREST client. Required in the route; tests pass a fake. */
  client: RpcClient;
  /** RPC function name; defaults to migration 006's function. */
  rpcName?: string;
  /** How many neighbors to return. */
  k?: number;
  /**
   * Resolve a set_id -> human set name. Defaults to a cached pokemontcg.io
   * `/sets` lookup (the card_embeddings table stores only set_id). Injectable
   * so tests stay offline. Falls back to the set_id itself when lookup fails.
   */
  resolveSetName?: (setId: string) => Promise<string>;
}

/** Raw row shape the RPC returns (snake_case from PostgREST). */
interface RawNeighbor {
  card_id?: string;
  set_id?: string | null;
  number?: string | null;
  name?: string | null;
  image_url?: string | null;
  similarity?: number | null;
}

/** Normalize similarity to 0..1 and coerce to a number. */
export function normalizeSimilarity(v: number | null | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}

// ── set_id -> set name enrichment ───────────────────────────────────────────
// card_embeddings stores set_id only (T23.1 schema). The candidate shape wants
// a human set name, so we resolve it from pokemontcg.io's small /sets catalog
// and cache the map in-process. This is a read of ~hundreds of set rows, done
// once per process; a scan shouldn't pay it repeatedly.

let setsPromise: Promise<Map<string, string>> | null = null;

async function fetchSetsMap(): Promise<Map<string, string>> {
  const res = await fetch("https://api.pokemontcg.io/v2/sets?pageSize=250");
  if (!res.ok) throw new Error(`sets lookup failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { id?: string; name?: string }[] };
  const map = new Map<string, string>();
  for (const s of body.data ?? []) {
    if (s.id && s.name) map.set(s.id, s.name);
  }
  return map;
}

/** Default resolver: cached pokemontcg.io set-name lookup. */
export async function resolveSetNameDefault(setId: string): Promise<string> {
  if (!setId) return "";
  try {
    setsPromise ??= fetchSetsMap();
    const map = await setsPromise;
    return map.get(setId) ?? setId;
  } catch (e) {
    console.warn(`[embedding-lookup] set-name lookup failed for ${setId}: ${(e as Error)?.message}`);
    return setId; // degrade gracefully — never throw the scan
  }
}

/** Map a raw RPC row to the public EmbeddingCandidate shape (set name async). */
export async function toEmbeddingCandidate(
  row: RawNeighbor,
  resolveSetName: (setId: string) => Promise<string> = resolveSetNameDefault,
): Promise<EmbeddingCandidate> {
  return {
    cardId: row.card_id ?? "",
    name: row.name ?? "",
    setId: row.set_id ?? "",
    setName: await resolveSetName(row.set_id ?? ""),
    number: row.number ?? "",
    imageUrl: row.image_url ?? "",
    similarity: normalizeSimilarity(row.similarity),
  };
}

/**
 * Query pgvector for the top-k nearest cards by cosine distance. Uses the RPC
 * function from migration 006 (served by the HNSW index). Returns up to `k`
 * candidates ranked best-first with a 0..1 similarity.
 *
 * Returns [] on any RPC error (function missing, table empty, network) so the
 * pipeline can fall back to the text matcher — an embedding outage must never
 * take down a scan.
 */
export async function nearestCards(
  embedding: ArrayLike<number>,
  opts: NearestOptions,
): Promise<EmbeddingCandidate[]> {
  const { client, rpcName = MATCH_RPC, k = 20 } = opts;
  if (!client || typeof client.rpc !== "function") {
    throw new Error("nearestCards: no Supabase RPC client provided");
  }
  const { data, error } = await client.rpc(rpcName, {
    query_embedding: toVectorLiteral(embedding),
    match_count: Math.max(1, Math.floor(k)),
  });
  if (error) {
    console.warn(`[embedding-lookup] RPC ${rpcName} failed: ${error.message}`);
    return [];
  }
  const rows = Array.isArray(data) ? (data as RawNeighbor[]) : [];
  const resolveSetName = opts.resolveSetName ?? resolveSetNameDefault;
  const candidates = await Promise.all(
    rows.map((row) => toEmbeddingCandidate(row, resolveSetName)),
  );
  return candidates
    .filter((c) => c.cardId)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}
