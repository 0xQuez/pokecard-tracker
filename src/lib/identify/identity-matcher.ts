/**
 * identity-matcher.ts — Cross-reference vision-extracted features against the
 * card catalog and resolve to a scored identity (T20).
 *
 * Input:  VisionFeatures read off the photo.
 * Output: IdentifyResult — ordered candidates + whether the UI must ask the
 *         user to confirm.
 *
 * KEY DESIGN POINT (svp-44 Charmander):
 *   pokemontcg.io has ONE entry for a card regardless of print/stamp. The
 *   regular "Charmander" and the "Pokemon Center Exclusive" Charmander share
 *   the same catalog id (svp-44). The catalog score alone cannot tell them
 *   apart — the VISION MODEL's stamp field is the tiebreaker. When the vision
 *   model reports `stamp: "pokemon-center"`, the matcher SURFACES a synthetic
 *   Pokemon-Center-Exclusive candidate on top of the catalog match so the user
 *   is asked which one they hold (4x price difference, so it cannot be guessed).
 *
 * The catalog is abstracted behind `IdentifyCatalog` so unit tests run
 * deterministically offline (matching the card-identity.test.mjs pattern).
 */

import type {
  VisionFeatures,
  Variant,
  Print,
  Stamp,
} from "./card-vision";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A candidate identity, one row in the API response. */
export interface IdentifyCandidate {
  name: string;
  set: string;
  setCode: string; // ptcgoCode or catalog set id (UI-friendly)
  setId: string; // pokemontcg.io set id
  cardNumber: string;
  variant: Variant | "pokemon-center-exclusive" | "none";
  print: Print;
  stamp: Stamp;
  price: number | null; // catalog market price (TCGPlayer) if known
  imageUrl: string | null; // catalog card thumbnail
  confidence: number; // 0..1, how strongly this candidate fits
  reason: string; // human-readable rationale shown in the UI
  synthetic: boolean; // true for PC-exclusive candidate synthesized from stamp
}

export interface IdentifyResult {
  candidates: IdentifyCandidate[];
  /** True when the UI must show a picker / warning before proceeding. */
  needsConfirmation: boolean;
  warning: string | null;
}

/** A raw catalog card as the matcher sees it. */
export interface CatalogCard {
  id: string;
  name: string;
  number: string; // "44"
  setId: string;
  setName: string;
  ptcgoCode: string | null;
  price: number | null;
  imageUrl: string | null;
  /** Print variants the catalog says exist (from tcgplayer.prices keys). */
  availableVariants: string[];
}

/** Injectable catalog (live pokemontcg.io adapter or offline fixture). */
export interface IdentifyCatalog {
  /**
   * Search by card name, optionally narrowed by number / set-name hints.
   * Returns up to `limit` raw cards.
   */
  searchCards(
    query: { name: string; number?: string | null; setHints?: string[] },
    limit?: number
  ): Promise<CatalogCard[]>;
  /** Optional health probe so zero-matches can distinguish "down" from "absent". */
  health?: () => { degraded: boolean; message?: string };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

const CANDIDATE_LIMIT = 3;
const TIED_THRESHOLD = 0.06; // top-2 within this -> needs confirmation
const HIGH_CONFIDENCE = 0.9; // single best above this, no stamp -> auto-resolve

function _norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim();
}

/** Loose name match: exact, prefix, or all significant query words present. */
function nameScore(cardName: string, queryName: string): number {
  const cn = _norm(cardName);
  const qn = _norm(queryName);
  if (!cn || !qn) return 0;
  if (cn === qn) return 1;
  if (cn.startsWith(qn + " ") || qn.startsWith(cn + " ")) return 0.9;
  const cw = new Set(cn.split(/[^a-z0-9]+/).filter(Boolean));
  const qw = qn.split(/\s+/).filter(Boolean);
  if (qw.length === 0) return 0;
  const hits = qw.filter((w) => cw.has(w)).length;
  return (hits / qw.length) * 0.8;
}

/**
 * Score how well a catalog card matches the vision features, 0..1.
 * Name + number are the strongest signals; set hints and variant availability
 * add smaller bonuses. Used to order candidates before the stamp tiebreak.
 */
