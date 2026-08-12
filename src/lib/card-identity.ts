/**
 * card-identity.ts — First-class card identity verification gate.
 *
 * PURPOSE
 *   Before ANY pricing lookup, the agent MUST confirm: set + card number + print
 *   variant. Wrong identity = every downstream price is garbage. This module is
 *   that gate. It turns a loose user query ("Dragonite ex 90/97") into a resolved,
 *   scored card identity with an explicit confidence and a candidate list when the
 *   query is ambiguous.
 *
 * CATALOG CHOICE (documented)
 *   We use the free pokemontcg.io v2 API (no key) as the source of truth for set +
 *   number. Rationale vs. a local JSON dump:
 *     - Already used by this repo's scrapers (`src/lib/scrapers/pokemontcg.ts`),
 *       so we stay consistent with the existing integration and config.
 *     - The full card catalog is large (~20k cards) and changes with each new set;
 *       a vendored dump would go stale and bloat the repo.
 *     - The API returns tcgplayer.prices keyed by print variant (normal / holofoil /
 *       reverseHolofoil / firstEdition*), which is exactly the signal the
 *       variant cross-check (rule 7) needs.
 *   The catalog is abstracted behind the `CardCatalog` interface so unit tests run
 *   deterministically against an in-memory fixture (no network), matching the repo's
 *   injectable-settlement test pattern.
 *
 * VARIANT MODEL
 *   pokemontcg.io collapses all prints of a card into ONE id (e.g. `base1-4` is
 *   Charizard in both 1st Edition and Unlimited). So print variant is NOT derived
 *   from the catalog record alone — it is a dedicated detection layer:
 *     - Query keyword detection ("1st edition", "reverse holo", "shadowless",
 *       "unlimited").
 *     - Cross-checked against which variants the catalog says actually exist for
 *       that card (`availableVariants`).
 *     - shadowless is a Base Set-only phenomenon and is not represented in the API
 *       at all, so it is gated by a hardcoded Base Set rule.
 */

// ── Public types ────────────────────────────────────────────────────────────────

/** Print variant. "none" = no print qualifier claimed (safe default). */
export type PrintVariant =
  | "reverse_holo"
  | "first_edition"
  | "shadowless"
  | "unlimited"
  | "none";

/** A candidate match from the catalog. `suspicious` is set when the query's
 *  claimed variant isn't actually available for this card (cross-check rule 7). */
export interface IdentityCandidate {
  canonical_name: string;
  set_name: string;
  set_code: string;
  card_number: string;
  variant: PrintVariant;
  confidence: number;
  suspicious: boolean;
  reason: string;
}

/** The output contract the agent consumes before any price lookup. */
export interface CardIdentityResult {
  canonical_name: string;
  set_name: string;
  set_code: string;
  card_number: string;
  variant: PrintVariant;
  confidence: number;
  needs_human_confirmation: boolean;
  candidates: IdentityCandidate[];
  warnings: string[];
}

/** Raw catalog record as the resolution layer sees it. */
export interface CatalogCard {
  id: string;
  name: string;
  number: string; // e.g. "90" (the printed number, no "/total")
  setId: string; // pokemontcg.io set id, e.g. "ecard2"
  setName: string; // e.g. "Aquapolis"
  ptcgoCode: string | null; // e.g. "AQ", "DF"
  availableVariants: PrintVariant[]; // variants the catalog says exist for this card
}

/** Injectable catalog so tests run offline against a fixture. */
export interface CardCatalog {
  /** Search by card name (optionally narrowed by number / set-name hints). Returns up to `limit` raw cards. */
  searchCards(
    query: { name: string; number?: string | null; setHints?: string[] },
    limit?: number
  ): Promise<CatalogCard[]>;
  /** Optional health probe so resolvers can distinguish "catalog unreachable" from "no match". */
  health?: () => { degraded: boolean; message?: string };
}

// ── Variant knowledge ───────────────────────────────────────────────────────────

/** Base Set's id in pokemontcg.io. The only set with a real "shadowless" print. */
const BASE_SET_ID = "base1";

