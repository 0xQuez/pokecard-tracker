/**
 * identify-pipeline.ts — Composes the T22.3 vision extractor with the T22.4
 * pokemontcg.io matcher into the POST /api/hunter/identify pipeline (T22.5).
 *
 * Pure / headless: no JSX, no route plumbing, and every external dependency
 * (vision call, tcg HTTP, sleep) is injectable — so the whole flow is
 * unit-testable offline under `node --test` and runs in the browser-equivalent
 * server runtime (plain erasable TypeScript, no TS enums).
 *
 * Pipeline
 * --------
 *   1. Vision extraction (T22.3): imageUrl -> CardIdentity | {error:"unreadable"}.
 *   2. TCG matching (T22.4): identity -> ranked CandidateCard[] (score 0..1).
 *   3. Stamp/variant tiebreaker: pokemontcg.io does NOT split svp-44 into
 *      regular vs Pokemon-Center-Exclusive, so we keep it as ONE candidate and
 *      attach `variantHints` for the confirmation UI to present. A Pokemon
 *      Center / 1st Edition / shadowless / variant signal on the card re-ranks
 *      candidates whose pricing/variant data align (via variantHints).
 *   4. needsConfirmation decision: top-2 gap < 0.15 OR a stamp/variant conflict.
 *
 * The pipeline returns a discriminated outcome; the route maps it to HTTP
 * status codes (400 unreadable, 404 no match, 502 tcg down, 503 vision unset).
 */

import {
  extractCardIdentity,
  VisionNotConfigured,
  type CardIdentity,
  type VisionFn,
  type CardIdentityResult,
} from "./vision-identify.ts";
import {
  matchCard,
  httpGetJson,
  HttpError,
  type CandidateCard,
  type MatchOptions,
} from "./tcg-match.ts";
import {
  embedQueryImage,
  nearestCards,
  type EmbeddingCandidate,
  type RpcClient,
} from "./embedding-lookup.ts";

// ── Response contract (T22.5 documented shape) ──────────────────────────────

/** One candidate in the identify response. */
export interface IdentifyCandidate {
  /** pokemontcg.io card id, e.g. "svp-44". */
  id: string;
  /** Canonical card name, e.g. "Charmander". */
  name: string;
  /** Set id + name, e.g. { id: "svp", name: "Scarlet & Violet Black Star Promos" }. */
  set: { id: string; name: string; series?: string };
  /** Collector number as printed, e.g. "44". */
  number: string;
  /** Card artwork URLs from pokemontcg.io. */
  imageSmall?: string;
  imageLarge?: string;
  /** 0..1 composite match score against the extracted identity. */
  score: number;
  /**
   * Physical-print options the card can be (e.g. ["regular",
   * "Pokemon Center Exclusive"]). The catalog keeps svp-44 as one record; the
   * confirmation UI renders these so the user can pick the actual print.
   */
  variantHints: string[];
}

/** The `extracted` field of the response — what the vision model read. */
export type ExtractedIdentity = CardIdentity;

export interface IdentifyOk {
  status: "ok";
  candidates: IdentifyCandidate[];
  needsConfirmation: boolean;
  extracted: ExtractedIdentity;
}

export interface IdentifyUnreadable {
  status: "unreadable";
  code: "UNREADABLE_IMAGE";
}

export interface IdentifyNoMatch {
  status: "no-match";
  code: "NO_MATCH";
  extracted: ExtractedIdentity;
}

export interface IdentifyTcgDown {
  status: "tcg-down";
  code: "TCG_API_UNAVAILABLE";
  message: string;
}

export interface IdentifyVisionDown {
  status: "vision-down";
  code: "VISION_NOT_CONFIGURED";
  message: string;
}

export type IdentifyOutcome =
  | IdentifyOk
  | IdentifyUnreadable
  | IdentifyNoMatch
  | IdentifyTcgDown
  | IdentifyVisionDown;

// ── Thresholds ───────────────────────────────────────────────────────────────

/** Top-2 score gap under which the UI must ask the user to confirm. */
export const CONFIRMATION_GAP = 0.15;
/** Max candidates returned when ambiguous. */
export const AMBIGUOUS_CANDIDATE_LIMIT = 3;
/** Candidates returned when clearly unambiguous. */
export const CLEAR_CANDIDATE_LIMIT = 1;
/** Max embedding-similarity candidates the pipeline returns (T23.2). */
export const EMBEDDING_CANDIDATE_LIMIT = 20;

// ── Injectable deps ─────────────────────────────────────────────────────────

