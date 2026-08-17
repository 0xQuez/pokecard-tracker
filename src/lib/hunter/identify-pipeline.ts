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
 * T23.3/T26.1: on the artwork-embedding path the final ranking is done by the
 * hybrid matcher (hybrid-matcher.ts) — the vision NAME is the primary ranking
 * signal (a true veto over mismatched-name candidates), artwork similarity
 * ranks within the matching tier, the vision variant/stamp reading breaks
 * same-art ties, and `confirmationReason` carries a human explanation when
 * needsConfirmation is true. The text path below (steps 2–4) remains the
 * fallback when the embedding table is empty.
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
  fetchPriceFinishes,
  type CandidateCard,
  type MatchOptions,
} from "./tcg-match.ts";
import {
  embedQueryImage,
  nearestCards,
  type EmbeddingCandidate,
  type RpcClient,
} from "./embedding-lookup.ts";
import {
  hybridMatch,
  normalizeName,
  type HybridCandidateInput,
} from "./hybrid-matcher.ts";

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
  /**
   * T30.6: physical finish keys the catalog's tcgplayer pricing advertises for
   * this row (e.g. ["normal","reverseHolofoil"]). The text matcher carries it
   * from the API select; the embedding path gets it via identify-time pricing
   * enrichment. Signal 3 of `hasMultiplePrintVariants` reads this so a single
   * catalog row standing for several finishes forces confirmation.
   */
  priceFinishes?: string[];
}

/** The `extracted` field of the response — what the vision model read. */
export type ExtractedIdentity = CardIdentity;