/**
 * Infer which print variants a card actually exists in, from the raw pokemontcg.io
 * card payload. Keys on tcgplayer.prices (when present) are authoritative; fall back
 * to a conservative default of "none" when the card has no price data.
 *
 * shadowless is NOT present in the API, so it is only inferred for Base Set cards
 * (every Base Set card had a shadowless unlimited printing alongside the regular one).
 */
export function availableVariantsFromCard(card: {
  setId?: string;
  tcgplayer?: { prices?: Record<string, unknown> } | null;
}): PrintVariant[] {
  const prices = card.tcgplayer?.prices ?? {};
  const keys = Object.keys(prices);
  const variants = new Set<PrintVariant>();

  if (keys.some((k) => /reverse/i.test(k))) variants.add("reverse_holo");
  if (keys.some((k) => /^firstEdition/i.test(k))) variants.add("first_edition");
  if (keys.some((k) => /unlimited/i.test(k))) variants.add("unlimited");
  if (keys.some((k) => /^normal|holofoil/i.test(k))) variants.add("none");

  // Base Set cards had 1st Edition (shadowless), shadowless unlimited, and
  // unlimited prints regardless of price keys (the API only carries the
  // Unlimited holofoil price for base1, so we must add the vintage prints).
  if (card.setId === BASE_SET_ID) {
    variants.add("first_edition");
    variants.add("shadowless");
    variants.add("unlimited");
  }

  if (variants.size === 0) variants.add("none");
  return [...variants];
}

// ── Query normalization ─────────────────────────────────────────────────────────

export interface NormalizedQuery {
  name: string;
  number: string | null;
  claimedVariant: PrintVariant;
  /** set-name hints the user mentioned (e.g. "aquapolis", "base set"), lowercased. */
  setHints: string[];
  raw: string;
}

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\b1st\s*ed(ition)?\b/g, "first edition"],
  [/\b1st\b/g, "first edition"],
  [/\bfirst\s*ed(ition)?\b/g, "first edition"],
  [/\brev\s*holo\b/g, "reverse holo"],
  [/\brh\b/g, "reverse holo"],
  [/\breverse\b/g, "reverse holo"],
  [/\bunl(imited)?\b/g, "unlimited"],
  [/\bshadowless\b/g, "shadowless"],
];

const VARIANT_KEYWORDS: Record<string, PrintVariant> = {
  "reverse holo": "reverse_holo",
  "first edition": "first_edition",
  shadowless: "shadowless",
  unlimited: "unlimited",
};

/**
 * Normalize a raw user query: lowercase, strip punctuation (keep "/" in card
 * numbers), expand abbreviations, pull out the card number and any variant keyword.
 * Returns the bare card name plus structured qualifiers.
 */
