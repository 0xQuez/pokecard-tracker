/**
 * hybrid-matcher.ts — Fuse embedding similarity (primary) with vision-extracted
 * variant/stamp features (tiebreak) into the final candidate ranking (T23.3).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * T23.2's artwork-embedding lookup returns the top-20 nearest catalog cards by
 * pixel (CLIP) similarity. But embeddings conflate same-art variants: the
 * regular svp-44 Charmander promo and the Pokemon-Center-stamped version are
 * near-identical vectors, yet roughly 4x apart in price. This module is the
 * final ranking step that turns those embedding candidates into the ranked
 * list the UI shows:
 *
 *   base score    = embedding similarity (DOMINANT term)
 *   + name bonus  = small, vision name == candidate name (embeddings already
 *                   cover identity, so this only nudges, never dominates)
 *   tiebreak      = when the top candidates share the same art (similarity
 *                   within SAME_ART_SIMILARITY_WINDOW), prefer the candidate
 *                   whose variant/stamp metadata matches the vision reading;
 *                   if vision saw a stamp but no candidate metadata
 *                   distinguishes the print, keep the tied group together and
 *                   set needsConfirmation.
 *   confirmation  = true whenever the top-2 FINAL scores are within
 *                   CONFIRMATION_FINAL_MARGIN OR a stamp/variant tie was
 *                   detected. Card identity is sacred — never silently
 *                   collapse an ambiguous tie to rank 1.
 *
 * INPUTS
 * ------
 *   candidates : the T23.2 embedding candidates ({id, name, similarity, ...}),
 *                plus OPTIONAL physical metadata per candidate ({variant,
 *                stamp}). The catalog (pokemontcg.io) does NOT split svp-44
 *                into regular vs PC-exclusive, so real rows carry no
 *                distinguishing metadata — the "no metadata distinguishes it"
 *                branch handles that. The synthetic/acceptance path can attach
 *                per-candidate stamp/variant to verify the tiebreak.
 *   identity   : the T22.3 vision CardIdentity ({name, variant, print, stamp,
 *                confidence, ...}). Only the name / variant / stamp fields are
 *                consulted here.
 *
 * Pure / headless: no I/O, no JSX. Everything is a pure function of its args,
 * so it unit-tests offline under `node --test` (erasable TS, no enums).
 */

import type { CardIdentity } from "./vision-identify.ts";

// ── Tunable constants (commented) ───────────────────────────────────────────

/**
 * Weight given to artwork (embedding) similarity within a candidate's score.
 * The remaining headroom is reserved for identity, so a name-matching candidate
 * can decisively outrank a same-art impostor without the score blowing past
 * 1.0. Artwork still ranks candidates *within* a matching identity group.
 */
export const SIM_WEIGHT = 0.8;
/**
 * Flat score added to a candidate whose name matches the vision reading, when
 * the vision name is usable and at least one candidate matches. This is the
 * T26.1 identity-first mechanism: it dominates the art-similarity gap between a
 * true match and a same-art different-name impostor, so the vision NAME can
 * actually correct the artwork ranking (previously only a 0.02 nudge).
 */
export const IDENTITY_BOOST = 0.2;
/**
 * Small extra score when a name-matching candidate's collector number or set
 * code also matches the vision reading. Refines WHICH set/number is correct
 * among same-name candidates (e.g. base1-46 vs svp-44 Charmander).
 */
export const SET_NUMBER_MATCH_BONUS = 0.02;
/**
 * Bonus added to a same-art-tied candidate whose variant/stamp metadata matches
 * the vision reading. Larger than the set/number bonus because it's the
 * tiebreaker — it must actually break a near-equal-similarity tie, not just
 * nudge.
 */
export const VARIANT_MATCH_BONUS = 0.05;
/**
 * Same-art window: top candidates whose similarity is within this much of the
 * current top are treated as the same artwork (embeddings conflate them).
 */
export const SAME_ART_SIMILARITY_WINDOW = 0.02;
/**
 * needsConfirmation fires when the top-2 FINAL scores are within this margin,
 * even when no explicit stamp/variant tie was seen.
 */