export interface EmbeddingLookupDeps {
  /**
   * PostgREST client for the `match_card_embeddings` RPC. Omit (or the table
   * being empty/unavailable) and the pipeline silently falls back to the text
   * matcher — an embedding outage never blocks a scan.
   */
  client?: RpcClient;
  /**
   * Embed the query photo. Defaults to the real `embedQueryImage` (runs the
   * CLIP model server-side). Injectable so tests avoid the ONNX runtime.
   */
  embed?: (source: string | ArrayBuffer | Uint8Array) => Promise<Float32Array>;
  /**
   * Nearest-neighbor query. Defaults to the real `nearestCards`. Injectable so
   * tests can stub the RPC without a live table.
   */
  nearest?: (
    embedding: ArrayLike<number>,
    opts: { client?: RpcClient; k?: number },
  ) => Promise<EmbeddingCandidate[]>;
  /** set_id -> set name resolver, forwarded to the RPC mapping. */
  resolveSetName?: (setId: string) => Promise<string>;
  /** How many embedding candidates to request. Defaults to 20. */
  k?: number;
}

export interface IdentifyDeps {
  /** Vision call. Defaults to the configured defaultVisionFn. */
  visionFn?: VisionFn;
  /** Options forwarded to the T22.4 matcher (fetchFn/sleep/retries…). */
  matchOptions?: MatchOptions;
  /**
   * T23.2 artwork-embedding path. When supplied and the table is populated it
   * becomes the PRIMARY candidate source (up to `k` similarity-ranked cards);
   * the text matcher is used only as a fallback when the table is
   * empty/unavailable. When omitted, behavior is unchanged (text-only).
   */
  embedding?: EmbeddingLookupDeps;
}

// ── Stamp / variant tiebreaker ───────────────────────────────────────────────

/**
 * Normalize a vision-extracted stamp string to a known collector category.
 * Returns null when the stamp carries no pricing-relevant signal.
 */
export function stampCategory(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  const s = stamp.toLowerCase().replace(/[\s_-]+/g, " ");
  if (s.includes("pokemon center") || s.includes("pokemon center exclusive")) {
    return "pokemon-center";
  }
  if (s.includes("1st edition")) return "1st-edition";
  if (s.includes("shadowless")) return "shadowless";
  if (s.includes("professor")) return "professor";
  if (s.includes("staff")) return "staff";
  return null;
}

/**
 * Which print options a card can physically be, given a detected stamp and the
 * vision model's variant reading. The catalog (pokemontcg.io) does not split
 * these — the hint list is what the confirmation UI renders.
 */
export function buildVariantHints(
  identity: Pick<CardIdentity, "variant" | "print" | "stamp">,
): string[] {
  const hints: string[] = [];
  const cat = stampCategory(identity.stamp);
  if (cat === "pokemon-center") {
    hints.push("regular", "Pokemon Center Exclusive");
  } else if (cat === "1st-edition") {
    hints.push("1st Edition");
    if (identity.print !== "1st_edition") hints.push("Unlimited");
  } else if (cat === "shadowless") {
    hints.push("Shadowless", "1st Edition");
  } else {
    // No pricing-relevant stamp — fall back to the plain variant reading.
    const variant =
      identity.variant === "holo"
        ? "Holo"
        : identity.variant === "reverse_holo"
          ? "Reverse Holo"
          : identity.variant === "regular"
            ? "Regular"
            : null;
    if (variant) hints.push(variant);
  }
  return hints;
}

/** True when the extracted stamp/variant signals a real print-conflict. */
export function hasStampConflict(identity: Pick<CardIdentity, "stamp">): boolean {
  return stampCategory(identity.stamp) !== null;
}

// ── Candidate assembly ───────────────────────────────────────────────────────

function toCandidate(card: CandidateCard, identity: CardIdentity): IdentifyCandidate {
  return {
    id: card.id,
    name: card.name,
    set: card.set,
    number: card.number,
    imageSmall: card.imageSmall,
    imageLarge: card.imageLarge,
    score: card.score,
    variantHints: buildVariantHints(identity),
  };
}

/**
 * Convert an embedding-similarity candidate (T23.2 shape) into the pipeline's
 * IdentifyCandidate contract so the route/UI keep a single candidate shape. The
 * similarity score maps directly to `score`; artwork and set come from the
 * stored row. variantHints are derived from the vision identity exactly as the
 * text path does (T23.3 needs this for stamp/variant tiebreak).
 */