export interface IdentifyOk {
  status: "ok";
  candidates: IdentifyCandidate[];
  needsConfirmation: boolean;
  /** Human reason when needsConfirmation is true (e.g. same-art variant tie). */
  confirmationReason?: string | null;
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
/**
 * Max candidates returned when ambiguous. T23.3 raises this from 3 to 20: the
 * UI (T23.4) renders the full ranked list so the user can eyeball same-art
 * variant/stamp candidates instead of being forced to a 3-way guess.
 */
export const AMBIGUOUS_CANDIDATE_LIMIT = 20;
/** Candidates returned when clearly unambiguous. */
export const CLEAR_CANDIDATE_LIMIT = 1;
/** Max embedding-similarity candidates the pipeline returns (T23.2). */
export const EMBEDDING_CANDIDATE_LIMIT = 20;
/**
 * Human reason surfaced to the UI when confirmation is forced by physical print
 * multiplicity (T30.1) — the user must pick the exact version even on a
 * confident score because the catalog row stands for several distinct prints.
 */
export const VARIANT_CONFIRM_REASON =
  "multiple print variants exist — select the exact version";

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

/**
 * T30.6: identity-time pricing enrichment source. Given candidate card ids,
 * return each id's tcgplayer finish keys (e.g. ex13-22 -> ["normal",
 * "reverseHolofoil"]). Defaults to the batched pokemontcg.io query
 * (`fetchPriceFinishes`); injectable so tests stay offline. Used ONLY on the
 * artwork-embedding path, whose RPC rows carry no pricing.
 */
export type PriceFinishesFn = (
  ids: string[],
) => Promise<Map<string, string[]>>;

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
  /**
   * T30.6: pricing-finish enrichment for the artwork-embedding path (whose RPC
   * rows carry no pricing). Defaults to the batched pokemontcg.io query. Tests
   * inject a stub so no network is needed. Only read when `embedding` is set.
   */
  fetchPriceFinishes?: PriceFinishesFn;
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

// ── T30.1 always-confirm-variant ────────────────────────────────────────────

/**
 * T30.1: true when the candidate group stands for more than one physical print
 * of the recognized card, so the UI MUST ask the user to pick the exact version
 * — never auto-select a variant, even on a confident score. Operates on the
 * same-name list (T29.1 `hardFilterByVisionName` ran before it). Signals:
 *
 *   1. The group carries >1 distinct variant hint — either a single candidate
 *      advertising several finishes (e.g. ["regular","reverse holo"]) or
 *      different candidates hinting different prints. Both mean "the user must
 *      pick".
 *   2. Two or more candidates share the same name AND collector number but
 *      different set/print metadata — the same card printed in a different
 *      run/set (a reprint across print runs).
 *   3. (T30.6, implemented) A candidate's pricing advertises more than one
 *      finish key (e.g. both `normal` and `reverseHolofoil`). This is the
 *      Latios δ "one catalog row, many finishes" case — the row is a single
 *      card in the catalog but physically exists in several finishes. The text
 *      path reads it from the API `select` (tcgplayer); the embedding path gets
 *      it via identify-time pricing enrichment.
 */
export function hasMultiplePrintVariants(
  candidates: IdentifyCandidate[],
): boolean {
  if (candidates.length === 0) return false;
  // Signal 1: distinct finish labels across the group. A single multi-finish
  // candidate (["regular","reverse holo"]) and candidates hinting different
  // prints both collapse into >1 distinct hint.
  const hintSet = new Set<string>();
  for (const c of candidates) {
    for (const h of c.variantHints ?? []) hintSet.add(h);
  }
  if (hintSet.size > 1) return true;
  // Signal 2: same name + same collector number across >1 set = a reprint.
  const keyToSets = new Map<string, Set<string>>();
  for (const c of candidates) {
    const key = `${normalizeName(c.name)}|${c.number}`;
    let sets = keyToSets.get(key);
    if (!sets) keyToSets.set(key, (sets = new Set()));
    sets.add(c.set?.id || c.set?.name || "");
    if (sets.size > 1) return true;
  }
  // Signal 3 (T30.6): a single catalog row advertising >1 physical finish via
  // its tcgplayer pricing (e.g. ex13-22 -> ["normal","reverseHolofoil"]).
  for (const c of candidates) {
    const finishes = new Set(c.priceFinishes ?? []);
    if (finishes.size > 1) return true;
  }
  return false;
}

/**
 * T30.1: enrich a same-name candidate group so each candidate's `variantHints`
 * advertises its actual print-run, not just the single vision reading shared by
 * the whole group. The catalog's per-row print discriminator available at
 * identify time is the SET: when the same card exists in multiple sets, each
 * candidate is a distinct physical print and must carry its set so the picker
 * can render them distinctly. The vision reading stays as the first hint (the
 * "suggested" print) but is never the only hint once multiple prints exist.
 * Groups spanning only one set are left untouched (single print run).
 */
export function enrichPrintVariantHints(
  candidates: IdentifyCandidate[],
): IdentifyCandidate[] {
  const byName = new Map<string, IdentifyCandidate[]>();
  for (const c of candidates) {
    const arr = byName.get(c.name);
    if (arr) arr.push(c);
    else byName.set(c.name, [c]);
  }
  const multiSetNames = new Set<string>();
  for (const group of byName.values()) {
    const sets = new Set(group.map((c) => c.set?.id || c.set?.name || ""));
    if (sets.size > 1) {
      for (const c of group) multiSetNames.add(c.name);
    }
  }
  return candidates.map((c) => {
    if (!multiSetNames.has(c.name)) return c;
    const printLabel = c.set?.name || c.set?.id || "";
    if (!printLabel || (c.variantHints ?? []).includes(printLabel)) return c;
    return { ...c, variantHints: [...(c.variantHints ?? []), printLabel] };
  });
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
    priceFinishes: card.priceFinishes,
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
 * T30.6: map a tcgplayer price-finish key to a human variant-hint label so the
 * confirmation picker can render a physical finish the catalog row advertises
 * via pricing (e.g. `reverseHolofoil` -> "Reverse Holo"). Unknown/opaque keys
 * are mapped to a readable title-case form rather than dropped.
 */
export function priceFinishToHint(key: string): string {
  const map: Record<string, string> = {
    normal: "Regular",
    holofoil: "Holo",
    reverseHolofoil: "Reverse Holo",
    "1stEditionHolofoil": "1st Edition Holo",
    "1stEditionNormal": "1st Edition",
    "1stEditionReverseHolofoil": "1st Edition Reverse Holo",
    unlimited: "Unlimited",
  };
  if (map[key]) return map[key];
  // Fall back to a readable title-case of the raw key.
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/**
 * T30.6: pure hint derivation for candidates that ALREADY carry `priceFinishes`
 * (the text / name-first paths — the API select returns them). Appends a
 * human-readable variant hint for every advertised finish so the picker shows
 * all physical options. Never fetches; a candidate with no pricing is returned
 * unchanged.
 */
export function applyPriceFinishHints(
  candidates: IdentifyCandidate[],
): IdentifyCandidate[] {
  return candidates.map((c) => {
    if (!c.priceFinishes || c.priceFinishes.length === 0) return c;
    const added = c.priceFinishes
      .map(priceFinishToHint)
      .filter((h) => h && h.length > 0);
    const hints = [...new Set([...(c.variantHints ?? []), ...added])];
    if (hints.every((h) => (c.variantHints ?? []).includes(h))) return c;
    return { ...c, variantHints: hints };
  });
}

/**
 * T30.6: attach tcgplayer pricing-finish keys to candidates that lack them
 * (the artwork-embedding path's RPC rows carry no pricing) and derive a
 * human-readable variant-hint for each advertised finish so the picker shows
 * every physical option. Candidates that already carry `priceFinishes` get hint
 * derivation only. Never throws: a pricing outage returns the input unchanged
 * so signal 3 just degrades to "no data" — never fails a scan.
 */
export async function enrichCandidatesWithPricing(
  candidates: IdentifyCandidate[],
  fetchFn: PriceFinishesFn,
): Promise<IdentifyCandidate[]> {
  const need = candidates.filter((c) => !c.priceFinishes);
  let fetched = new Map<string, string[]>();
  if (need.length > 0) {
    const ids = [...new Set(need.map((c) => c.id))];
    try {
      fetched = await fetchFn(ids);
    } catch {
      // Pricing outage — leave candidates as-is; signal 3 degrades to no data.
      return candidates;
    }
  }
  return candidates.map((c) => {
    if (!c.priceFinishes) {
      const keys = fetched.get(c.id) ?? [];
      const added = keys.map(priceFinishToHint).filter((h) => h && h.length > 0);
      const hints = [...new Set([...(c.variantHints ?? []), ...added])];
      return { ...c, priceFinishes: keys, variantHints: hints };
    }
    return c;
  });
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

// ── Hybrid matcher (T23.3) ─────────────────────────────────────────────────

export interface HybridTiebreakResult {
  candidates: IdentifyCandidate[];
  needsConfirmation: boolean;
  /** Human reason when needsConfirmation (e.g. same-art variant/stamp tie). */
  confirmationReason: string | null;
}

/**
 * Fuse the T23.2 embedding-similarity ranking with the T26.1 identity-first
 * re-ranking into the final candidate list.
 *
 * The hybrid matcher now makes the vision NAME the primary ranking signal and
 * uses artwork similarity to rank WITHIN the matching tier. `number` and `setId`
 * flow through so a name match can be refined by the set/number the vision read.
 * The composite `finalScore` (which may exceed 1.0 from the identity boost) is
 * clamped to 0..1 for the UI contract; ordering is preserved because clamping
 * is monotonic and equal clamped values fall back to the matcher's similarity
 * tiebreak. needsConfirmation/confirmationReason come straight from the matcher.
 */
export function applyHybridTiebreak(
  embeddingCandidates: IdentifyCandidate[],
  identity: CardIdentity,
): HybridTiebreakResult {
  const inputs: HybridCandidateInput[] = embeddingCandidates.map((c) => ({
    id: c.id,
    name: c.name,
    similarity: c.score,
    // The catalog doesn't split same-art variants, so real candidates carry no
    // distinguishing physical metadata. The synthetic/acceptance path tests
    // the tiebreak directly against hybrid-matcher.hybridMatch.
    variant: null,
    stamp: null,
    // Set/number flow through for the T26.1 set/number confirmation.
    number: c.number || null,
    setId: c.set?.id || null,
  }));

  const result = hybridMatch(inputs, identity);
  const scoreById = new Map(
    result.ranked.map((r) => [r.candidate.id, r.finalScore]),
  );
  // Re-rank the original IdentifyCandidates to match the hybrid order, carrying
  // the final composite score forward (clamped to 0..1 for the UI).
  const byId = new Map(embeddingCandidates.map((c) => [c.id, c]));
  const ranked = result.ranked
    .map((r) => byId.get(r.candidate.id))
    .filter((c): c is IdentifyCandidate => Boolean(c))
    .map((c) => {
      const raw = scoreById.get(c.id) ?? c.score;
      return { ...c, score: Math.max(0, Math.min(1, raw)) };
    });

  return {
    candidates: ranked,
    needsConfirmation: result.needsConfirmation,
    confirmationReason: result.reason,
  };
}

/**
 * needsConfirmation = true when the top-2 scores are close (< 0.15) OR when the
 * vision model read a pricing-relevant stamp/variant conflict (regular vs
 * Pokemon Center Exclusive / 1st Edition / shadowless). T30.1 additionally
 * forces confirmation whenever the card exists in multiple physical prints —
 * never auto-select a variant, even on a confident score.
 */
export function decideNeedsConfirmation(
  candidates: IdentifyCandidate[],
  identity: CardIdentity,
): boolean {
  if (candidates.length === 0) return true;
  if (hasStampConflict(identity)) return true;
  // T30.1: multiple physical prints of the recognized card -> always confirm.
  if (hasMultiplePrintVariants(candidates)) return true;
  if (candidates.length >= 2) {
    const gap = candidates[0].score - candidates[1].score;
    if (gap < CONFIRMATION_GAP) return true;
  }
  return false;
}

/**
 * Pick how many candidates to return: up to AMBIGUOUS_CANDIDATE_LIMIT (20) when
 * ambiguous, exactly 1 when the top match is clearly unambiguous. The UI
 * (T23.4) handles rendering the 20-item ambiguous list. T30.1: the
 * variant-multiplicity path flows through the `needsConfirmation=true` branch,
 * so when a card has multiple prints the FULL same-name list (up to 20) is
 * returned for the user to pick the exact version — never auto-selected to 1.
 */
export function trimCandidates(
  candidates: IdentifyCandidate[],
  needsConfirmation: boolean,
): IdentifyCandidate[] {
  if (!needsConfirmation) return candidates.slice(0, CLEAR_CANDIDATE_LIMIT);
  return candidates.slice(0, AMBIGUOUS_CANDIDATE_LIMIT);
}

// ── T29.1 hard name filter ────────────────────────────────────────────────────

/**
 * T29.1: hard-filter the candidate list so it contains ONLY cards whose
 * normalized name EXACTLY equals the normalized vision name. This closes the
 * Psyduck-scan bug where mismatched-name cards (Jolteon, "Sabrina's Psyduck",
 * "Brock's Onix", …) filled the picker alongside the 2 true Psyduck prints.
 *
 * The rule is EXACT equality after normalizeName() — NOT substring/containment.
 * An apostrophe normalized away does not rescue a possessive card:
 * `sabrina s psyduck` !== `psyduck`, and `brock s onix` !== `onix`, so both are
 * deliberately dropped. When the vision name is empty/unusable, the filter is a
 * no-op (returns candidates unchanged) so the artwork/text ranking stands.
 *
 * This filter is the strict superset of the T28.2 containment rule: anything
 * that passed that rule (exact name) also passes here, and it additionally
 * strips same-tier impostors that the hybrid matcher's identity veto only
 * down-ranks but never removes.
 */
export function hardFilterByVisionName(
  candidates: IdentifyCandidate[],
  identity: CardIdentity,
): IdentifyCandidate[] {
  const vn = normalizeName(identity.name);
  if (vn === "") return candidates;
  return candidates.filter((c) => normalizeName(c.name) === vn);
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

// ── T28.1 name-first fallback ───────────────────────────────────────────────

/**
 * Run the pokemontcg.io text matcher against a matcher-shaped identity and
 * return either the CandidateCard[] to rank or a terminal IdentifyOutcome
 * (tcg-down / no-match). Shared by the T22.4 text fallback and the T28.1
 * name-first path so the 5xx/429/network error handling and the
 * no-match-vs-API-down probe stay identical in both places.
 */
async function textMatchCards(
  matcherIdentity: import("./tcg-match.ts").CardIdentity,
  extracted: CardIdentity,
  matchOptions: MatchOptions | undefined,
  limit: number,
): Promise<{ cards: CandidateCard[] } | { outcome: IdentifyOutcome }> {
  let cards: CandidateCard[];
  try {
    cards = await matchCard(matcherIdentity, { ...matchOptions, limit });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    // 5xx/429 exhausted retries or network-unknown -> treat as tcg down.
    if (status >= 500 || status === 429 || status === 0) {
      const message =
        e instanceof Error
          ? `pokemontcg.io unavailable: ${e.message}`
          : "pokemontcg.io unavailable";
      return {
        outcome: { status: "tcg-down", code: "TCG_API_UNAVAILABLE", message },
      };
    }
    throw e; // 4xx other than 429 — unexpected, let route 500 it
  }

  // No candidates at all. Distinguish "tcg healthy, genuinely no record" from
  // "tcg down" — matchCard swallows per-query errors, so probe the API.
  if (cards.length === 0) {
    const down = await tcgProbeUnhealthy(matchOptions);
    if (down) {
      return {
        outcome: {
          status: "tcg-down",
          code: "TCG_API_UNAVAILABLE",
          message: "pokemontcg.io unavailable",
        },
      };
    }
    return { outcome: { status: "no-match", code: "NO_MATCH", extracted } };
  }

  return { cards };
}

/**
 * T28.1 name-first fallback: the top-20 artwork-embedding candidates did NOT
 * include the vision-named card (a similar-art impostor like Slugma dominated).
 * Instead of trusting that mismatched artwork, re-query the catalog BY NAME so
 * we recover every real print of the vision-named card (e.g. all Onix), then
 * rank them through the hybrid matcher — the identity veto now applies because
 * every candidate matches the name — so the same confirmation/tiebreak logic
 * drives variant/stamp/print refinement. Only name-matching candidates are ever
 * presented; a mismatched-name impostor is never surfaced.
 */
async function nameFirstFallback(
  identity: CardIdentity,
  matchOptions: MatchOptions | undefined,
): Promise<IdentifyOutcome> {
  // Query by name ONLY. Pinning the vision set/number here could prune the true
  // candidates if the vision misread them — the whole point is that artwork
  // already failed us, so give the user every print of the correct name.
  const matcherIdentity: import("./tcg-match.ts").CardIdentity = {
    name: identity.name,
  };
  const text = await textMatchCards(
    matcherIdentity,
    identity,
    matchOptions,
    AMBIGUOUS_CANDIDATE_LIMIT,
  );
  if ("outcome" in text) return text.outcome;

  const hybrid = applyHybridTiebreak(
    text.cards.map((c) => toCandidate(c, identity)),
    identity,
  );
  // Defensive (T29.1): matchCard already queries by exact name, but hard-filter
  // the re-ranked list anyway — belt-and-braces so a mismatched-name card can
  // never leak out of the name-first path.
  const filtered = hardFilterByVisionName(hybrid.candidates, identity);
  if (filtered.length === 0) {
    // We already re-queried by name; no name-matching print exists -> no-match.
    return { status: "no-match", code: "NO_MATCH", extracted: identity };
  }
  // T30.1: enrich print hints, then never auto-select when multiple prints exist.
  const enriched = enrichPrintVariantHints(filtered);
  // T30.6: text candidates already carry priceFinishes from the API select —
  // derive the advertised-finish hints (pure, no fetch) so the picker shows
  // every physical option.
  const priced = applyPriceFinishHints(enriched);
  const variantForced = hasMultiplePrintVariants(priced);
  const needsConfirmation = hybrid.needsConfirmation || variantForced;
  return {
    status: "ok",
    candidates: trimCandidates(priced, needsConfirmation),
    needsConfirmation,
    confirmationReason: variantForced
      ? VARIANT_CONFIRM_REASON
      : hybrid.confirmationReason,
    extracted: identity,
  };
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Run the full identify pipeline: imageUrl -> vision -> (embedding lookup
 * PRIMARY | tcg text match fallback) -> tiebreak.
 *
 * T23.2/T23.3 change: when `deps.embedding` is supplied and the card_embeddings
 * table is populated, the artwork-embedding path is the primary candidate
 * source and returns up to EMBEDDING_CANDIDATE_LIMIT (20) similarity-ranked
 * candidates. Vision extraction ALWAYS runs first (T23.3 needs the extracted
 * identity for variant/stamp tiebreak). The embedding path is then fused with
 * the hybrid matcher: vision name primary (identity veto), artwork similarity
 * second, variant/stamp tiebreak + needsConfirmation (+ confirmationReason).
 * The pokemontcg.io text matcher is
 * used only as a fallback when the embedding table is empty/unavailable (or no
 * embedding deps are supplied — the pre-T23.2 behavior).
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

  // T30.6: pricing-finish source for the identify-time enrichment. Defaults to
  // the batched pokemontcg.io query, wired to whatever HTTP/matchOptions the
  // caller supplied so retries/timeouts behave like the matcher.
  const priceFetcher: PriceFinishesFn =
    deps.fetchPriceFinishes ??
    ((ids: string[]) => fetchPriceFinishes(ids, deps.matchOptions));

  // 2. Embedding lookup — primary when the table is populated.
  if (deps.embedding) {
    const embeddingCandidates = await runEmbeddingLookup(
      imageUrl,
      deps.embedding,
      identity,
    );
    if (embeddingCandidates.length > 0) {
      // T28.1: when the vision name is usable but NONE of the top-20 embedding
      // candidates match it, artwork similarity already led us astray (a
      // similar-art impostor like Slugma dominated the art ranking). Do NOT
      // fall back to pure artwork similarity — re-query the catalog BY NAME
      // and present only name-matching candidates.
      const visionName = normalizeName(identity.name);
      const anyNameMatch = embeddingCandidates.some(
        (c) => normalizeName(c.name) === visionName,
      );
      if (visionName !== "" && !anyNameMatch) {
        return await nameFirstFallback(identity, deps.matchOptions);
      }
      // T23.3: hybrid matcher — embedding similarity (primary) fused with the
      // vision variant/stamp tiebreak. When the vision model reads a pricing
      // stamp on a same-art tie the candidates stay grouped and
      // needsConfirmation is set; otherwise an unambiguous top match trims to 1.
      const hybrid = applyHybridTiebreak(embeddingCandidates, identity);
      // T29.1: hard-filter by vision name AFTER the hybrid rank so ONLY exact
      // same-name cards survive (Psyduck prints stay; Jolteon / Sabrina's
      // Psyduck / other names are dropped). needsConfirmation is preserved so
      // the picker remains a same-name variant/print refinement.
      const filtered = hardFilterByVisionName(hybrid.candidates, identity);
      if (filtered.length === 0 && normalizeName(identity.name) !== "") {
        // No candidate survived the name filter — re-query the catalog BY NAME
        // (the T28.1 path) so every real print of the vision-named card shows.
        return await nameFirstFallback(identity, deps.matchOptions);
      }
      // T30.1: enrich print hints, then never auto-select a variant when the
      // recognized card has multiple physical prints (the Latios δ regression).
      const enriched = enrichPrintVariantHints(filtered);
      // T30.6: the embedding RPC rows carry no pricing, so fetch finish keys
      // at identify time and derive picker hints from them. On a pricing
      // outage this is a no-op and signal 3 just degrades to "no data".
      const priced = await enrichCandidatesWithPricing(enriched, priceFetcher);
      const variantForced = hasMultiplePrintVariants(priced);
      const needsConfirmation = hybrid.needsConfirmation || variantForced;
      return {
        status: "ok",
        candidates: trimCandidates(priced, needsConfirmation),
        needsConfirmation,
        confirmationReason: variantForced
          ? VARIANT_CONFIRM_REASON
          : hybrid.confirmationReason,
        extracted: identity,
      };
    }
    // Empty/unavailable table → fall through to the text matcher.
  }

  // 3. TCG text matching (fallback). Shared error/no-match handling so the
  //    5xx/429/network + no-match-vs-API-down behavior is identical to the
  //    T28.1 name-first path.
  const text = await textMatchCards(
    toMatcherIdentity(identity),
    identity,
    deps.matchOptions,
    /*limit*/ 5,
  );
  if ("outcome" in text) return text.outcome;

  // 4. Stamp/variant tiebreaker + T29.1 hard name filter + confirmation
  //    decision + trimming. The filter is applied defensively (matchCard already
  //    queried by name). If it leaves 0 candidates we ARE the name query — a
  //    no-match outcome, NOT a name-first re-query.
  const stampCandidates = applyStampTiebreak(text.cards, identity);
  const candidates = hardFilterByVisionName(stampCandidates, identity);
  if (candidates.length === 0) {
    return { status: "no-match", code: "NO_MATCH", extracted: identity };
  }
  // T30.1: enrich print hints per candidate, then decide confirmation (variant
  // multiplicity forces it). When variants are why the picker appeared, surface
  // a human reason even though the top score is confident.
  const enriched = enrichPrintVariantHints(candidates);
  // T30.6: text candidates already carry priceFinishes from the API select —
  // derive the reverse-holo/other finish hints (pure, no fetch) so the picker
  // shows every option.
  const priced = applyPriceFinishHints(enriched);
  const variantForced = hasMultiplePrintVariants(priced);
  const needsConfirmation = decideNeedsConfirmation(priced, identity);
  return {
    status: "ok",
    candidates: trimCandidates(priced, needsConfirmation),
    needsConfirmation,
    confirmationReason: variantForced ? VARIANT_CONFIRM_REASON : null,
    extracted: identity,
  };
}