export const CONFIRMATION_FINAL_MARGIN = 0.02;

/** Human-facing reason attached to needsConfirmation for a stamp/variant tie. */
export const SAME_ART_VARIANT_REASON =
  "same-art variants differ (stamp/holo) — user must confirm";
/** Human-facing reason for a plain near-miss between the top two candidates. */
export const CLOSE_MATCH_REASON =
  "top-2 matches are too close to auto-resolve — user must confirm";

// ── Public input / output types ─────────────────────────────────────────────

/** Optional physical-print metadata for a candidate (may be absent in catalog). */
export interface HybridVariantMetadata {
  /** e.g. "holo" | "reverse_holo" | "regular" | null. */
  variant?: string | null;
  /** e.g. "Pokemon Center" | "1st Edition" | null. */
  stamp?: string | null;
}

/** One candidate the matcher re-ranks. Carries the T23.2 embedding similarity. */
export interface HybridCandidateInput {
  /** pokemontcg.io card id, e.g. "svp-44". */
  id: string;
  /** Canonical card name, e.g. "Charmander". */
  name: string;
  /** Base embedding similarity, 0..1 (dominant score term). */
  similarity: number;
  /** Optional physical-print metadata used for the variant/stamp tiebreak. */
  variant?: string | null;
  stamp?: string | null;
  /** Optional collector number, e.g. "44" (T26.1 set/number confirmation). */
  number?: string | null;
  /** Optional set code, e.g. "svp" (T26.1 set/number confirmation). */
  setId?: string | null;
}

/** A candidate after scoring — finalScore is what ordering is based on. */
export interface HybridRankedCandidate {
  candidate: HybridCandidateInput;
  /** 0..1 composite score = similarity (+ name bonus) (+ variant bonus). */
  finalScore: number;
  /** Whether the vision name matched this candidate's name (applied bonus). */
  nameMatched: boolean;
  /** Whether this candidate's stamp/variant metadata matched the vision. */
  variantMatch: boolean;
}

/** The matcher's output: re-ranked list + confirmation decision + reason. */
export interface HybridMatchResult {
  /** Re-ranked by finalScore, descending. Original similarity order is the
   *  tiebreaker when final scores are equal. */
  ranked: HybridRankedCandidate[];
  /**
   * True when the top-2 final scores are within CONFIRMATION_FINAL_MARGIN OR a
   * same-art stamp/variant tie was detected. Never auto-collapse an ambiguous
   * tie — always ask the user.
   */
  needsConfirmation: boolean;
  /** Non-null reason when needsConfirmation is true (and sometimes even when
   *  the stamp tie is merely hinted); null when unambiguous. */
  reason: string | null;
  /** True when a same-art stamp/variant tie was detected in the input. */
  tieDetected: boolean;
}

export interface HybridMatchOptions {
  simWeight?: number;
  identityBoost?: number;
  variantBonus?: number;
  sameArtWindow?: number;
  confirmationMargin?: number;
}

// ── Normalization helpers ───────────────────────────────────────────────────

/** Case/space/punct-insensitive name form used for the "vision name matches
 *  candidate name" check. */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Reduce a collector number to a comparable form. The vision reading is messy
 * ("044/SVP 44", "SV1 46"), while the catalog stores the printed number ("44").
 * We extract the trailing integer group and strip leading zeros so "044/SVP 44"
 * -> "44", "46" -> "46", "046" -> "46". Returns "" when nothing usable.
 */
export function normalizeCollectorNumber(v: string | null | undefined): string {
  if (!v) return "";
  const m = /(\d+)\s*$/.exec(v.trim());
  if (!m) return "";
  return String(parseInt(m[1], 10));
}

