// Scan flow logic — pure, headless, fully unit-testable offline (T21).
//
// This module is the GLUE that connects the camera capture (T19:
// <CardScanModal> + src/lib/card-scan.ts) to the vision identify API (T20:
// POST /api/hunter/identify) and onward into the existing valuation queue
// (src/lib/valuation-ui.ts -> queueValuation). It contains NO JSX and NO
// network I/O of its own beyond the injectable `identifyCard` fetch wrapper.
//
// Like src/lib/valuation-ui.ts, it is written as plain erasable TypeScript so
// it runs both in the browser (via the Next app) and directly under
// `node --test` (Node 22+ strips types natively). No TS `enum` here.
//
// The identify response shape mirrors T20's documented contract:
//   POST /api/hunter/identify  { imageUrl }
//   → { candidates: [{ name, set, number, variant, price, imageUrl, confidence }],
//       needsConfirmation: boolean }
import type { QueueParams } from "./valuation-ui";

// ── Identify contract (T20) ────────────────────────────────────────────────

export interface IdentifyCandidate {
  /** Canonical card name, e.g. "Charmander". */
  name: string;
  /** Set code/name, e.g. "Scarlet & Violet Promo" / "svp". */
  set?: string | null;
  /** Collector number, e.g. "044". */
  number?: string | null;
  /** Print/variant, e.g. "Pokemon Center Exclusive", "Reverse Holo". */
  variant?: string | null;
  /** Current market price in USD, if the identify API could resolve one. */
  price?: number | null;
  /** Card artwork thumbnail URL for the picker. */
  imageUrl?: string | null;
  /** Match confidence from the identify API: "high" | "medium" | "low" | …. */
  confidence?: string | null;
  /**
   * 0..1 hybrid similarity/match score (T23.3). The display shape used to drop
   * it (only the label survived), but the picker (T23.4) now renders it as a
   * percentage + bar so the user sees the ranking at a glance. Derived from
   * the raw pipeline candidate's numeric `score`.
   */
  score?: number | null;
}

export interface IdentifyResponse {
  candidates: IdentifyCandidate[];
  needsConfirmation: boolean;
}

export type IdentifyResult =
  | { ok: true; data: IdentifyResponse }
  | { ok: false; error: string };

/**
 * The raw candidate shape the POST /api/hunter/identify route actually returns
 * (see src/app/api/hunter/identify/route.ts / identify-pipeline.ts). It is NOT
 * the same as the display shape `IdentifyCandidate` above — the API keeps the
 * pokemontcg.io record (`set` is an object, artwork under `imageSmall`/
 * `imageLarge`, a numeric `score`, and a `variantHints` array for print
 * options like ["regular", "Pokemon Center Exclusive"]).
 *
 * The glue must translate this into the picker/queue shape. This is the one
 * genuinely necessary adapter in the scan flow.
 */
export interface RawIdentifyCandidate {
  /** pokemontcg.io card id, e.g. "svp-44". */
  id: string;
  /** Canonical card name, e.g. "Charmander". */
  name: string;
  /** Set object from the catalog, e.g. { id: "svp", name: "Scarlet & Violet Promo" }. */
  set: { id: string; name: string; series?: string };
  /** Collector number as printed, e.g. "44". */
  number: string;
  /** Card artwork URLs from pokemontcg.io. */
  imageSmall?: string;
  imageLarge?: string;
  /** 0..1 composite match score against the extracted identity. */
  score: number;
  /** Physical-print options this card can be (regular / PC-exclusive / …). */
  variantHints: string[];
  /**
   * Per-finish market prices (USD) keyed by the SAME finish-label strings used
   * in `variantHints` (T30.5). Backend prerequisite T30.6 populates this when
   * pricing is available at identify time — e.g.
   * `{ "Regular": 15, "Reverse Holo": 250 }` for the Latios δ one-row-many-finish
   * case. When absent/empty the picker renders each row without a price hint
   * (the pre-T30.6 behavior). Optional so the identify route never breaks when
   * the pricing source is unavailable.
   */
  variantPrices?: Record<string, number>;
}