export function scoreCatalogCard(card: CatalogCard, f: VisionFeatures): number {
  let score = 0;

  // Number — strongest, and disqualifying when both present and mismatched.
  if (f.number) {
    if (card.number === f.number) score += 0.5;
    else if (/^\d+$/.test(f.number)) return 0; // a real number that disagrees
  }

  // Name.
  score += nameScore(card.name, f.name || "") * 0.4;

  // Set hint bonus (vision reads the set off the card).
  if (f.set) {
    const hint = _norm(f.set);
    const set = _norm(card.setName);
    if (set && (set.includes(hint) || hint.includes(set))) score += 0.1;
  }

  // Variant availability: confirm the vision's claim is plausible for this card.
  if (f.variant && card.availableVariants.length > 0) {
    const claimed = f.variant === "reverse-holo" ? "reverse" : f.variant;
    if (card.availableVariants.some((v) => v.includes(claimed))) score += 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Stamp tiebreaker (svp-44 rule). When the vision model reads a Pokemon Center
 * stamp, produce a synthetic "pokemon-center-exclusive" candidate layered on
 * top of the base catalog match. The catalog has no separate PC-exclusive row,
 * so this candidate is marked `synthetic` and priced from the base card.
 */
export function applyStampTiebreak(
  features: VisionFeatures,
  base: IdentifyCandidate
): IdentifyCandidate[] {
  if (features.stamp !== "pokemon-center") return [base];
  const pc: IdentifyCandidate = {
    ...base,
    variant: "pokemon-center-exclusive",
    stamp: "pokemon-center",
    // It's the same catalog record, but the collector variant is the valuable
    // one — surface it first with a tie-breaking confidence bump.
    confidence: Math.min(1, base.confidence + 0.1),
    reason: `Pokemon Center stamp detected on photo. This is the PC Exclusive print of ${base.name} (svp-44), a different product from the regular print.`,
    synthetic: true,
  };
  return [pc, base];
}

// ── Main resolution ───────────────────────────────────────────────────────────

/**
 * The identify gate. Resolve vision features to an ordered candidate list.
 * Never throws: worst case returns an empty candidate list with a warning.
 */
export async function matchCardIdentity(
  features: VisionFeatures,
  catalog: IdentifyCatalog
): Promise<IdentifyResult> {
  let warning: string | null = null;

  const name = features.name || "";
  const number = features.number || null;
  const setHints = features.set ? [features.set] : [];

  if (!name && !number) {
    return {
      candidates: [],
      needsConfirmation: true,
      warning: "vision could not read a card name or number from the photo",
    };
  }

  const cards = await catalog.searchCards({ name, number, setHints });

  if (cards.length === 0) {
    const degraded = catalog.health?.()?.degraded ?? false;
    warning = degraded
      ? `catalog unavailable (${catalog.health?.()?.message}); card may still exist. Retry`
      : "no catalog match for the card read from the photo";
    return { candidates: [], needsConfirmation: true, warning };
  }

  // Score every candidate, keep the top N.
  const scored = cards
    .map((card) => {
      const conf = scoreCatalogCard(card, features);
      const variant: Variant | "none" =
        card.availableVariants.length === 0 || !features.variant
          ? "none"
          : features.variant;
      const reason =
        conf >= 1 ? "exact match" : conf >= 0.8 ? "strong match" : "possible match";
      return { card, conf, variant, reason };
    })
    .sort((a, b) => b.conf - a.conf)
    .slice(0, CANDIDATE_LIMIT);

  // Build base candidates (before the stamp tiebreak).
  const baseCandidates: IdentifyCandidate[] = scored.map((s) => ({
    name: s.card.name,
    set: s.card.setName,
    setCode: s.card.ptcgoCode ?? s.card.setId,
    setId: s.card.setId,
    cardNumber: s.card.number,
    variant: s.variant,
    print: features.print,
    stamp: features.stamp,
    price: s.card.price,
    imageUrl: s.card.imageUrl,
    confidence: Math.round(s.conf * 100) / 100,
    reason: s.reason,
    synthetic: false,
  }));

  if (baseCandidates.length === 0) {
    return { candidates: [], needsConfirmation: true, warning: "no catalog match" };
  }

  // Stamp tiebreak on the best match (only meaningful for the top candidate).
  const candidates = applyStampTiebreak(features, baseCandidates[0]).concat(
    baseCandidates.slice(1)
  );

  // Ambiguity: when no PC stamp, resolve automatically if the best candidate is
  // comfortably ahead and exact; otherwise ask the user to pick.
  let needsConfirmation: boolean;
  if (features.stamp === "pokemon-center") {
    needsConfirmation = true; // PC-exclusive is a different product -> confirm
  } else {
    const best = baseCandidates[0];
    const runnerUpClose =
      baseCandidates.length > 1 &&
      Math.abs(baseCandidates[0].confidence - baseCandidates[1].confidence) < TIED_THRESHOLD;
    const exact =
      best.confidence >= HIGH_CONFIDENCE &&
      (!number || best.cardNumber === number) &&
      (!features.variant ||
        best.variant === "none" ||
        best.variant === features.variant);
    needsConfirmation = !exact || runnerUpClose;
  }

  return { candidates, needsConfirmation, warning };
}