/** Case/space-insensitive set code form, e.g. "SVP" -> "svp". */
function normalizeSetCode(v: string | null | undefined): string {
  if (!v) return "";
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Does a candidate's collector number OR set code agree with the vision
 * reading? Used as a refinement *within* the name-matching tier to pick the
 * right set/number among same-name candidates (e.g. base1-46 vs svp-44
 * Charmander). Never applied across a name mismatch.
 */
export function setOrNumberMatches(
  cand: Pick<HybridCandidateInput, "number" | "setId">,
  identity: Pick<CardIdentity, "collectorNumber" | "setCode">,
): boolean {
  const candNumber = normalizeCollectorNumber(cand.number);
  const visionNumber = normalizeCollectorNumber(identity.collectorNumber);
  if (candNumber && visionNumber && candNumber === visionNumber) return true;
  const candSet = normalizeSetCode(cand.setId);
  const visionSet = normalizeSetCode(identity.setCode ?? null);
  if (candSet && visionSet && candSet === visionSet) return true;
  return false;
}

/** Map a raw variant string to the canonical Variant, or null. */
function normalizeVariant(v: string | null | undefined): string | null {
  if (!v) return null;
  const low = v.toLowerCase().replace(/[\s_-]+/g, "_");
  if (low.includes("reverse")) return "reverse_holo";
  if (low.includes("holo") || low === "holofoil" || low === "holo_foil")
    return "holo";
  if (low === "regular" || low === "normal" || low === "flat") return "regular";
  return null;
}

/**
 * Classify a stamp string into a pricing-relevant collector category, or null
 * when it carries no signal. Mirrors the pipeline's stampCategory.
 */
export function stampCategory(
  stamp: string | null | undefined,
): string | null {
  if (!stamp) return null;
  const s = stamp.toLowerCase().replace(/[\s_-]+/g, " ");
  if (s.includes("pokemon center")) return "pokemon-center";
  if (s.includes("1st edition")) return "1st-edition";
  if (s.includes("shadowless")) return "shadowless";
  if (s.includes("professor")) return "professor";
  if (s.includes("staff")) return "staff";
  return null;
}

/** True when the vision identity carries a pricing-relevant stamp signal. */
export function visionHasStamp(identity: Pick<CardIdentity, "stamp">): boolean {
  return stampCategory(identity.stamp) !== null;
}

/**
 * Does this candidate's physical metadata match what the vision model read?
 * When the vision model saw a stamp, a candidate matches if its stamp
 * classifies to the same category. When there's no vision stamp, we fall back
 * to a variant comparison. Returns false when no metadata is available.
 */
export function metadataMatchesVision(
  cand: HybridVariantMetadata,
  identity: Pick<CardIdentity, "stamp" | "variant">,
): boolean {
  const visionStampCat = stampCategory(identity.stamp);
  if (visionStampCat) {
    if (cand.stamp) return stampCategory(cand.stamp) === visionStampCat;
    return false; // candidate carries no stamp metadata that could match
  }
  // No pricing stamp read by vision — compare the plain variant, if any.
  const visionVariant = normalizeVariant(identity.variant);
  const candVariant = normalizeVariant(cand.variant);
  if (visionVariant && candVariant) return visionVariant === candVariant;
  return false;
}

// ── The matcher ─────────────────────────────────────────────────────────────

/**
 * Re-rank embedding candidates with identity FIRST (T26.1) and artwork
 * similarity second.
 *
 * The embedding similarity is the raw artwork signal; a same-art card from a
 * different set can score as high as the true card (that is the T26.1 bug). So
 * we gate on the vision NAME: when the name is usable and at least one
 * candidate matches it, matching candidates receive IDENTITY_BOOST (plus a
 * SET_NUMBER_MATCH_BONUS refinement) and are ranked ahead of every non-matching
 * candidate — artwork similarity then ranks WITHIN the matching tier, where a
 * stamp/variant tiebreak still resolves same-name prints. When the vision name
 * is unusable or matches nothing, we fall back to pure art similarity so a
 * wrong/hallucinated name can never override a strong art match.
 *
 * `finalScore` is the internal ranking key and may exceed 1.0 (identity boost
 * on a near-perfect art match); callers clamp the exposed score to 0..1 for
 * display. Deterministic and pure.
 */
export function hybridMatch(
  candidates: HybridCandidateInput[],
  identity: CardIdentity,
  opts: HybridMatchOptions = {},
): HybridMatchResult {
  const simWeight = opts.simWeight ?? SIM_WEIGHT;
  const identityBoost = opts.identityBoost ?? IDENTITY_BOOST;
  const variantBonus = opts.variantBonus ?? VARIANT_MATCH_BONUS;
  const sameArtWindow = opts.sameArtWindow ?? SAME_ART_SIMILARITY_WINDOW;
  const confirmMargin = opts.confirmationMargin ?? CONFIRMATION_FINAL_MARGIN;

  // 1. Classify the identity tier per candidate.
  const visionName = normalizeName(identity.name);
  const nameUsable = visionName !== "";
  const scored: HybridRankedCandidate[] = candidates.map((c) => ({
    candidate: c,
    finalScore: 0,
    nameMatched: nameUsable && normalizeName(c.name) === visionName,
    variantMatch: false,
  }));

  // 2. Identity gating only activates when the vision name is usable AND at
  //    least one candidate matches it. Otherwise trust artwork similarity.
  const anyMatch = scored.some((r) => r.nameMatched);
  const gated = nameUsable && anyMatch;

  for (const r of scored) {
    let s = r.candidate.similarity * (gated ? simWeight : 1);
    if (gated && r.nameMatched) {
      s += identityBoost;
      if (setOrNumberMatches(r.candidate, identity)) s += SET_NUMBER_MATCH_BONUS;
    }
    r.finalScore = s;
  }

  // 3. Rank by finalScore desc (similarity desc tiebreak). With identity baked
  //    into the score, a name-matching candidate outranks any same-art impostor.
  scored.sort((a, b) => {
    const d = b.finalScore - a.finalScore;
    if (d !== 0) return d;
    return b.candidate.similarity - a.candidate.similarity;
  });

  const ranked: HybridRankedCandidate[] = scored;
  let needsConfirmation = false;
  let reason: string | null = null;
  let tieDetected = false;

  if (ranked.length >= 2) {
    // The tie-relevant group is only candidates sharing #1's identity tier and
    // falling within the same-art similarity window. A down-ranked impostor
    // (different name) never triggers a variant confirmation against the winner.
    const topIsMatch = ranked[0].nameMatched;
    const topSim = ranked[0].candidate.similarity;
    const tiedGroup = ranked.filter(
      (r) =>
        r.nameMatched === topIsMatch &&
        topSim - r.candidate.similarity < sameArtWindow,
    );

    if (tiedGroup.length >= 2) {
      const stampVision = visionHasStamp(identity);
      if (stampVision) {
        tieDetected = true;
        // Does any candidate in the tied group carry distinguishing metadata
        // that matches the vision reading? If yes, boost it to break the tie.
        const matches = tiedGroup.filter((r) =>
          metadataMatchesVision(r.candidate, identity),
        );
        if (matches.length > 0) {
          for (const r of matches) {
            r.finalScore += variantBonus;
            r.variantMatch = true;
          }
          // Re-rank so the physically-matching candidate rises to the top.
          ranked.sort((a, b) => {
            const d = b.finalScore - a.finalScore;
            if (d !== 0) return d;
            return b.candidate.similarity - a.candidate.similarity;
          });
        }
        // A stamp/variant tie was detected — always confirm, whether or not we
        // could break it. Card identity is sacred.
        needsConfirmation = true;
        reason = SAME_ART_VARIANT_REASON;
      }
      // No vision stamp: fall through to the final-margin check below (a close
      // top-2 will still trigger confirmation).
    }
  }

  // 4. Final-margin check scoped to #1's identity tier: only ambiguity among
  //    genuinely matching candidates warrants confirmation. A higher-similarity
  //    impostor in a lower tier does not.
  if (ranked.length >= 2) {
    const topTier = ranked.filter((r) => r.nameMatched === ranked[0].nameMatched);
    if (topTier.length >= 2) {
      const gap = topTier[0].finalScore - topTier[1].finalScore;
      if (gap < confirmMargin) {
        needsConfirmation = true;
        if (!reason) reason = CLOSE_MATCH_REASON;
      }
    }
  }

  return { ranked, needsConfirmation, reason, tieDetected };
}