/** Map a numeric match score (0..1) to the confidence label the picker shows. */
export function confidenceFromScore(score: number | null | undefined): string {
  if (typeof score !== "number" || Number.isNaN(score)) return "low";
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

/**
 * Translate ONE raw pipeline candidate into the display shape(s) the picker
 * renders. A catalog record can represent several physical prints (e.g. svp-44
 * is both regular and Pokemon Center Exclusive — the same record, ~4x price
 * gap), so we EXPAND `variantHints` into one candidate per print option. That
 * is what lets the confirmation picker disambiguate the actual card.
 *
 * - `set` (object) → the set name string.
 * - `imageSmall`/`imageLarge` → a single `imageUrl` thumbnail.
 * - `score` → a `confidence` label ("high" | "medium" | "low").
 * - `variantHints` → one row per print; empty hints collapse to a single row
 *   with `variant: null`.
 */
export function mapRawCandidate(raw: RawIdentifyCandidate): IdentifyCandidate[] {
  const set = raw?.set?.name ?? raw?.set?.id ?? null;
  const imageUrl = raw?.imageSmall ?? raw?.imageLarge ?? null;
  const confidence = confidenceFromScore(raw?.score);
  const hints =
    Array.isArray(raw?.variantHints) && raw.variantHints.length > 0
      ? raw.variantHints
      : [null];
  // T30.5: per-finish prices the identify response MAY carry, keyed by the same
  // labels as `variantHints`. Missing/empty -> every row renders "—" (pre-T30.6).
  const prices =
    raw?.variantPrices && typeof raw.variantPrices === "object"
      ? raw.variantPrices
      : {};
  return hints.map((variant) => ({
    name: raw?.name ?? "Unknown card",
    set,
    number: raw?.number ?? null,
    variant,
    // Surface the price for this row's finish so the picker shows the gap
    // (e.g. regular ~$15 vs reverse holo ~$250). No key for a label -> null -> "—".
    price: variant ? prices[variant] ?? null : null,
    imageUrl,
    confidence,
    score: raw?.score ?? null,
  }));
}

/** Expand an array of raw pipeline candidates into display candidates. */
export function mapRawCandidates(raw: RawIdentifyCandidate[]): IdentifyCandidate[] {
  return (raw || []).flatMap(mapRawCandidate);
}

/** Injectable fetch impl (tests); mirrors what `identifyCard` needs. */
export type IdentifyFetch = typeof fetch;

/**
 * Call the vision identify API. Never throws — failures come back as
 * { ok: false, error }. This is the ONLY place the glue talks to the identify
 * route. Raw pipeline candidates are mapped to the display/queue shape via
 * `mapRawCandidates` (incl. variantHint expansion).
 */
export async function identifyCard(
  imageUrl: string,
  fetchImpl: IdentifyFetch = fetch
): Promise<IdentifyResult> {
  if (!imageUrl || !imageUrl.trim()) {
    return { ok: false, error: "No captured image to identify." };
  }
  try {
    const res = await fetchImpl("/api/hunter/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body?.error || "Could not identify this card." };
    }
    const raw = Array.isArray(body?.candidates) ? body.candidates : null;
    if (!raw) {
      return { ok: false, error: "The identify service returned no candidate data." };
    }
    return {
      ok: true,
      data: {
        candidates: mapRawCandidates(raw as RawIdentifyCandidate[]),
        needsConfirmation: body?.needsConfirmation === true,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not identify this card.",
    };
  }
}

/**
 * Clamp the candidate list to the top N shown in the confirmation picker.
 * T23.4: the picker handles progressive disclosure itself (top slice + "show
 * more"), so callers generally pass the full ranked list straight through.
 * This helper remains for callers that still want a hard clamp.
 */
export function topCandidates(
  candidates: IdentifyCandidate[],
  n = 3
): IdentifyCandidate[] {
  return candidates.slice(0, n);
}

// ── Auto-resolve vs. confirm decision ───────────────────────────────────────

export type ResolveOutcome =
  | { mode: "auto"; identity: IdentifyCandidate }
  | { mode: "pick"; candidates: IdentifyCandidate[] };

/**
 * Decide whether a single high-confidence match can be trusted (skip the
 * picker) or the user must confirm between the top candidates.
 *
 *   - needsConfirmation (2+ ties, e.g. regular vs Pokemon Center Exclusive) → pick
 *   - otherwise → auto-resolve to the top candidate
 *
 * T23.4: on `pick` the FULL ranked candidate list (up to 20) is handed to the
 * picker, which renders the top slice + "show more". Progressive disclosure is
 * a UI concern; the glue no longer pre-clamps to 3.
 */
export function resolveIdentity(resp: IdentifyResponse): ResolveOutcome {
  const candidates = resp.candidates ?? [];
  if (candidates.length === 0) return { mode: "pick", candidates: [] };
  if (resp.needsConfirmation) {
    return { mode: "pick", candidates };
  }
  return { mode: "auto", identity: candidates[0] };
}

// ── Card identity → valuation queue ─────────────────────────────────────────

/** Build the fallback/queue query string from an identified card. */
export function buildCardQuery(
  id: Pick<IdentifyCandidate, "name" | "set" | "number" | "variant">
): string {
  const parts = [
    id?.name?.trim(),
    id?.set?.trim(),
    id?.number?.trim(),
    id?.variant?.trim(),
  ];
  return parts.filter(Boolean).join(" ").trim();
}

/** Queue params for `queueValuation` given a resolved card identity. */
export function buildQueueParams(
  identity: IdentifyCandidate,
  userId?: string | null
): QueueParams {
  return {
    cardId: null,
    cardQuery: buildCardQuery(identity),
    userId: userId ?? null,
  };
}