export function normalizeQuery(raw: string): NormalizedQuery {
  let q = raw.toLowerCase().trim().replace(/[^\w\s/.-]/g, " ").replace(/\s+/g, " ").trim();

  for (const [re, rep] of ABBREVIATIONS) q = q.replace(re, rep);

  // Claimed variant keyword — precedence-aware so "1st edition shadowless" resolves
  // to first_edition (shadowless is implied by a 1st-edition Base Set print), never
  // letting a later, lower-priority keyword overwrite it.
  const VARIANT_PRIORITY: PrintVariant[] = ["first_edition", "shadowless", "reverse_holo", "unlimited"];
  let claimedVariant: PrintVariant = "none";
  const present: PrintVariant[] = [];
  for (const [keyword, variant] of Object.entries(VARIANT_KEYWORDS)) {
    if (q.includes(keyword)) present.push(variant);
  }
  if (present.length > 0) {
    claimedVariant = VARIANT_PRIORITY.find((v) => present.includes(v))!;
    for (const keyword of Object.keys(VARIANT_KEYWORDS)) {
      q = q.replace(new RegExp(keyword.replace(/\s+/g, "\\s+"), "g"), " ").replace(/\s+/g, " ").trim();
    }
  }

  // Known set-name hints. "base set 2" must be tested before "base set" so the "2"
  // isn't left dangling (and later mistaken for a card number).
  const SET_HINTS = [
    "dragon frontiers", "aquapolis", "skyridge", "expedition", "base set 2", "base set",
    "jungle", "fossil", "team rocket", "neo genesis", "neo discovery", "neo revelation",
    "neo destiny", "gym heroes", "gym challenge", "ex dragon", "obsidian flames",
  ];
  const setHints: string[] = [];
  for (const hint of SET_HINTS) {
    if (q.includes(hint)) {
      setHints.push(hint);
      q = q.replace(new RegExp(hint.replace(/\s+/g, "\\s+"), "g"), " ").replace(/\s+/g, " ").trim();
    }
  }

  // Card number: "90/97" -> "90", or a lone "90". Set hints are already stripped, so
  // a standalone number now is genuinely the card number (not "2" from "base set 2").
  const numMatch = q.match(/(?:^|\s)(\d{1,4})\/\d{1,4}(?:[a-z])?(?:\s|$)/);
  const number = numMatch ? numMatch[1] : (q.match(/(?:^|\s)(\d{1,4})(?:\s|$)/)?.[1] ?? null);
  if (number) q = q.replace(new RegExp(`(?:^|\\s)${number}(?:\\/\\d{1,4}[a-z]?)?(?=\\s|$)`, "g"), " ").replace(/\s+/g, " ").trim();

  // Strip trailing/leading junk like "pokemon card", years.
  q = q.replace(/\b(pok[ée]mon card|card|pokemon|tcg|holo(?! reverse)|foil)\b/g, " ").replace(/\s+/g, " ").trim();
  q = q.replace(/^\d{4}\s+/, "").trim();

  return { name: q, number, claimedVariant, setHints, raw };
}

// ── Scoring ─────────────────────────────────────────────────────────────────────

/**
 * Score how well a catalog card matches the normalized query.
 * Returns 0..1. Exact name + number = 1.0.
 */