export function embeddingToCandidate(
  ec: EmbeddingCandidate,
  identity: CardIdentity,
): IdentifyCandidate {
  return {
    id: ec.cardId,
    name: ec.name,
    set: ec.setId || ec.setName
      ? { id: ec.setId, name: ec.setName }
      : { id: "", name: "" },
    number: ec.number,
    imageSmall: ec.imageUrl,
    imageLarge: ec.imageUrl,
    score: ec.similarity,
    variantHints: buildVariantHints(identity),
  };
}

/**
 * Run the artwork-embedding lookup (T23.2): embed the photo, query pgvector
 * for nearest neighbors, and return up to `k` candidates ranked by similarity.
 *
 * Never throws: any failure (no client, model/image error, RPC error, empty
 * table) returns [] so the pipeline can fall back to text matching. This keeps
 * a scan alive when the embedding table isn't populated yet.
 */
export async function runEmbeddingLookup(
  imageUrl: string,
  deps: EmbeddingLookupDeps,
  identity: CardIdentity,
): Promise<IdentifyCandidate[]> {
  const k = deps.k ?? EMBEDDING_CANDIDATE_LIMIT;
  if (!deps.client) return [];
  const embedFn = deps.embed ?? embedQueryImage;
  const nearestFn = deps.nearest ?? nearestCards;
  try {
    const embedding = await embedFn(imageUrl);
    const neighbors = await nearestFn(embedding, { client: deps.client, k });
    return neighbors
      .map((ec) => embeddingToCandidate(ec, identity))
      .slice(0, k);
  } catch (e) {
    console.warn(
      `[identify-pipeline] embedding lookup failed; falling back to text match: ${(e as Error)?.message}`,
    );
    return [];
  }
}

/**
 * Re-rank candidates using the stamp/variant tiebreaker. When the vision model
 * read a Pokemon Center stamp, the *same* catalog card (svp-44) represents a
 * far more valuable physical product — surface it first (already top-scored)
 * and make sure its variantHints advertise the PC-exclusive print. No catalog
 * card is split; we only enrich the existing record.
 */
