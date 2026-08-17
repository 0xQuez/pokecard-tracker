// Valuation UI logic — pure, headless, fully unit-testable offline.
//
// This module contains NO JSX and NO network I/O of its own: every function that
// touches Supabase takes a `client` interface (shape-compatible with the
// @supabase/supabase-js client returned by src/lib/supabaseClient.ts) so tests can
// inject a mock. The React components in src/components/valuation are thin wrappers
// around this logic.
//
// Written as plain erasable TypeScript so it runs both:
//   - in the browser via the Next app, and
//   - directly under `node --test` (Node 22+ strips types natively).
//
// NOTE: no TS `enum` here — Node's type stripping can't emit enum runtime code.

export type ValuationStatus =
  | "pending"
  | "claimed"
  | "running"
  | "done"
  | "failed"
  | "blocked";

export type CardCondition = "NM" | "LP" | "MP" | "HP" | "DMG";

// ── Row / JSONB shapes (mirror supabase/migrations/003_valuation_requests.sql) ──

export interface ValuationRequestRow {
  id: number;
  user_id: string | null;
  card_query: string;
  card_id: number | null;
  status: ValuationStatus;
  priority: number;
  claimed_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface CardIdentityJson {
  set?: string | null;
  number?: string | null;
  variant?: string | null;
  name?: string;
}

export interface PricePointJson {
  source?: "ebay" | "tcgplayer" | "psa" | string;
  url?: string | null;
  price?: number | null;
  condition_claimed?: string | null;
  condition_verified?: string | null;
  sold_at?: string | null;
  is_best_offer?: boolean | null;
  is_trust_anchor?: boolean | null;
  flags?: string[];
}

export interface CurveCellJson {
  estimated_price?: number | null;
  sample_count?: number | null;
}

export type ConditionCurveJson = Partial<Record<CardCondition, CurveCellJson | null>>;

export interface ValuationResultRow {
  id: number;
  request_id: number;
  card_identity: CardIdentityJson | null;
  price_points: PricePointJson[] | null;
  condition_curve: ConditionCurveJson | null;
  created_at: string;
  /** Unguessable token that unlocks the vendor-facing /valuation/share/<token> page. */
  share_token?: string | null;
}

export const CONDITIONS: CardCondition[] = ["NM", "LP", "MP", "HP", "DMG"];

export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * The subset of the @supabase/supabase-js client we use. Typed as `any` because
 * the real client's generic query builders do not structurally satisfy a
 * hand-written interface, but any shape-compatible mock (see tests) is valid.
 * This is the seam where the UI talks to Supabase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClientLike = any;

// ── Time helpers ──────────────────────────────────────────────────────────────

export function isRecent(timestampIso: string | null, nowMs: number): boolean {
  if (!timestampIso) return false;
  const t = new Date(timestampIso).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t <= RECENT_WINDOW_MS && nowMs - t >= 0;
}

// ── Confidence badge ──────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low" | "none";

export interface Confidence {
  level: ConfidenceLevel;
  label: string;
}

/**
 * Confidence is driven primarily by the sample size that produced an estimate.
 * A null/absent estimate or zero sample → "none" (no data for this condition).
 */
export function confidenceFor(
  sampleCount: number | null | undefined,
  hasPrice: boolean
): Confidence {
  if (!hasPrice || !sampleCount || sampleCount <= 0) {
    return { level: "none", label: "No data" };
  }
  if (sampleCount >= 5) return { level: "high", label: "High confidence" };
  if (sampleCount >= 2) return { level: "medium", label: "Medium confidence" };
  return { level: "low", label: "Low confidence" };
}

// ── Curve rows ────────────────────────────────────────────────────────────────

export interface CurveRow {
  condition: CardCondition;
  estimatedPrice: number | null;
  sampleCount: number | null;
  hasData: boolean;
  confidence: Confidence;
}

/** Normalize the JSONB condition_curve + price_points into a stable display list. */
export function deriveCurveRows(
  curve: ConditionCurveJson | null | undefined,
  points: PricePointJson[] | null | undefined
): CurveRow[] {
  return CONDITIONS.map((cond) => {
    const cell: CurveCellJson | null | undefined = curve ? curve[cond] : undefined;
    const estimatedPrice = cell?.estimated_price ?? null;
    const sampleCount = cell?.sample_count ?? null;
    const hasPrice = typeof estimatedPrice === "number" && !Number.isNaN(estimatedPrice);
    const hasData = hasPrice || (typeof sampleCount === "number" && sampleCount > 0);
    const pointsFor = (points || []).filter(
      (p) => p.condition_verified === cond && typeof p.price === "number"
    );
    return {
      condition: cond,
      estimatedPrice,
      sampleCount,
      hasData,
      confidence: confidenceFor(sampleCount ?? pointsFor.length, hasPrice),
    };
  });
}

// ── Sources list ──────────────────────────────────────────────────────────────

export interface SourceRow {
  key: string;
  source: string;
  url: string;
  price: number | null;
  conditionVerified: string | null;
  isTrustAnchor: boolean;
  isBestOffer: boolean;
  soldAt: string | null;
  flags: string[];
}

/**
 * Normalize price_points into a clickable source list. Only entries with a URL
 * are shown (they must be clickable links). Each is annotated with the verified
 * condition and sale price.
 */
export function buildSources(points: PricePointJson[] | null | undefined): SourceRow[] {
  return (points || [])
    .filter((p) => p && typeof p.url === "string" && p.url.length > 0)
    .map((p, i) => ({
      key: `${p.url ?? "point"}-${i}`,
      source: p.source ?? "unknown",
      url: p.url!,
      price: typeof p.price === "number" ? p.price : null,
      conditionVerified: p.condition_verified ?? p.condition_claimed ?? null,
      isTrustAnchor: p.is_trust_anchor === true,
      isBestOffer: p.is_best_offer === true,
      soldAt: p.sold_at ?? null,
      flags: p.flags ?? [],
    }));
}

// ── Status presentation ───────────────────────────────────────────────────────

export interface StatusMeta {
  label: string;
  tone: "pending" | "running" | "done" | "failed" | "blocked";
  spinner: boolean;
}

export function statusMeta(status: ValuationStatus, error: string | null): StatusMeta {
  switch (status) {
    case "pending":
      return { label: "Queued, waiting for a worker", tone: "pending", spinner: true };
    case "claimed":
    case "running":
      return { label: "Researching prices…", tone: "running", spinner: true };
    case "done":
      return { label: "Valuation complete", tone: "done", spinner: false };
    case "failed":
      return { label: error || "Valuation failed", tone: "failed", spinner: false };
    case "blocked":
      return {
        label: error || "Needs attention, ambiguous identity",
        tone: "blocked",
        spinner: false,
      };
    default:
      return { label: status, tone: "pending", spinner: false };
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function money(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Variant rendered inline after the name, e.g. "Dragonite ex · 1st Edition". */
export function identityTitle(id: CardIdentityJson | null | undefined): string {
  if (!id) return "";
  const name = id.name ?? "";
  const parts = [name];
  if (id.set) parts.push(id.set);
  if (id.number) parts.push(`#${id.number}`);
  if (id.variant) parts.push(id.variant);
  return parts.filter(Boolean).join(" · ");
}

// ── Queue operation ───────────────────────────────────────────────────────────

export interface QueueParams {
  cardId?: number | null;
  cardQuery: string;
  userId?: string | null;
}

export type QueueOutcome =
  | { kind: "queued"; request: ValuationRequestRow; requestId: number; message: string }
  | {
      kind: "shown_recent";
      request: ValuationRequestRow;
      requestId: number;
      result: ValuationResultRow;
      message: string;
    }
  | { kind: "error"; message: string };

/**
 * Queue a valuation request:
 *   1. If a DONE valuation for the same card identity completed within the last
 *      24h, return it (kind="shown_recent") instead of queuing a duplicate.
 *   2. Otherwise insert a `valuation_requests` row with status='pending'.
 *
 * `client` is a supabase-js-shaped object ({ from().select().eq().gte().insert() }).
 */
export async function queueValuation(
  client: SupabaseClientLike,
  params: QueueParams
): Promise<QueueOutcome> {
  if (!params.cardQuery || !params.cardQuery.trim()) {
    return { kind: "error", message: "A card query is required to queue a valuation." };
  }

  const recent = await findRecentValuation(client, params);
  if (recent) {
    return {
      kind: "shown_recent",
      request: recent.request,
      requestId: recent.request.id,
      result: recent.result,
      message: "A recent valuation already exists, showing it instead.",
    };
  }

  const { data, error } = await client
    .from("valuation_requests")
    .insert({
      card_id: params.cardId ?? null,
      card_query: params.cardQuery.trim(),
      user_id: params.userId ?? null,
      status: "pending",
      priority: 0,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { kind: "error", message: error?.message || "Failed to queue valuation." };
  }
  const request = data as ValuationRequestRow;
  return {
    kind: "queued",
    request,
    requestId: request.id,
    message: "Valuation queued, you'll be notified",
  };
}

export interface RecentValuation {
  request: ValuationRequestRow;
  result: ValuationResultRow;
}

/**
 * Look for a recent (≤24h) DONE valuation matching the same card identity.
 * Matching client-side with what the anon key can express: exact card_id when
 * provided, else exact card_query. The orchestrator writes back a result whose
 * request_id joins to the request row.
 */
export async function findRecentValuation(
  client: SupabaseClientLike,
  params: QueueParams
): Promise<RecentValuation | null> {
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();

  const run = (col: string, value: unknown) =>
    client
      .from("valuation_requests")
      .select("*, valuation_results(*)")
      .eq("status", "done")
      .eq(col, value)
      .gte("completed_at", since)
      .order("created_at", { ascending: false })
      .limit(5);

  const queries = [];
  if (params.cardId) queries.push(run("card_id", params.cardId));
  if (params.cardQuery && params.cardQuery.trim()) {
    queries.push(run("card_query", params.cardQuery.trim()));
  }
  if (queries.length === 0) return null;

  for (const q of queries) {
    const { data, error } = await q;
    if (error || !data) continue;
    for (const row of data as (ValuationRequestRow & {
      valuation_results: ValuationResultRow[] | null;
    })[]) {
      const results = row.valuation_results ?? [];
      const result = results[0];
      if (result) {
        return { request: row, result };
      }
    }
  }
  return null;
}

// ── Vendor-facing share (T18.9) ─────────────────────────────────────────────

/** Build the public share URL for a valuation's share token. */
export function shareLink(token: string | null | undefined, origin: string): string | null {
  if (!token || !token.trim()) return null;
  return `${origin.replace(/\/$/, "")}/valuation/share/${encodeURIComponent(token.trim())}`;
}

/**
 * Fetch a valuation result by its share token. The ONLY public read path for a
 * shared result — a server-side security-definer RPC that returns at most the
 * single row whose token matches (see supabase/migrations/004_valuation_share.sql).
 * Returns the row, or null when the token is invalid / the link was revoked.
 */
export async function fetchSharedValuation(
  client: SupabaseClientLike,
  token: string
): Promise<{ result: ValuationResultRow | null; error: string | null }> {
  if (!token || !token.trim()) {
    return { result: null, error: "This valuation link is missing its share token." };
  }
  const { data, error } = await client.rpc("get_valuation_by_share_token", {
    p_token: token.trim(),
  });
  if (error) return { result: null, error: error.message || "Failed to load this valuation." };
  const rows = Array.isArray(data) ? (data as ValuationResultRow[]) : [];
  const result = rows[0] ?? null;
  if (!result) {
    return { result: null, error: "This valuation link is invalid or has been revoked." };
  }
  return { result, error: null };
}

export type RegenerateShareOutcome =
  | { kind: "ok"; shareToken: string }
  | { kind: "error"; message: string };

/**
 * Rotate a valuation's share token (revokes previously-shared links). The anon
 * key cannot call the regenerate RPC, so this goes through a service-role server
 * route. `fetchImpl` is injectable for tests.
 */
export async function regenerateShareToken(
  resultId: number,
  fetchImpl: typeof fetch = fetch
): Promise<RegenerateShareOutcome> {
  try {
    const res = await fetchImpl("/api/valuation/regenerate-share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { kind: "error", message: body?.error || "Could not regenerate the share link." };
    }
    if (!body?.shareToken) {
      return { kind: "error", message: "Could not regenerate the share link." };
    }
    return { kind: "ok", shareToken: body.shareToken as string };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "Could not regenerate the share link.",
    };
  }
}