export function scoreCard(card: CatalogCard, q: NormalizedQuery): number {
  const name = q.name;
  if (!name) return 0;

  const cardName = card.name.toLowerCase();
  let score = 0;

  // Number is the strongest signal when present.
  if (q.number) {
    if (card.number === q.number) score += 0.5;
    else return 0; // wrong number disqualifies
  }

  // Name match.
  if (cardName === name) score += 0.5;
  else if (cardName.startsWith(name + " ") || name.startsWith(cardName + " ")) score += 0.35;
  else {
    const cardWords = cardName.split(/[^a-z0-9]+/).filter(Boolean);
    const queryWords = name.split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return 0;
    const hits = queryWords.filter((w) => cardWords.includes(w)).length;
    score += (hits / queryWords.length) * 0.35;
  }

  // Set-name hint bonus.
  if (q.setHints.length > 0) {
    const setMatch = q.setHints.some((hint) => card.setName.toLowerCase().includes(hint) || hint.includes(card.setName.toLowerCase()));
    score += setMatch ? 0.15 : -0.2;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Apply the variant cross-check (rule 7): if the query claims a variant that the
 * catalog says is NOT available for this card, flag it suspicious.
 * Returns [resolvedVariant, suspicious, reason].
 */
export function resolveVariant(
  card: CatalogCard,
  claimed: PrintVariant
): { variant: PrintVariant; suspicious: boolean; reason: string } {
  if (claimed === "none") {
    // No claim. If the card has multiple variants, flag for human confirmation downstream,
    // but don't mark suspicious here.
    return { variant: "none", suspicious: false, reason: "no print variant claimed" };
  }
  if (claimed === "shadowless" && card.setId !== BASE_SET_ID) {
    return { variant: claimed, suspicious: true, reason: `"shadowless" claimed but card is in ${card.setName}, not Base Set` };
  }
  if (card.availableVariants.includes(claimed)) {
    return { variant: claimed, suspicious: false, reason: `${claimed} confirmed available` };
  }
  return { variant: claimed, suspicious: true, reason: `"${claimed}" claimed but catalog does not list it for ${card.setName} #${card.number}` };
}

// ── Main resolution ─────────────────────────────────────────────────────────────

const CANDIDATE_LIMIT = 3;

/**
 * The gate. Resolve a loose query to a scored identity. Never throws: worst case it
 * returns confidence 0 with an empty candidate list and a warning.
 */
export async function resolveCardIdentity(query: string, catalog: CardCatalog): Promise<CardIdentityResult> {
  const warnings: string[] = [];
  const q = normalizeQuery(query);

  if (!q.name) {
    warnings.push("could not extract a card name from the query");
    return {
      canonical_name: "", set_name: "", set_code: "", card_number: "",
      variant: "none", confidence: 0, needs_human_confirmation: true,
      candidates: [], warnings,
    };
  }

  const cards = await catalog.searchCards({ name: q.name, number: q.number, setHints: q.setHints });

  if (cards.length === 0) {
    const degraded = catalog.health?.()?.degraded ?? false;
    const healthMsg = catalog.health?.()?.message;
    warnings.push(
      degraded
        ? `catalog unavailable (${healthMsg}); try again before trusting a zero-match — the card may still exist`
        : "no catalog match; verify the card name/set before any price lookup"
    );
    return {
      canonical_name: q.name, set_name: "", set_code: "", card_number: q.number ?? "",
      variant: q.claimedVariant, confidence: 0, needs_human_confirmation: true,
      candidates: [], warnings,
    };
  }

  // Score every candidate, keep the top 3, mark suspicious when variant doesn't line up.
  const scored = cards.map((card) => {
    const conf = scoreCard(card, q);
    const { variant, suspicious, reason } = resolveVariant(card, q.claimedVariant);
    if (suspicious) warnings.push(`cross-check: ${reason}`);
    return {
      card,
      confidence: conf,
      variant,
      suspicious,
      reason: suspicious ? `suspicious variant: ${reason}` : (conf === 1 ? "exact match" : "fuzzy match"),
    };
  });

  scored.sort((a, b) => b.confidence - a.confidence || Number(b.suspicious) - Number(a.suspicious));
  const top = scored.slice(0, CANDIDATE_LIMIT);

  const candidates: IdentityCandidate[] = top.map((s) => ({
    canonical_name: s.card.name,
    set_name: s.card.setName,
    set_code: s.card.ptcgoCode ?? s.card.setId,
    card_number: s.card.number,
    variant: s.variant,
    confidence: Math.round(s.confidence * 100) / 100,
    suspicious: s.suspicious,
    reason: s.reason,
  }));

  const best = top[0];
  const exact = best.confidence === 1 && best.card.number === (q.number ?? best.card.number) && !best.suspicious;
  // Needs human confirmation when: no exact match, tied top-2 confidences, or the best
  // match is variant-suspicious.
  const runnerUpClose = top.length > 1 && Math.abs(top[0].confidence - top[1].confidence) < 0.05;
  const needs_human_confirmation = !exact || runnerUpClose || best.suspicious;

  return {
    canonical_name: best.card.name,
    set_name: best.card.setName,
    set_code: best.card.ptcgoCode ?? best.card.setId,
    card_number: best.card.number,
    variant: best.variant,
    confidence: exact ? 1 : Math.round(best.confidence * 100) / 100,
    needs_human_confirmation,
    candidates,
    warnings,
  };
}

// ── Live catalog: pokemontcg.io ────────────────────────────────────────────────

const TCG_API_BASE = "https://api.pokemontcg.io/v2";

/**
 * Client-side set-name matcher. pokemontcg.io's `set.name:` query filter is flaky
 * (intermittently 500s) and exact-name only, so we fetch by name+number and rank by
 * set here. "base set" must match the set named "Base": we drop generic words and
 * require each remaining hint token to appear (case-insensitively) in the set name.
 */
export function setMatchesHint(setName: string | null | undefined, hint: string): boolean {
  return setMatchScore(setName, hint) > 0;
}

/**
 * How specifically a set name satisfies a hint, in 0..1.
 *  - All meaningful hint tokens must be present in the set name, else 0
 *    ("dragon frontiers" does not match the set "Dragon", which lacks the token
 *    "frontiers").
 *  - Among full matches, fewer set-name tokens = more specific/plausible:
 *    "base set" -> "Base" scores 1.0 (1/1) while "Base Set 2" scores 0.33 (1/3),
 *    so the most specific set ranks first.
 */
export function setMatchScore(setName: string | null | undefined, hint: string): number {
  if (!setName) return 0;
  const GENERIC = new Set(["set", "pokemon", "poké", "tcg", "card", "cards", "the"]);
  const hintWords = hint.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !GENERIC.has(w));
  const setWords = setName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (hintWords.length === 0 || setWords.length === 0) return 0;
  const allPresent = hintWords.every((hw) => setWords.some((sw) => sw.includes(hw) || hw.includes(sw)));
  if (!allPresent) return 0;
  return hintWords.length / setWords.length;
}

/**
 * Live catalog backed by the free pokemontcg.io v2 API (no key required).
 *
 * Query syntax note: the API's `name:"..."` is an EXACT-phrase match, so it
 * returns 0 for partial names ("dragonite ex"). We use a wildcard
 * `name:*dragonite*ex*` plus the optional number. Set narrowing is done
 * client-side (see setMatchScore) because the API's `set.name:` filter is
 * flaky and exact-match only, and "base set" must still match the set "Base".
 * If the name+number query yields nothing we fall back to a broader name-only
 * search so fuzzy matches still surface.
 */
// Module-scoped catalog health flag, shared by searchCards (writer) and health() (reader).
let lastError: string | null = null;

export const pokemontcgCatalog: CardCatalog = {
  async searchCards({ name, number, setHints }, limit = 10) {
    const wcName = `name:*${name.replace(/[*"]/g, "").trim().replace(/\s+/g, "*")}*`;
    const parts: string[] = [wcName];
    if (number) parts.push(`number:${number}`);
    const q = parts.join(" ");
    // Larger page so client-side set ranking has candidates to work with.
    const pageSize = Math.max(limit, 40);
    const url = `${TCG_API_BASE}/cards?q=${encodeURIComponent(q)}&pageSize=${pageSize}`;

    const fetchJson = async (u: string): Promise<any[]> => {
      try {
        const res = await fetch(u, { headers: { Accept: "application/json" } });
        if (!res.ok) {
          lastError = `catalog HTTP ${res.status}`;
          return [];
        }
        const data = await res.json();
        lastError = null;
        return data.data || [];
      } catch (e) {
        lastError = `catalog fetch failed: ${(e as Error).message}`;
        console.error("pokemontcg.io catalog error:", e);
        return [];
      }
    };

    let cards = await fetchJson(url);
    if (cards.length === 0) {
      // Broader fallback: name only (drop the number, keep the wildcard name).
      const fallback = `${TCG_API_BASE}/cards?q=${encodeURIComponent(wcName)}&pageSize=${pageSize}`;
      cards = await fetchJson(fallback);
    }

    const mapped = cards.map((c: any) => ({
      id: c.id,
      name: c.name,
      number: c.number,
      setId: c.set?.id ?? null,
      setName: c.set?.name ?? null,
      ptcgoCode: c.set?.ptcgoCode ?? null,
      availableVariants: availableVariantsFromCard({ setId: c.set?.id, tcgplayer: c.tcgplayer }),
    }));

    // If the user named a set, surface the most specific matching set first so the
    // right print ranks top even when a name is shared across many sets (e.g. Psyduck).
    // "base set" ranks Base (score 1.0) above Base Set 2 / Expedition Base Set (0.33).
    if (setHints && setHints.length > 0) {
      const primary = setHints[0];
      mapped.sort((a, b) => {
        const as = setMatchScore(a.setName, primary);
        const bs = setMatchScore(b.setName, primary);
        if (as !== bs) return bs - as;
        return 0;
      });
    }

    return mapped.slice(0, limit);
  },
  health() {
    return lastError
      ? { degraded: true, message: lastError }
      : { degraded: false };
  },
};

/**
 * Convenience entry: resolve a query against the live pokemontcg.io catalog.
 * Agents call this first, gate on `confidence` / `needs_human_confirmation`, and
 * only proceed to pricing when identity is confirmed.
 */
export function resolveCardIdentityLive(query: string, limit?: number): Promise<CardIdentityResult> {
  return resolveCardIdentity(query, { ...pokemontcgCatalog, searchCards: (cq, l) => pokemontcgCatalog.searchCards(cq, l ?? limit) });
}