export function applyStampTiebreak(
  cards: CandidateCard[],
  identity: CardIdentity,
): IdentifyCandidate[] {
  const cat = stampCategory(identity.stamp);
  const candidates = cards.map((c) => toCandidate(c, identity));

  if (cat === "pokemon-center" && candidates.length > 0) {
    // The PC-exclusive is a different product but the same catalog id — the
    // user must choose, so ensure the top record carries the hint prominently.
    candidates[0] = {
      ...candidates[0],
      variantHints: ["regular", "Pokemon Center Exclusive"],
      // Modest tie-breaking bump so it ranks above any near-tie regular match.
      score: Math.min(1, candidates[0].score + 0.08),
    };
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// ── Confirmation decision ────────────────────────────────────────────────────

/**
 * needsConfirmation = true when the top-2 scores are close (< 0.15) OR when the
 * vision model read a pricing-relevant stamp/variant conflict (regular vs
 * Pokemon Center Exclusive / 1st Edition / shadowless).
 */
export function decideNeedsConfirmation(
  candidates: IdentifyCandidate[],
  identity: CardIdentity,
): boolean {
  if (candidates.length === 0) return true;
  if (hasStampConflict(identity)) return true;
  if (candidates.length >= 2) {
    const gap = candidates[0].score - candidates[1].score;
    if (gap < CONFIRMATION_GAP) return true;
  }
  return false;
}

/**
 * Pick how many candidates to return: 2–3 when ambiguous, exactly 1 when the
 * top match is clearly unambiguous.
 */
export function trimCandidates(
  candidates: IdentifyCandidate[],
  needsConfirmation: boolean,
): IdentifyCandidate[] {
  if (!needsConfirmation) return candidates.slice(0, CLEAR_CANDIDATE_LIMIT);
  return candidates.slice(0, AMBIGUOUS_CANDIDATE_LIMIT);
}

// ── TCG health probe ──────────────────────────────────────────────────────────

/**
 * Adapt a T22.3 vision CardIdentity to the T22.4 matcher's CardIdentity shape
 * (the matcher's optional fields don't accept explicit `null`).
 */
function toMatcherIdentity(
  identity: CardIdentity,
): import("./tcg-match.ts").CardIdentity {
  return {
    name: identity.name,
    setName: identity.setName || undefined,
    setCode: identity.setCode || undefined,
    collectorNumber: identity.collectorNumber || undefined,
  };
}

/**
 * Lightweight reachability probe against pokemontcg.io. Returns true when the
 * API is unreachable (network/5xx/429). Used only when the matcher returns no
 * candidates, to tell "no such card" apart from "API is down".
 */
export async function tcgProbeUnhealthy(
  matchOptions: MatchOptions = {},
): Promise<boolean> {
  const url =
    "https://api.pokemontcg.io/v2/cards?q=name:charmander&pageSize=1&select=id";
  try {
    await httpGetJson(url, { ...matchOptions, retries: 1, baseDelayMs: 100 });
    return false; // reached and answered -> API is up, so it's a genuine no-match
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    if (status >= 500 || status === 429 || status === 0) return true;
    // A 4xx (other than 429) on a well-formed query means it answered — up.
    return false;
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Run the full identify pipeline: imageUrl -> vision -> (embedding lookup
 * PRIMARY | tcg text match fallback) -> tiebreak.
 *
 * T23.2 change: when `deps.embedding` is supplied and the card_embeddings table
 * is populated, the artwork-embedding path is the primary candidate source and
 * returns up to EMBEDDING_CANDIDATE_LIMIT (20) similarity-ranked candidates.
 * Vision extraction ALWAYS runs first (T23.3 needs the extracted identity for
 * variant/stamp tiebreak). The pokemontcg.io text matcher is used only as a
 * fallback when the embedding table is empty/unavailable (or no embedding deps
 * are supplied — the pre-T23.2 behavior).
 *
 * Never throws for expected conditions; returns a discriminated IdentifyOutcome
 * the route maps to HTTP status codes.
 */
export async function runIdentifyPipeline(
  imageUrl: string,
  deps: IdentifyDeps = {},
): Promise<IdentifyOutcome> {
  // 1. Vision extraction (always — T23.3 needs the identity for tiebreak).
  let identity: CardIdentityResult;
  try {
    identity = await extractCardIdentity(imageUrl, deps.visionFn);
  } catch (e) {
    if (e instanceof VisionNotConfigured) {
      return { status: "vision-down", code: "VISION_NOT_CONFIGURED", message: e.message };
    }
    throw e; // unexpected vision transport error — let the route handle it
  }
  if ("error" in identity) {
    return { status: "unreadable", code: "UNREADABLE_IMAGE" };
  }

  // 2. Embedding lookup — primary when the table is populated.
  if (deps.embedding) {
    const embeddingCandidates = await runEmbeddingLookup(
      imageUrl,
      deps.embedding,
      identity,
    );
    if (embeddingCandidates.length > 0) {
      const candidates = applyStampTiebreak(embeddingCandidates, identity);
      const needsConfirmation = decideNeedsConfirmation(candidates, identity);
      return {
        status: "ok",
        // T23.2 keeps the full ranked list (up to 20) for T23.4's UI + T23.3's
        // hybrid tiebreak to consume; no 1/3 trimming on the embedding path.
        candidates: candidates.slice(0, EMBEDDING_CANDIDATE_LIMIT),
        needsConfirmation,
        extracted: identity,
      };
    }
    // Empty/unavailable table → fall through to the text matcher.
  }

  // 3. TCG text matching (fallback).
  let cards: CandidateCard[];
  try {
    cards = await matchCard(toMatcherIdentity(identity), deps.matchOptions);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    // 5xx/429 exhausted retries or network-unknown -> treat as tcg down.
    if (status >= 500 || status === 429 || status === 0) {
      const message =
        e instanceof Error
          ? `pokemontcg.io unavailable: ${e.message}`
          : "pokemontcg.io unavailable";
      return { status: "tcg-down", code: "TCG_API_UNAVAILABLE", message };
    }
    throw e; // 4xx other than 429 — unexpected, let route 500 it
  }

  // 4. No match at all. Distinguish "tcg healthy, genuinely no record" from
  //    "tcg down" — matchCard swallows per-query errors, so probe the API.
  if (cards.length === 0) {
    const down = await tcgProbeUnhealthy(deps.matchOptions);
    if (down) {
      return {
        status: "tcg-down",
        code: "TCG_API_UNAVAILABLE",
        message: "pokemontcg.io unavailable",
      };
    }
    return { status: "no-match", code: "NO_MATCH", extracted: identity };
  }

  // 5. Stamp/variant tiebreaker + confirmation decision + trimming.
  const candidates = applyStampTiebreak(cards, identity);
  const needsConfirmation = decideNeedsConfirmation(candidates, identity);
  return {
    status: "ok",
    candidates: trimCandidates(candidates, needsConfirmation),
    needsConfirmation,
    extracted: identity,
  };
}
